import { describe, expect, test } from 'bun:test';
import { createEdgeDetector, decodeClickMessage } from '../src/ble/click.ts';

const bytes = (...xs: number[]) => new Uint8Array(xs);

// 0x37, then protobuf: field 1 (tag 0x08) = plus, field 2 (tag 0x10) = minus; 0 = pressed, 1 = released
const PLUS_PRESSED = bytes(0x37, 0x08, 0x00, 0x10, 0x01);
const MINUS_PRESSED = bytes(0x37, 0x08, 0x01, 0x10, 0x00);
const BOTH_PRESSED = bytes(0x37, 0x08, 0x00, 0x10, 0x00);
const RELEASED = bytes(0x37, 0x08, 0x01, 0x10, 0x01);

describe('decodeClickMessage', () => {
  test('plus pressed', () => {
    expect(decodeClickMessage(PLUS_PRESSED)).toEqual({ type: 'buttons', plus: true, minus: false });
  });

  test('minus pressed', () => {
    expect(decodeClickMessage(MINUS_PRESSED)).toEqual({ type: 'buttons', plus: false, minus: true });
  });

  test('both pressed', () => {
    expect(decodeClickMessage(BOTH_PRESSED)).toEqual({ type: 'buttons', plus: true, minus: true });
  });

  test('both released', () => {
    expect(decodeClickMessage(RELEASED)).toEqual({ type: 'buttons', plus: false, minus: false });
  });

  test('fields in either order, unknown fields skipped', () => {
    // minus first, then an unknown varint field 3 and a length-delimited field 4, then plus
    const msg = bytes(0x37, 0x10, 0x00, 0x18, 0x96, 0x01, 0x22, 0x02, 0xaa, 0xbb, 0x08, 0x01);
    expect(decodeClickMessage(msg)).toEqual({ type: 'buttons', plus: false, minus: true });
  });

  test('a missing field counts as released', () => {
    expect(decodeClickMessage(bytes(0x37, 0x08, 0x00))).toEqual({ type: 'buttons', plus: true, minus: false });
    expect(decodeClickMessage(bytes(0x37))).toEqual({ type: 'buttons', plus: false, minus: false });
  });

  test('idle', () => {
    expect(decodeClickMessage(bytes(0x15))).toEqual({ type: 'idle' });
  });

  test('battery', () => {
    expect(decodeClickMessage(bytes(0x19, 0x08, 0x57))).toEqual({ type: 'battery', level: 87 });
  });

  test('truncated battery message is unknown', () => {
    expect(decodeClickMessage(bytes(0x19, 0x08))).toEqual({ type: 'unknown' });
  });

  test('empty and unrecognised messages are unknown', () => {
    expect(decodeClickMessage(bytes())).toEqual({ type: 'unknown' });
    expect(decodeClickMessage(bytes(0xff, 0x05, 0x00))).toEqual({ type: 'unknown' });
    // the handshake echo starts with "RideOn"
    expect(decodeClickMessage(new TextEncoder().encode('RideOn\x01\x03'))).toEqual({ type: 'unknown' });
  });

  test('malformed protobuf is unknown, not a press', () => {
    expect(decodeClickMessage(bytes(0x37, 0x08))).toEqual({ type: 'unknown' }); // tag without value
    expect(decodeClickMessage(bytes(0x37, 0x08, 0x80))).toEqual({ type: 'unknown' }); // unterminated varint
    expect(decodeClickMessage(bytes(0x37, 0x22, 0x09, 0x01))).toEqual({ type: 'unknown' }); // length past the end
    expect(decodeClickMessage(bytes(0x37, 0x0b))).toEqual({ type: 'unknown' }); // unsupported wire type
  });

  test('reads from a view into a larger buffer', () => {
    const backing = bytes(0xee, 0xee, 0x37, 0x08, 0x00, 0x10, 0x01, 0xee);
    const view = new Uint8Array(backing.buffer, 2, 5);
    expect(decodeClickMessage(view)).toEqual({ type: 'buttons', plus: true, minus: false });
  });
});

describe('createEdgeDetector', () => {
  const state = (plus: boolean, minus: boolean) => ({ plus, minus });

  test('fires once per press while frames repeat', () => {
    const detect = createEdgeDetector();
    expect(detect(state(true, false))).toEqual(['plus']);
    expect(detect(state(true, false))).toEqual([]);
    expect(detect(state(true, false))).toEqual([]);
    expect(detect(state(false, false))).toEqual([]);
    expect(detect(state(true, false))).toEqual(['plus']);
  });

  test('tracks the two buttons independently', () => {
    const detect = createEdgeDetector();
    expect(detect(state(false, true))).toEqual(['minus']);
    expect(detect(state(true, true))).toEqual(['plus']);
    expect(detect(state(true, false))).toEqual([]);
    expect(detect(state(true, true))).toEqual(['minus']);
  });

  test('both pressed in one frame gives both events', () => {
    const detect = createEdgeDetector();
    expect(detect(state(true, true))).toEqual(['plus', 'minus']);
  });

  test('released frames give nothing', () => {
    const detect = createEdgeDetector();
    expect(detect(state(false, false))).toEqual([]);
    expect(detect(state(false, false))).toEqual([]);
  });

  test('decoded frames drive it end to end', () => {
    const detect = createEdgeDetector();
    const frames = [RELEASED, PLUS_PRESSED, PLUS_PRESSED, RELEASED, MINUS_PRESSED, MINUS_PRESSED, RELEASED];
    const presses = frames.flatMap((frame) => {
      const msg = decodeClickMessage(frame);
      return msg.type === 'buttons' ? detect(msg) : [];
    });
    expect(presses).toEqual(['plus', 'minus']);
  });
});
