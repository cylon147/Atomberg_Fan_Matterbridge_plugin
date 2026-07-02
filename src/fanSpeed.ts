import { FanControl } from 'matterbridge/matter/clusters';

/** Atomberg fans expose six discrete speed levels (1–5 plus boost). */
export const ATOMBERG_MAX_SPEED = 6;

/** How long to ignore stale UDP state after a Matter control command. */
export const CONTROL_PENDING_MS = 4_000;

export function clampAtombergSpeed(speed: number): number {
  if (speed <= 0) return 0;
  return Math.max(1, Math.min(ATOMBERG_MAX_SPEED, Math.round(speed)));
}

/** Matter FanControl percent mapping: speed / speedMax * 100. */
export function atombergSpeedToPercent(speed: number): number {
  if (speed <= 0) return 0;
  return Math.round((clampAtombergSpeed(speed) / ATOMBERG_MAX_SPEED) * 100);
}

/** Map a Home percent slider value to the nearest Atomberg speed level (1–6). */
export function percentToAtombergSpeed(percent: number): number {
  if (percent <= 0) return 0;
  return Math.max(1, Math.min(ATOMBERG_MAX_SPEED, Math.round((percent / 100) * ATOMBERG_MAX_SPEED)));
}

export function fanModeToAtombergSpeed(mode: FanControl.FanMode): number {
  if (mode === FanControl.FanMode.Off) return 0;
  if (mode === FanControl.FanMode.Low) return 1;
  if (mode === FanControl.FanMode.Medium) return 3;
  if (mode === FanControl.FanMode.High || mode === FanControl.FanMode.On) return ATOMBERG_MAX_SPEED;
  return 3;
}

export function atombergSpeedToFanMode(speed: number): FanControl.FanMode {
  if (speed <= 0) return FanControl.FanMode.Off;
  if (speed <= 1) return FanControl.FanMode.Low;
  if (speed <= 3) return FanControl.FanMode.Medium;
  return FanControl.FanMode.High;
}

export function expectedSpeedAfterCommand(
  control: Record<string, unknown>,
  currentSpeed = 0,
): number | undefined {
  const atombergCommand = buildAtombergUdpCommand(control, currentSpeed);
  if (!atombergCommand) return undefined;
  if (atombergCommand.power === false) return 0;
  if (typeof atombergCommand.speed === 'number') return clampAtombergSpeed(atombergCommand.speed);
  if (typeof atombergCommand.speedDelta === 'number') {
    return clampAtombergSpeed(currentSpeed + atombergCommand.speedDelta);
  }
  if (atombergCommand.power === true) return currentSpeed > 0 ? currentSpeed : 1;
  return undefined;
}

/**
 * Build a flat Atomberg UDP command for port 5600.
 * Speed changes use `{ speed: N }` only — bundling `power` breaks speed on some firmware.
 */
export function buildAtombergUdpCommand(
  control: Record<string, unknown>,
  currentSpeed = 0,
): Record<string, unknown> | null {
  const type = typeof control.type === 'string' ? control.type : '';

  if (type === 'fanMode') {
    const speed = fanModeToAtombergSpeed(control.value as FanControl.FanMode);
    if (speed <= 0) return { power: false };
    return { speed };
  }

  if (type === 'percentSetting') {
    const value = control.value;
    if (value === null) return { speed: clampAtombergSpeed(currentSpeed) || 1 };
    if (typeof value === 'number') {
      const speed = percentToAtombergSpeed(value);
      if (speed <= 0) return { power: false };
      return { speed };
    }
  }

  if (type === 'speedSetting') {
    const value = control.value;
    if (typeof value === 'number') {
      if (value <= 0) return { power: false };
      return { speed: clampAtombergSpeed(value) };
    }
  }

  if (type === 'step') {
    const request = control.value as { direction?: number };
    if (request?.direction === FanControl.StepDirection.Increase) return { speedDelta: 1 };
    if (request?.direction === FanControl.StepDirection.Decrease) return { speedDelta: -1 };
  }

  return null;
}
