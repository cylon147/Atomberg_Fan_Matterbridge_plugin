import { describe, expect, it } from '@jest/globals';

import { decodeAtombergPayload } from '../src/udpDiscovery.ts';

describe('Atomberg UDP discovery', () => {
  it('decodes plain JSON payloads', () => {
    const payload = decodeAtombergPayload(Buffer.from('{"device_id":"dev-1","power":true,"last_recorded_speed":2}'));
    expect(payload).toEqual({ device_id: 'dev-1', power: true, last_recorded_speed: 2 });
  });

  it('decodes hex-encoded JSON payloads', () => {
    const json = '{"device_id":"dev-2","power":false}';
    const payload = decodeAtombergPayload(Buffer.from(Buffer.from(json, 'utf8').toString('hex')));
    expect(payload).toEqual({ device_id: 'dev-2', power: false });
  });

  it('returns null for invalid payloads', () => {
    expect(decodeAtombergPayload(Buffer.from('not-json'))).toBeNull();
  });
});
