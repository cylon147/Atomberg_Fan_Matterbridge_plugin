/* oxlint-disable eslint/no-bitwise -- Atomberg UDP state_string decoding uses bitmask flags from the official API */

export type ColorMode = 'warm' | 'cool' | 'daylight';

/** Parsed fan state from an Atomberg UDP broadcast (port 5625). */
export interface AtombergStateBroadcast {
  deviceId: string;
  messageId: string;
  power: boolean;
  led: boolean;
  sleep: boolean;
  speed: number;
  timerHours: number;
  timerElapsedMins: number;
  brightness?: number;
  color?: ColorMode;
}

/**
 * Parses an Atomberg UDP state packet from port 5625.
 * Official format: hex-encoded JSON with device_id, message_id, and state_string.
 * @see https://developer.atomberg-iot.com/#get-/v1/get_device_state
 */
export function parseAtombergUdpPayload(buffer: Buffer): AtombergStateBroadcast | null {
  const jsonText = extractAtombergStateJsonText(buffer);
  if (!jsonText) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deviceId = normalizeDeviceId(payload.device_id ?? payload.id);
  if (!deviceId) return null;

  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';

  if (typeof payload.state_string === 'string') {
    const decoded = decodeAtombergStateString(payload.state_string);
    if (!decoded) return null;
    return { deviceId, messageId, ...decoded };
  }

  return parseAtombergPlainStatePayload(deviceId, messageId, payload);
}

/** Extract JSON text from hex-encoded or plain UDP payloads. */
export function extractAtombergStateJsonText(buffer: Buffer): string | null {
  const raw = buffer.toString('utf8').trim();

  if (raw.length >= 32 && /^[0-9a-fA-F]+$/.test(raw)) {
    try {
      return Buffer.from(raw, 'hex').toString('utf8');
    } catch {
      return null;
    }
  }

  if (raw.startsWith('{')) return raw;

  const withHeader = buffer.subarray(8).toString('utf8').trim();
  if (withHeader.startsWith('{')) return withHeader;

  return null;
}

/**
 * Decodes the first field of state_string using Atomberg bit flags.
 * @see https://developer.atomberg-iot.com/#get-/v1/get_device_state
 */
export function decodeAtombergStateString(stateString: string): Omit<AtombergStateBroadcast, 'deviceId' | 'messageId'> | null {
  const firstField = stateString.split(',')[0]?.trim();
  if (!firstField) return null;

  const value = Number.parseInt(firstField, 10);
  if (!Number.isFinite(value)) return null;

  const v = value >>> 0;
  const cool = (0x08 & v) > 0;
  const warm = (0x8000 & v) > 0;

  let color: ColorMode | undefined;
  if (cool && warm) color = 'daylight';
  else if (warm) color = 'warm';
  else if (cool) color = 'cool';

  const brightnessRaw = Math.round((0x7f00 & v) / 256);

  return {
    power: (0x10 & v) > 0,
    led: (0x20 & v) > 0,
    sleep: (0x80 & v) > 0,
    speed: 0x07 & v,
    timerHours: Math.round((0x0f0000 & v) / 65536),
    timerElapsedMins: Math.round((((0xff000000 & v) >>> 0) * 4) / 16777216),
    brightness: brightnessRaw > 0 ? brightnessRaw : undefined,
    color,
  };
}

export function normalizeDeviceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return normalized.length >= 12 ? normalized.slice(0, 12) : normalized.length > 0 ? normalized : undefined;
}

function parseAtombergPlainStatePayload(deviceId: string, messageId: string, payload: Record<string, unknown>): AtombergStateBroadcast | null {
  if (typeof payload.power !== 'boolean' && payload.last_recorded_speed === undefined && payload.speed === undefined) {
    return null;
  }

  const speedValue = payload.last_recorded_speed ?? payload.speed ?? 0;
  const speed = Number(speedValue);
  const brightnessValue = payload.last_recorded_brightness ?? payload.brightness;
  const colorValue = payload.last_recorded_color ?? payload.color;

  return {
    deviceId,
    messageId,
    power: Boolean(payload.power),
    led: Boolean(payload.led),
    sleep: Boolean(payload.sleep_mode ?? payload.sleep),
    speed: Number.isFinite(speed) ? Math.max(0, Math.min(6, Math.round(speed))) : 0,
    timerHours: Number(payload.timer_hours ?? payload.timer ?? 0),
    timerElapsedMins: Number(payload.timer_time_elapsed_mins ?? 0),
    brightness: brightnessValue === undefined ? undefined : Number(brightnessValue),
    color: typeof colorValue === 'string' ? normalizeColorMode(colorValue) : undefined,
  };
}

function normalizeColorMode(value: string): ColorMode | undefined {
  const lower = value.toLowerCase();
  if (lower === 'warm' || lower === 'cool' || lower === 'daylight') return lower;
  return undefined;
}
