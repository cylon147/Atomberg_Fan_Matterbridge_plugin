import { describe, expect, it } from 'vitest';

import { decodeAtombergStateString, extractAtombergStateJsonText, parseAtombergUdpPayload } from '../src/atomberg-state.js';

/** Full hex encoding of the official Atomberg JSON example (doc sample may be truncated). */
const OFFICIAL_HEX_STATE =
  '7b226465766963655f6964223a22613037363465356165653938222c226d6573736167655f6964223a2241636d42696a6d6f6d666e424a62486341222c2273746174655f737472696e67223a2232302c312c422c352c35302e30302c302c302c52312c323830322c312c34353134322c302c302c302c302c302e30302c302e30302c302c302c302c454e44227d';

describe('Atomberg UDP state parsing', () => {
  it('decodes the official hex-encoded state broadcast example', () => {
    const jsonText = extractAtombergStateJsonText(Buffer.from(OFFICIAL_HEX_STATE, 'utf8'));
    expect(jsonText).toContain('"device_id":"a0764e5aee98"');
    expect(jsonText).toContain('"message_id":"AcmBijmomfnBJbHcA"');

    const state = parseAtombergUdpPayload(Buffer.from(OFFICIAL_HEX_STATE, 'utf8'));
    expect(state).not.toBeNull();
    expect(state?.deviceId).toBe('a0764e5aee98');
    expect(state?.messageId).toBe('AcmBijmomfnBJbHcA');
    expect(state?.speed).toBe(4);
    expect(state?.power).toBe(true);
  });

  it('decodes state_string bit flags per Atomberg API', () => {
    const decoded = decodeAtombergStateString('20,1,B,5,50.00,0,0,R1,2802,1,45142,0,0,0,0,0.00,0.00,0,0,0,END');
    expect(decoded).toEqual({
      power: true,
      led: false,
      sleep: false,
      speed: 4,
      timerHours: 0,
      timerElapsedMins: 0,
      brightness: undefined,
      color: undefined,
    });
  });

  it('routes each broadcast by device_id independently', () => {
    const fanA = parseAtombergUdpPayload(
      Buffer.from(
        JSON.stringify({
          device_id: 'aaaaaaaaaaaa',
          message_id: 'msg-a-1',
          state_string: '20,1,B,5,50.00,0,0,R1,2802,1,45142,0,0,0,0,0.00,0.00,0,0,0,END',
        }),
      ),
    );
    const fanB = parseAtombergUdpPayload(
      Buffer.from(
        JSON.stringify({
          device_id: 'bbbbbbbbbbbb',
          message_id: 'msg-b-1',
          state_string: '10,1,B,2,50.00,0,0,R1,2802,1,45142,0,0,0,0,0.00,0.00,0,0,0,END',
        }),
      ),
    );

    expect(fanA?.deviceId).toBe('aaaaaaaaaaaa');
    expect(fanB?.deviceId).toBe('bbbbbbbbbbbb');
    expect(fanA?.speed).toBe(4);
    expect(fanB?.speed).toBe(2);
    expect(fanA?.deviceId).not.toBe(fanB?.deviceId);
  });

  it('ignores short beacon packets that are not state JSON', () => {
    const beacon = Buffer.from('a0764e5aee98R1', 'utf8');
    expect(parseAtombergUdpPayload(beacon)).toBeNull();
  });
});
