import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AnsiLogger } from 'matterbridge/logger';

import { AtombergUdpDiscovery } from '../../src/udpDiscovery.js';

const E2E_ENABLED = process.env.ATOMBERG_E2E === '1';
const LISTEN_MS = Number(process.env.ATOMBERG_E2E_TIMEOUT_MS ?? 20_000);

const mockLog = {
  fatal: () => {},
  error: () => {},
  warn: () => {},
  notice: () => {},
  info: () => {},
  debug: () => {},
} as unknown as AnsiLogger;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFans(discovery: AtombergUdpDiscovery, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fans = discovery.getFans().filter((fan) => fan.deviceId);
    if (fans.length > 0) return;
    await sleep(500);
  }
}

describe.skipIf(!E2E_ENABLED)('Atomberg fan network E2E', () => {
  let discovery: AtombergUdpDiscovery;
  const updates: string[] = [];

  beforeAll(() => {
    discovery = new AtombergUdpDiscovery(mockLog, 5625, (status) => {
      updates.push(`${status.ipAddress}:${status.deviceId ?? 'no-id'}:power=${status.power ?? '?'}:speed=${status.speed ?? '?'}`);
    });
    discovery.start();
  });

  afterAll(() => {
    discovery.stop();
  });

  it('discovers the Atomberg fan on UDP 5625', async () => {
    await waitForFans(discovery, LISTEN_MS);

    const fans = discovery.getFans();
    expect(fans.length).toBeGreaterThanOrEqual(1);

    const fan = fans.find((entry) => entry.deviceId) ?? fans[0];
    expect(fan.ipAddress).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(fan.deviceId).toMatch(/^[0-9a-f]{12}$/);
    expect(fan.online).toBe(true);

    const byDeviceId = discovery.getFanByDeviceId(fan.deviceId!);
    expect(byDeviceId?.ipAddress).toBe(fan.ipAddress);

    console.log('E2E discovered fan:', JSON.stringify(fan, null, 2));
    console.log('E2E update events:', updates.length);
  }, LISTEN_MS + 5_000);

  it('receives state fields when the fan broadcasts JSON or state_string', async () => {
    await waitForFans(discovery, LISTEN_MS);

    const fan = discovery.getFans().find((entry) => entry.deviceId);
    expect(fan).toBeDefined();

    if (fan!.power !== undefined || fan!.speed !== undefined) {
      expect(typeof fan!.power).toBe('boolean');
      if (fan!.speed !== undefined) {
        expect(fan!.speed).toBeGreaterThanOrEqual(0);
        expect(fan!.speed).toBeLessThanOrEqual(6);
      }
      console.log('E2E live state:', { power: fan!.power, speed: fan!.speed, series: fan!.series });
      return;
    }

    console.log('E2E note: beacon-only discovery (no state broadcast yet); device_id routing verified.');
  }, LISTEN_MS + 5_000);
});

describe.skipIf(E2E_ENABLED)('Atomberg fan network E2E (skipped)', () => {
  it('runs only when ATOMBERG_E2E=1', () => {
    expect(E2E_ENABLED).toBe(false);
  });
});
