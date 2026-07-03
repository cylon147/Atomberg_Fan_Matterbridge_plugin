import { FanControl } from 'matterbridge/matter/clusters';
import { describe, expect, it } from 'vitest';

import {
  ATOMBERG_MAX_SPEED,
  atombergSpeedToPercent,
  buildAtombergUdpCommand,
  expectedSpeedAfterCommand,
  percentToAtombergSpeed,
} from '../src/fanSpeed.js';

describe('fanSpeed', () => {
  it('maps six Atomberg speeds using Matter speedMax formula', () => {
    expect(atombergSpeedToPercent(1)).toBe(17);
    expect(atombergSpeedToPercent(2)).toBe(33);
    expect(atombergSpeedToPercent(3)).toBe(50);
    expect(atombergSpeedToPercent(4)).toBe(67);
    expect(atombergSpeedToPercent(5)).toBe(83);
    expect(atombergSpeedToPercent(6)).toBe(100);
  });

  it('maps Home slider percentages to explicit speed levels 1-6', () => {
    expect(percentToAtombergSpeed(17)).toBe(1);
    expect(percentToAtombergSpeed(33)).toBe(2);
    expect(percentToAtombergSpeed(50)).toBe(3);
    expect(percentToAtombergSpeed(67)).toBe(4);
    expect(percentToAtombergSpeed(80)).toBe(5);
    expect(percentToAtombergSpeed(100)).toBe(6);
  });

  it('sends speed-only UDP commands for speed changes', () => {
    expect(buildAtombergUdpCommand({ type: 'percentSetting', value: 80 })).toEqual({ speed: 5 });
    expect(buildAtombergUdpCommand({ type: 'speedSetting', value: 4 })).toEqual({ speed: 4 });
    expect(buildAtombergUdpCommand({ type: 'percentSetting', value: 0 })).toEqual({ power: false });
    expect(buildAtombergUdpCommand({ type: 'fanMode', value: FanControl.FanMode.High })).toEqual({
      speed: ATOMBERG_MAX_SPEED,
    });
    expect(buildAtombergUdpCommand({ type: 'power', value: false })).toEqual({ power: false });
    expect(buildAtombergUdpCommand({ type: 'power', value: true }, 0)).toEqual({ speed: 1 });
    expect(buildAtombergUdpCommand({ type: 'power', value: true }, 4)).toEqual({ speed: 4 });
  });

  it('predicts expected speed after step commands', () => {
    expect(expectedSpeedAfterCommand({ type: 'step', value: { direction: FanControl.StepDirection.Increase } }, 2)).toBe(3);
    expect(expectedSpeedAfterCommand({ type: 'speedSetting', value: 5 })).toBe(5);
  });
});
