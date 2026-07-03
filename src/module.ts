import dgram from 'node:dgram';

import {
  MatterbridgeDynamicPlatform,
  type MatterbridgeEndpoint,
  type PlatformConfig,
  type PlatformMatterbridge,
} from 'matterbridge';
import { buildAtombergUdpCommand, CONTROL_PENDING_MS, expectedSpeedAfterCommand } from './fanSpeed.js';
import { type AnsiLogger, type LogLevel } from 'matterbridge/logger';
import { isValidString } from 'matterbridge/utils';

import { normalizeDeviceId } from './atomberg-state.js';
import {
  buildFanSerial,
  buildFanStorageKey,
  buildPluginConfigUrl,
  createFanEndpoint,
  setupFanHandlers,
  syncFanStateFromUdp,
  updateFanEndpointIdentity,
} from './fanMatter.js';
import {
  type AtombergFanRecord,
  type AtombergPluginConfig,
  type DiscoveredFanStatus,
  type FanListItem,
  type StoredFanConfig,
} from './types.js';
import { AtombergUdpDiscovery } from './udpDiscovery.js';

export type { AtombergFanRecord, FanListItem, StoredFanConfig } from './types.js';

/**
 * Matterbridge plugin entry point.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): TemplatePlatform {
  return new TemplatePlatform(matterbridge, log, config);
}

export class TemplatePlatform extends MatterbridgeDynamicPlatform {
  private readonly atombergConfig: AtombergPluginConfig;
  private udpDiscovery: AtombergUdpDiscovery | undefined;
  private readonly endpointByIp = new Map<string, MatterbridgeEndpoint>();
  private readonly endpointByDeviceId = new Map<string, MatterbridgeEndpoint>();
  private readonly fanRecordByIp = new Map<string, AtombergFanRecord>();
  private readonly pendingControlByIp = new Map<string, { until: number; expectedSpeed: number }>();

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);
    this.atombergConfig = config as AtombergPluginConfig;

    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.9.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.9.0" for the plugin web interface. Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    if (!Array.isArray(this.atombergConfig.fans)) this.atombergConfig.fans = [];

    this.log.info('Initializing Atomberg Fan platform...');
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);

    await this.ready;
    await this.clearSelect();

    this.startUdpDiscovery();
    await this.registerConfiguredMatterFans();
  }

  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info('onConfigure called');

    for (const device of this.getDevices()) {
      this.log.info(`Configuring device: ${device.uniqueId}`);
    }
  }

  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    this.udpDiscovery?.stop();
    this.udpDiscovery = undefined;

    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
  }

  override async onAction(action: string): Promise<void> {
    if (action === 'openWebUi') {
      this.log.info(`Atomberg fan web UI: /plugins/${this.name}/`);
    }
  }

  override async onFetch(method: string, path?: string, query?: Record<string, unknown>, body?: unknown): Promise<unknown> {
    if (method === 'GET' && path === 'fans') {
      return { fans: this.buildFanList(), udpListenPort: this.getListenPort() };
    }

    if (method === 'GET' && path === 'settings') {
      return {
        udpListenPort: this.getListenPort(),
        udpCommandPort: this.getCommandPort(),
        matterDeviceCount: this.getDevices().length,
      };
    }

    if (method === 'POST' && path === 'fans-configure') {
      return this.configureFan(body as Record<string, unknown>);
    }

    if (method === 'POST' && path === 'fans-matter') {
      return this.toggleMatterRegistration(body as Record<string, unknown>);
    }

    if (method === 'POST' && path === 'fans-control') {
      return this.controlFanPower(body as Record<string, unknown>);
    }

    if (method === 'POST' && path === 'discovery-refresh') {
      return { fans: this.buildFanList(), refreshedAt: Date.now() };
    }

    return undefined;
  }

  private startUdpDiscovery(): void {
    this.udpDiscovery = new AtombergUdpDiscovery(this.log, this.getListenPort(), (status) => {
      void this.handleUdpStatusUpdate(status);
    });
    this.udpDiscovery.start();
  }

  private async handleUdpStatusUpdate(status: DiscoveredFanStatus): Promise<void> {
    const deviceId = normalizeDeviceId(status.deviceId);
    let endpoint = deviceId ? this.endpointByDeviceId.get(deviceId) : undefined;
    if (!endpoint) endpoint = this.endpointByIp.get(status.ipAddress);
    if (!endpoint) return;

    if (deviceId) this.endpointByDeviceId.set(deviceId, endpoint);

    const reportedSpeed = status.power === false ? 0 : (status.speed ?? 0);
    if (!this.shouldApplyUdpSync(status.ipAddress, reportedSpeed)) return;

    await syncFanStateFromUdp(endpoint, status.power, status.speed, endpoint.log);
  }

  private markPendingControl(ipAddress: string, expectedSpeed: number): void {
    this.pendingControlByIp.set(ipAddress, {
      until: Date.now() + CONTROL_PENDING_MS,
      expectedSpeed,
    });
  }

  private shouldApplyUdpSync(ipAddress: string, reportedSpeed: number): boolean {
    const pending = this.pendingControlByIp.get(ipAddress);
    if (!pending) return true;

    if (Date.now() > pending.until) {
      this.pendingControlByIp.delete(ipAddress);
      return true;
    }

    if (reportedSpeed === pending.expectedSpeed) {
      this.pendingControlByIp.delete(ipAddress);
      return true;
    }

    return false;
  }

  private async registerConfiguredMatterFans(): Promise<void> {
    for (const stored of this.getStoredFans()) {
      if (!stored.matterEnabled) continue;
      try {
        await this.registerMatterFan(stored.ipAddress);
      } catch (error) {
        this.log.error(`Failed to register Matter fan ${stored.ipAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private buildFanList(): FanListItem[] {
    const storedByIp = new Map(this.getStoredFans().map((fan) => [fan.ipAddress, fan]));
    const discovered = this.udpDiscovery?.getFans() ?? [];
    const ipSet = new Set<string>([...storedByIp.keys(), ...discovered.map((fan) => fan.ipAddress)]);

    const rows: FanListItem[] = [];
    for (const ipAddress of [...ipSet].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const stored = storedByIp.get(ipAddress);
      const live = discovered.find((fan) => fan.ipAddress === ipAddress);
      const displayName = stored?.displayName ?? live?.series ?? live?.model ?? `Atomberg Fan (${ipAddress})`;

      rows.push({
        ipAddress,
        displayName,
        productName: stored?.productName ?? live?.model ?? live?.series ?? 'Atomberg Fan',
        configured: stored !== undefined,
        matterEnabled: stored?.matterEnabled ?? false,
        matterRegistered: this.endpointByIp.has(ipAddress),
        online: live?.online ?? false,
        lastSeen: live?.lastSeen ?? null,
        deviceId: live?.deviceId,
        series: live?.series,
        power: live?.power,
        speed: live?.speed,
        configUrl: buildPluginConfigUrl(this.name, ipAddress),
      });

      this.setSelectDevice(
        buildFanSerial(ipAddress, live?.deviceId),
        displayName,
        buildPluginConfigUrl(this.name, ipAddress),
        'wifi',
      );
    }

    return rows;
  }

  private async configureFan(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; fan?: FanListItem }> {
    const ipAddress = typeof body.ipAddress === 'string' ? body.ipAddress.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const productName = typeof body.productName === 'string' ? body.productName.trim() : 'Atomberg Fan';

    if (!isValidString(ipAddress, 7)) return { ok: false, error: 'A valid IP address is required.' };
    if (!isValidString(displayName, 1)) return { ok: false, error: 'Display name is required.' };

    const fans = this.getStoredFans();
    const index = fans.findIndex((fan) => fan.ipAddress === ipAddress);
    const entry: StoredFanConfig = {
      ipAddress,
      displayName,
      productName: productName || 'Atomberg Fan',
      matterEnabled: index >= 0 ? (fans[index]?.matterEnabled ?? false) : false,
    };

    if (index >= 0) fans[index] = entry;
    else fans.push(entry);

    this.atombergConfig.fans = fans;
    this.saveConfig(this.atombergConfig);
    this.udpDiscovery?.touch(ipAddress);

    const live = this.udpDiscovery?.getFan(ipAddress);
    this.setSelectDevice(
      buildFanSerial(ipAddress, live?.deviceId),
      displayName,
      buildPluginConfigUrl(this.name, ipAddress),
      'wifi',
    );

    const record = this.fanRecordByIp.get(ipAddress);
    const endpoint = this.endpointByIp.get(ipAddress);
    if (record && endpoint) {
      record.displayName = displayName;
      record.productName = productName || 'Atomberg Fan';
      await updateFanEndpointIdentity(endpoint, record);
    }

    return { ok: true, fan: this.buildFanList().find((fan) => fan.ipAddress === ipAddress) };
  }

  private async toggleMatterRegistration(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; fan?: FanListItem }> {
    const ipAddress = typeof body.ipAddress === 'string' ? body.ipAddress.trim() : '';
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';

    if (!isValidString(ipAddress, 7)) return { ok: false, error: 'A valid IP address is required.' };
    if (action !== 'add' && action !== 'remove') return { ok: false, error: 'Action must be "add" or "remove".' };

    const fans = this.getStoredFans();
    const index = fans.findIndex((fan) => fan.ipAddress === ipAddress);
    if (index < 0) return { ok: false, error: 'Configure the fan name before adding it to Matter.' };

    if (action === 'add') {
      fans[index] = { ...fans[index], matterEnabled: true };
      this.atombergConfig.fans = fans;
      this.saveConfig(this.atombergConfig);
      await this.registerMatterFan(ipAddress);
      this.wssSendRestartRequired(true, false);
      return { ok: true, fan: this.buildFanList().find((fan) => fan.ipAddress === ipAddress) };
    }

    fans[index] = { ...fans[index], matterEnabled: false };
    this.atombergConfig.fans = fans;
    this.saveConfig(this.atombergConfig);
    await this.unregisterMatterFan(ipAddress);
    this.wssSendRestartRequired(true, false);
    return { ok: true, fan: this.buildFanList().find((fan) => fan.ipAddress === ipAddress) };
  }

  private async controlFanPower(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; fan?: FanListItem }> {
    const ipAddress = typeof body.ipAddress === 'string' ? body.ipAddress.trim() : '';
    const power = body.power;

    if (!isValidString(ipAddress, 7)) return { ok: false, error: 'A valid IP address is required.' };
    if (power !== true && power !== false) return { ok: false, error: 'Power must be true or false.' };

    const live = this.udpDiscovery?.getFan(ipAddress);
    const currentSpeed = live?.power === false ? 0 : (live?.speed ?? 0);
    const command = { type: 'power', value: power };
    const expectedSpeed = expectedSpeedAfterCommand(command, currentSpeed);
    if (expectedSpeed !== undefined) this.markPendingControl(ipAddress, expectedSpeed);

    try {
      await this.sendUdpCommand(ipAddress, command, currentSpeed);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    this.udpDiscovery?.touch(ipAddress);

    const endpoint = this.endpointByIp.get(ipAddress);
    if (endpoint && expectedSpeed !== undefined) {
      await syncFanStateFromUdp(
        endpoint,
        power,
        expectedSpeed > 0 ? expectedSpeed : undefined,
        endpoint.log,
      );
    }

    return { ok: true, fan: this.buildFanList().find((fan) => fan.ipAddress === ipAddress) };
  }

  private async registerMatterFan(ipAddress: string): Promise<void> {
    if (this.endpointByIp.has(ipAddress)) return;

    const stored = this.getStoredFans().find((fan) => fan.ipAddress === ipAddress);
    if (!stored) throw new Error(`Fan ${ipAddress} is not configured.`);

    const live = this.udpDiscovery?.getFan(ipAddress);
    const record = this.buildFanRecord(stored, live);
    const configUrl = buildPluginConfigUrl(this.name, ipAddress);
    const endpoint = createFanEndpoint(record, this.matterbridge.aggregatorVendorId, configUrl, this.config.debug);

    setupFanHandlers(endpoint, record, (fan, command) => {
      const live = this.udpDiscovery?.getFan(fan.ipAddress);
      const currentSpeed = live?.power === false ? 0 : (live?.speed ?? 0);
      const expectedSpeed = expectedSpeedAfterCommand(command, currentSpeed);
      if (expectedSpeed !== undefined) this.markPendingControl(fan.ipAddress, expectedSpeed);
      void this.sendUdpCommand(fan.ipAddress, command, currentSpeed);
    });

    await this.registerDevice(endpoint);
    this.endpointByIp.set(ipAddress, endpoint);
    this.fanRecordByIp.set(ipAddress, record);

    const deviceId = normalizeDeviceId(record.deviceId ?? live?.deviceId);
    if (deviceId) this.endpointByDeviceId.set(deviceId, endpoint);

    if (live) await syncFanStateFromUdp(endpoint, live.power, live.speed, endpoint.log);
  }

  private async unregisterMatterFan(ipAddress: string): Promise<void> {
    const endpoint = this.endpointByIp.get(ipAddress);
    if (!endpoint) return;

    const record = this.fanRecordByIp.get(ipAddress);
    const deviceId = normalizeDeviceId(record?.deviceId);
    if (deviceId) this.endpointByDeviceId.delete(deviceId);

    await this.unregisterDevice(endpoint);
    this.endpointByIp.delete(ipAddress);
    this.fanRecordByIp.delete(ipAddress);
  }

  private buildFanRecord(stored: StoredFanConfig, live?: DiscoveredFanStatus): AtombergFanRecord {
    return {
      ipAddress: stored.ipAddress,
      displayName: stored.displayName,
      productName: stored.productName ?? live?.model ?? live?.series ?? 'Atomberg Fan',
      serialNumber: buildFanSerial(stored.ipAddress, live?.deviceId),
      uniqueStorageKey: buildFanStorageKey(stored.ipAddress),
      deviceId: live?.deviceId,
    };
  }

  private getStoredFans(): StoredFanConfig[] {
    return Array.isArray(this.atombergConfig.fans) ? this.atombergConfig.fans : [];
  }

  private getListenPort(): number {
    return typeof this.atombergConfig.udpListenPort === 'number' ? this.atombergConfig.udpListenPort : 5625;
  }

  private getCommandPort(): number {
    return typeof this.atombergConfig.udpCommandPort === 'number' ? this.atombergConfig.udpCommandPort : 5600;
  }

  private async sendUdpCommand(ipAddress: string, command: Record<string, unknown>, currentSpeed = 0): Promise<void> {
    const stored = this.getStoredFans().find((fan) => fan.ipAddress === ipAddress);
    const atombergCommand = buildAtombergUdpCommand(command, currentSpeed);
    if (!atombergCommand) {
      this.log.warn(`${stored?.displayName ?? ipAddress}: unsupported Matter control command ${JSON.stringify(command)}`);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const message = Buffer.from(JSON.stringify(atombergCommand));

      socket.send(message, this.getCommandPort(), ipAddress, (error) => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });

    this.log.info(`${stored?.displayName ?? ipAddress}: sent UDP command ${JSON.stringify(atombergCommand)} to ${ipAddress}:${this.getCommandPort()}`);
  }
}
