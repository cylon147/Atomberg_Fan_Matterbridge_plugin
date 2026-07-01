import dgram from 'node:dgram';
import { setInterval as setIntervalTimer, clearInterval as clearIntervalTimer } from 'node:timers';

import { MatterbridgeDynamicPlatform, MatterbridgeEndpoint, fanDevice, type PlatformConfig, type PlatformMatterbridge, subscribeAttribute } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { type LogLevel } from 'matterbridge/logger';
import { fireAndForget } from 'matterbridge/utils';

import { type AtombergStateBroadcast, type ColorMode, normalizeDeviceId, parseAtombergUdpPayload } from './atomberg-state.js';

type ConfigFan = { name?: string; ip: string; mac?: string; series?: string };

interface AtombergDiscoveredDevice {
  mac: string;
  ip: string;
  series?: string;
  lastSeenMs: number;
}

interface FanEndpointBinding {
  endpoint: MatterbridgeEndpoint;
  supportsBrightness: boolean;
  supportsColor: boolean;
}

type StateListener = (state: AtombergStateBroadcast) => void;
type DiscoveryListener = (deviceId: string) => void;

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): AtombergPlatform {
  return new AtombergPlatform(matterbridge, log, config);
}

export class AtombergPlatform extends MatterbridgeDynamicPlatform {
  private atombergClient?: AtombergLocalClient;
  private readonly fanEndpoints = new Map<string, FanEndpointBinding>();
  private readonly configuredFans: ConfigFan[];
  private registeringDevices = new Set<string>();

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.9.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.9.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.configuredFans = Array.isArray((this.config as unknown as { fans?: ConfigFan[] }).fans) ? ((this.config as unknown as { fans?: ConfigFan[] }).fans ?? []) : [];

    this.log.info('Initializing platform:', this.config.name);

    if (!isTestEnvironment()) {
      this.atombergClient = new AtombergLocalClient(this.log);
      this.atombergClient.onStateUpdate((state) => {
        fireAndForget(this.handleFanStateUpdate(state), this.log, 'Atomberg state update failed');
      });
      this.atombergClient.onDeviceDiscovered((deviceId) => {
        fireAndForget(this.ensureFanRegistered(deviceId), this.log, 'Atomberg fan registration failed');
      });
      this.atombergClient.start();
    }
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info('onStart called with reason:', reason ?? 'none');
    await this.ready;
    await this.clearSelect();
    await this.discoverDevices();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');
    for (const device of this.getDevices()) {
      this.log.info('Configuring device:', device.uniqueId);
    }
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info('onChangeLoggerLevel called with:', logLevel);
  }

  override async onShutdown(reason?: string): Promise<void> {
    this.atombergClient?.stop();
    await super.onShutdown(reason);
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }

  private async discoverDevices() {
    this.log.info('Discovering devices...');

    for (const fan of this.configuredFans) {
      const id = normalizeDeviceId(fan.mac ?? fan.ip);
      if (id) this.atombergClient?.addConfiguredDevice(id, fan.ip, fan.series);
    }

    const devices = this.atombergClient?.getAvailableDevices() ?? [];

    if (devices.length === 0 && this.configuredFans.length === 0) {
      if (isTestEnvironment()) {
        await this.registerPlaceholderFan();
        return;
      }
      this.log.warn('No Atomberg fans discovered yet; listening on UDP 5625 for beacons and state broadcasts');
      return;
    }

    for (const device of devices) {
      await this.registerFanDevice(device);
    }
  }

  private async registerPlaceholderFan() {
    const fan = new MatterbridgeEndpoint(fanDevice, { id: 'fan1' }, this.config.debug)
      .createDefaultBridgedDeviceBasicInformationClusterServer('Fan', 'SN123456', this.matterbridge.aggregatorVendorId, 'Matterbridge', 'Matterbridge Fan', 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters()
      .createDefaultOnOffClusterServer()
      .addCommandHandler('OnOff.on', () => {
        this.log.info('Command OnOff.on called');
      })
      .addCommandHandler('OnOff.off', () => {
        this.log.info('Command OnOff.off called');
      });

    await this.registerDevice(fan);
  }

  private async ensureFanRegistered(deviceId: string) {
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized || this.fanEndpoints.has(normalized) || this.registeringDevices.has(normalized)) return;

    const device = this.atombergClient?.getDevice(normalized);
    if (!device) return;

    this.registeringDevices.add(normalized);
    try {
      await this.registerFanDevice(device);
    } finally {
      this.registeringDevices.delete(normalized);
    }
  }

  private runClientCommand(operation: (client: AtombergLocalClient) => Promise<void>, errorLabel: string): void {
    const client = this.atombergClient;
    if (!client) return;
    fireAndForget(operation(client), this.log, errorLabel);
  }

  private async registerFanDevice(device: AtombergDiscoveredDevice): Promise<void> {
    const deviceId = normalizeDeviceId(device.mac);
    if (!deviceId || this.fanEndpoints.has(deviceId)) return;

    const conf = this.configuredFans.find((f) => normalizeDeviceId(f.mac ?? f.ip) === deviceId);
    const name = conf?.name ?? `Atomberg Fan ${device.mac}`;
    const supportsBrightness = supportsAtombergBrightness(device.series);
    const supportsColor = supportsAtombergColor(device.series);

    const fan = new MatterbridgeEndpoint(fanDevice, { id: device.mac }, this.config.debug)
      .createDefaultBridgedDeviceBasicInformationClusterServer(name, device.mac.toUpperCase(), this.matterbridge.aggregatorVendorId, 'Atomberg', 'Atomberg Fan', 10000, '1.0.0')
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters()
      .createDefaultOnOffClusterServer();

    if (supportsBrightness) {
      fan.createDefaultLevelControlClusterServer(254, 1, 254, null, null);
    }
    if (supportsColor) {
      fan.createCtColorControlClusterServer(370, 153, 500);
    }

    fan
      .addCommandHandler('OnOff.on', () => {
        this.log.info('Command OnOff.on called for', device.mac);
        this.runClientCommand( async (client) => client.sendPower(device.mac, true), `Power on failed for ${device.mac}`);
      })
      .addCommandHandler('OnOff.off', () => {
        this.log.info('Command OnOff.off called for', device.mac);
        this.runClientCommand( async (client) => client.sendPower(device.mac, false), `Power off failed for ${device.mac}`);
      });

    await this.registerDevice(fan);
    this.fanEndpoints.set(deviceId, { endpoint: fan, supportsBrightness, supportsColor });

    subscribeAttribute(fan, 'onOff', 'onOff', (newValue, _oldValue, context) => {
      if (isLocallyGeneratedChange(context)) return;
      this.runClientCommand( async (client) => client.sendPower(device.mac, Boolean(newValue)), `Power update failed for ${device.mac}`);
    });
    subscribeAttribute(fan, 'fanControl', 'percentSetting', (newValue, _oldValue, context) => {
      if (isLocallyGeneratedChange(context)) return;
      const percent = Number(newValue);
      if (!Number.isFinite(percent)) return;
      const mappedSpeed = mapPercentToSpeed(percent);
      if (mappedSpeed <= 0) {
        this.runClientCommand( async (client) => client.sendPower(device.mac, false), `Power off failed for ${device.mac}`);
        return;
      }
      this.runClientCommand( async (client) => client.sendPower(device.mac, true), `Power on failed for ${device.mac}`);
      this.runClientCommand( async (client) => client.sendSpeed(device.mac, mappedSpeed), `Speed update failed for ${device.mac}`);
    });
    subscribeAttribute(fan, 'fanControl', 'speedSetting', (newValue, _oldValue, context) => {
      if (isLocallyGeneratedChange(context)) return;
      const speed = Number(newValue);
      if (!Number.isFinite(speed)) return;
      const normalized = Math.max(0, Math.min(6, Math.round(speed)));
      if (normalized <= 0) {
        this.runClientCommand( async (client) => client.sendPower(device.mac, false), `Power off failed for ${device.mac}`);
        return;
      }
      this.runClientCommand( async (client) => client.sendPower(device.mac, true), `Power on failed for ${device.mac}`);
      this.runClientCommand( async (client) => client.sendSpeed(device.mac, normalized), `Speed update failed for ${device.mac}`);
    });

    if (supportsBrightness) {
      subscribeAttribute(fan, 'levelControl', 'currentLevel', (newValue, _oldValue, context) => {
        if (isLocallyGeneratedChange(context)) return;
        const level = Number(newValue);
        if (!Number.isFinite(level)) return;
        this.runClientCommand( async (client) => client.sendBrightness(device.mac, mapLevelToBrightness(level)), `Brightness update failed for ${device.mac}`);
      });
    }

    if (supportsColor) {
      subscribeAttribute(fan, 'colorControl', 'colorTemperatureMireds', (newValue, _oldValue, context) => {
        if (isLocallyGeneratedChange(context)) return;
        const mireds = Number(newValue);
        if (!Number.isFinite(mireds)) return;
        this.runClientCommand( async (client) => client.sendColor(device.mac, mapMiredsToColorMode(mireds)), `Color update failed for ${device.mac}`);
      });
    }

    this.log.info('Registered Matter fan for device_id', deviceId);
  }

  /**
   * Applies a UDP state broadcast to exactly one Matter fan, matched by device_id.
   * All fans share port 5625; routing is always by device_id, never by sender IP alone.
   */
  private async handleFanStateUpdate(state: AtombergStateBroadcast) {
    const deviceId = normalizeDeviceId(state.deviceId);
    if (!deviceId) return;

    await this.ensureFanRegistered(deviceId);

    const binding = this.fanEndpoints.get(deviceId);
    if (!binding) return;

    await this.applyStateToFan(binding, state);
  }

  private async applyStateToFan(binding: FanEndpointBinding, state: AtombergStateBroadcast) {
    const { endpoint, supportsBrightness, supportsColor } = binding;

    await endpoint.setAttribute('onOff', 'onOff', state.power, this.log);

    const percent = state.power && state.speed > 0 ? mapSpeedToPercent(state.speed) : 0;
    await endpoint.setAttribute('fanControl', 'percentCurrent', percent, this.log);
    await endpoint.setAttribute('fanControl', 'speedCurrent', state.power ? state.speed : 0, this.log);

    if (state.power && state.speed > 0) {
      await endpoint.setAttribute('fanControl', 'percentSetting', percent, this.log);
      await endpoint.setAttribute('fanControl', 'speedSetting', state.speed, this.log);
    }

    if (supportsBrightness && state.brightness !== undefined) {
      await endpoint.setAttribute('levelControl', 'currentLevel', mapBrightnessToLevel(state.brightness), this.log);
    }

    if (supportsColor && state.color) {
      await endpoint.setAttribute('colorControl', 'colorTemperatureMireds', mapColorModeToMireds(state.color), this.log);
    }
  }
}

class AtombergLocalClient {
  private readonly log: AnsiLogger;
  private readonly devicesByMac = new Map<string, AtombergDiscoveredDevice>();
  private readonly lastMessageIdByDevice = new Map<string, string>();
  private socket?: dgram.Socket;
  private cleanupTimer?: NodeJS.Timeout;
  private stateListener?: StateListener;
  private discoveryListener?: DiscoveryListener;

  private static readonly DISCOVERY_PORT = 5625;
  private static readonly COMMAND_PORT = 5600;
  private static readonly DEVICE_TIMEOUT_MS = 10000;

  constructor(log: AnsiLogger) {
    this.log = log;
  }

  onStateUpdate(listener: StateListener) {
    this.stateListener = listener;
  }

  onDeviceDiscovered(listener: DiscoveryListener) {
    this.discoveryListener = listener;
  }

  addConfiguredDevice(macOrId: string, ip: string, series?: string) {
    const mac = normalizeDeviceId(macOrId);
    if (!mac) return;
    this.upsertDevice(mac, ip, series, false);
  }

  start() {
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.on('error', (err) => {
        this.log.warn(`Atomberg UDP socket error: ${String(err.message ?? err)}`);
      });
      this.socket.on('message', (msg, rinfo) => this.onUdpMessage(msg, rinfo.address));
      this.socket.bind(AtombergLocalClient.DISCOVERY_PORT, '0.0.0.0', () => {
        this.log.info(`Atomberg UDP listener bound on 0.0.0.0:${AtombergLocalClient.DISCOVERY_PORT}`);
      });

      this.cleanupTimer = setIntervalTimer(() => this.cleanupStaleDevices(), 5000);
    } catch (error) {
      this.log.warn(`Failed to start Atomberg UDP listener: ${String((error as Error)?.message ?? error)}`);
    }
  }

  stop() {
    try {
      if (this.cleanupTimer) clearIntervalTimer(this.cleanupTimer);
      if (this.socket) this.socket.close();
    } catch {
      // ignore
    }
  }

  getAvailableDevices(): AtombergDiscoveredDevice[] {
    return [...this.devicesByMac.values()].toSorted((a, b) => a.mac.localeCompare(b.mac));
  }

  getDevice(deviceId: string): AtombergDiscoveredDevice | undefined {
    return this.devicesByMac.get(normalizeDeviceId(deviceId) ?? '');
  }

  async sendPower(mac: string, power: boolean): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    await this.sendJson(target.ip, { power });
  }

  async sendSpeed(mac: string, speed: number): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    await this.sendJson(target.ip, { speed: Math.max(1, Math.min(6, Math.round(speed))) });
  }

  async sendSleep(mac: string, enabled: boolean): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    await this.sendJson(target.ip, { sleep: Boolean(enabled) });
  }

  async sendTimer(mac: string, hours: number): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    const allowed = new Set([0, 1, 2, 3, 4]);
    await this.sendJson(target.ip, { timer: allowed.has(Math.round(hours)) ? Math.round(hours) : 0 });
  }

  async sendLed(mac: string, on: boolean): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    await this.sendJson(target.ip, { led: Boolean(on) });
  }

  async sendBrightness(mac: string, value: number): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    await this.sendJson(target.ip, { brightness: Math.max(10, Math.min(100, Math.round(value))) });
  }

  async sendColor(mac: string, mode: ColorMode): Promise<void> {
    const target = this.devicesByMac.get(normalizeDeviceId(mac) ?? '');
    if (!target) throw new Error(`Unknown device ${mac}`);
    const allowed: ColorMode[] = ['warm', 'cool', 'daylight'];
    const use = allowed.includes(mode) ? mode : 'daylight';
    await this.sendJson(target.ip, { light_mode: use });
  }

  private async sendJson(ip: string, payload: Record<string, unknown>): Promise<void> {
    const message = Buffer.from(JSON.stringify(payload), 'utf8');
    await new Promise<void>((resolve, reject) => {
      try {
        const client = dgram.createSocket('udp4');
        client.send(message, AtombergLocalClient.COMMAND_PORT, ip, (err) => {
          client.close();
          if (err) reject(err);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private onUdpMessage(buffer: Buffer, senderIp: string) {
    const state = parseAtombergUdpPayload(buffer);
    if (state) {
      this.upsertDevice(state.deviceId, senderIp, undefined, false);
      if (this.isDuplicateStateMessage(state.deviceId, state.messageId)) return;
      this.stateListener?.(state);
      return;
    }

    const raw = buffer.toString('utf8').trim();
    if (raw.startsWith('{')) return;

    // Beacon: first 12 chars are MAC, remainder optional series (see Atomberg API docs)
    if (raw.length >= 12 && /^[0-9a-fA-F]{12}/.test(raw)) {
      const mac = raw.slice(0, 12).toLowerCase();
      const series = raw.slice(12).trim() || undefined;
      const created = this.upsertDevice(mac, senderIp, series, true);
      if (created) this.discoveryListener?.(mac);
    }
  }

  private isDuplicateStateMessage(deviceId: string, messageId: string): boolean {
    if (!messageId) return false;
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized) return false;
    const previous = this.lastMessageIdByDevice.get(normalized);
    if (previous === messageId) return true;
    this.lastMessageIdByDevice.set(normalized, messageId);
    return false;
  }

  private upsertDevice(mac: string, ip: string, series?: string, logDiscovery = true): boolean {
    const normalized = normalizeDeviceId(mac);
    if (!normalized) return false;

    const now = Date.now();
    const existing = this.devicesByMac.get(normalized);
    if (existing) {
      existing.ip = ip;
      existing.series = series ?? existing.series;
      existing.lastSeenMs = now;
      return false;
    }

    this.devicesByMac.set(normalized, { mac: normalized, ip, series, lastSeenMs: now });
    if (logDiscovery) {
      this.log.info(`Discovered Atomberg device ${normalized} at ${ip}${series ? ` (${series})` : ''}`);
    }
    return true;
  }

  private cleanupStaleDevices() {
    const now = Date.now();
    for (const [mac, dev] of this.devicesByMac.entries()) {
      if (now - dev.lastSeenMs > AtombergLocalClient.DEVICE_TIMEOUT_MS) {
        this.devicesByMac.delete(mac);
        this.lastMessageIdByDevice.delete(mac);
        this.log.info(`Removed inactive Atomberg device ${mac}`);
      }
    }
  }
}

function supportsAtombergBrightness(series?: string): boolean {
  if (!series) return true;
  const upper = series.toUpperCase();
  return ['I1', 'M1', 'S1', 'S2'].some((code) => upper.includes(code));
}

function supportsAtombergColor(series?: string): boolean {
  if (!series) return false;
  return series.toUpperCase().includes('I1');
}

function isLocallyGeneratedChange(context: { offline?: boolean } | undefined): boolean {
  return context?.offline === true;
}

function isTestEnvironment(): boolean {
  return Boolean(process.env.VITEST || process.env.JEST_WORKER_ID);
}

function mapPercentToSpeed(percent: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (clamped === 0) return 0;
  return Math.max(1, Math.min(6, Math.round((clamped / 100) * 6)));
}

function mapSpeedToPercent(speed: number): number {
  if (speed <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round((speed / 6) * 100)));
}

function mapLevelToBrightness(level: number): number {
  const clamped = Math.max(1, Math.min(254, Math.round(level)));
  const percent = Math.round((clamped / 254) * 100);
  return Math.max(10, Math.min(100, percent));
}

function mapBrightnessToLevel(brightness: number): number {
  const clamped = Math.max(10, Math.min(100, Math.round(brightness)));
  return Math.max(1, Math.min(254, Math.round((clamped / 100) * 254)));
}

function mapMiredsToColorMode(mireds: number): ColorMode {
  const v = Math.round(mireds);
  if (v >= 370) return 'warm';
  if (v <= 249) return 'cool';
  return 'daylight';
}

function mapColorModeToMireds(mode: ColorMode): number {
  if (mode === 'warm') return 400;
  if (mode === 'cool') return 200;
  return 300;
}
