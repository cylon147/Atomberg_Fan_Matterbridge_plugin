import dgram from 'node:dgram';

import { type AnsiLogger } from 'matterbridge/logger';

import { normalizeDeviceId, parseAtombergUdpPayload } from './atomberg-state.js';
import { type DiscoveredFanStatus } from './types.js';

const DEFAULT_LISTEN_PORT = 5625;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;

export type UdpDiscoveryListener = (status: DiscoveredFanStatus) => void;

/** Decode Atomberg UDP payloads (plain JSON or hex-encoded JSON). */
export function decodeAtombergPayload(buffer: Buffer): Record<string, unknown> | null {
  const trimmed = buffer.toString('utf8').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      const decoded = Buffer.from(trimmed, 'hex').toString('utf8');
      const parsed = JSON.parse(decoded) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return null;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export class AtombergUdpDiscovery {
  private readonly fansByIp = new Map<string, DiscoveredFanStatus>();
  private readonly lastMessageIdByDevice = new Map<string, string>();
  private socket: dgram.Socket | undefined;
  private pruneTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly log: AnsiLogger,
    private readonly listenPort = DEFAULT_LISTEN_PORT,
    private readonly onUpdate?: UdpDiscoveryListener,
  ) {}

  start(): void {
    if (this.socket) return;

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (error) => {
      this.log.error(`UDP discovery error: ${error.message}`);
    });

    this.socket.on('message', (message, remoteInfo) => {
      const ipAddress = remoteInfo.address;
      if (!ipAddress || ipAddress === '0.0.0.0') return;
      this.handleMessage(message, ipAddress);
    });

    this.socket.bind(this.listenPort, () => {
      this.log.info(`Atomberg UDP discovery listening on port ${this.listenPort}`);
    });

    this.pruneTimer = setInterval(() => this.markStaleOffline(), 30_000);
  }

  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
      this.log.info('Atomberg UDP discovery stopped');
    }
  }

  getFans(): DiscoveredFanStatus[] {
    return [...this.fansByIp.values()].toSorted((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }));
  }

  getFan(ipAddress: string): DiscoveredFanStatus | undefined {
    return this.fansByIp.get(ipAddress);
  }

  getFanByDeviceId(deviceId: string): DiscoveredFanStatus | undefined {
    const normalized = normalizeDeviceId(deviceId);
    if (!normalized) return undefined;
    return this.getFans().find((fan) => normalizeDeviceId(fan.deviceId) === normalized);
  }

  touch(ipAddress: string): void {
    const now = Date.now();
    const existing = this.fansByIp.get(ipAddress);
    if (existing) {
      this.updateFan({ ...existing, lastSeen: now, online: true });
      return;
    }
    this.updateFan({ ipAddress, lastSeen: now, online: true });
  }

  private handleMessage(message: Buffer, ipAddress: string): void {
    const state = parseAtombergUdpPayload(message);
    if (state) {
      const deviceId = normalizeDeviceId(state.deviceId);
      if (deviceId && this.isDuplicateStateMessage(deviceId, state.messageId)) return;

      this.updateFan({
        ipAddress,
        lastSeen: Date.now(),
        online: true,
        deviceId,
        power: state.power,
        speed: state.speed,
        sleepMode: state.sleep,
        led: state.led,
      });
      return;
    }

    const payload = decodeAtombergPayload(message);
    const now = Date.now();
    const existing = this.fansByIp.get(ipAddress);

    if (!payload) {
      const raw = message.toString('utf8').trim();
      if (raw.length >= 12 && /^[0-9a-fA-F]{12}/.test(raw)) {
        const deviceId = normalizeDeviceId(raw.slice(0, 12));
        const series = raw.slice(12).trim() || undefined;
        this.updateFan({
          ipAddress,
          lastSeen: now,
          online: true,
          deviceId,
          series,
        });
        return;
      }

      if (existing) {
        this.updateFan({ ...existing, lastSeen: now, online: true });
      } else {
        this.updateFan({ ipAddress, lastSeen: now, online: true });
      }
      return;
    }

    this.updateFan({
      ipAddress,
      lastSeen: now,
      online: readBoolean(payload.is_online) ?? true,
      deviceId: normalizeDeviceId(readString(payload.device_id)),
      series: readString(payload.series),
      model: readString(payload.model),
      power: readBoolean(payload.power),
      speed: readNumber(payload.last_recorded_speed) ?? readNumber(payload.speed),
      sleepMode: readBoolean(payload.sleep_mode),
      led: readBoolean(payload.led),
    });
  }

  private isDuplicateStateMessage(deviceId: string, messageId: string): boolean {
    if (!messageId) return false;
    const previous = this.lastMessageIdByDevice.get(deviceId);
    if (previous === messageId) return true;
    this.lastMessageIdByDevice.set(deviceId, messageId);
    return false;
  }

  private updateFan(status: DiscoveredFanStatus): void {
    this.fansByIp.set(status.ipAddress, status);
    this.onUpdate?.(status);
  }

  private markStaleOffline(): void {
    const now = Date.now();
    for (const [ip, fan] of this.fansByIp.entries()) {
      if (fan.online && now - fan.lastSeen > OFFLINE_AFTER_MS) {
        this.fansByIp.set(ip, { ...fan, online: false });
      }
    }
  }
}
