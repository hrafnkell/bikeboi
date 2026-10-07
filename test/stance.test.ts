import { describe, expect, test } from 'bun:test';
import { StanceSelector, blendPosture, pickStance, postures } from '../src/game/stance.ts';

const base = { ftp: 250, speed: 7, grade: 0 };

describe('stance rules', () => {
  test('effort picks the stance', () => {
    expect(pickStance({ ...base, power: 80 })).toBe('relaxed');
    expect(pickStance({ ...base, power: 170 })).toBe('normal');
    expect(pickStance({ ...base, power: 230 })).toBe('drops');
    expect(pickStance({ ...base, power: 360 })).toBe('standing');
  });

  test('speed and gradient matter too', () => {
    expect(pickStance({ ...base, power: 170, speed: 11 })).toBe('drops'); // fast on the flat
    expect(pickStance({ ...base, power: 80, speed: 9 })).toBe('normal'); // too quick to lounge
    expect(pickStance({ ...base, power: 20, speed: 14 })).toBe('tuck'); // coasting downhill fast
    expect(pickStance({ ...base, power: 230, speed: 14 })).toBe('drops'); // pedalling hard downhill
    expect(pickStance({ ...base, power: 290, grade: 0.08, speed: 3 })).toBe('standing'); // grinding a steep pitch
    expect(pickStance({ ...base, power: 290, grade: 0.02 })).toBe('drops');
  });

  test('a silly FTP does not break the rules', () => {
    expect(pickStance({ power: 100, ftp: 0, speed: 5, grade: 0 })).toBe('standing');
  });
});

describe('stance selector', () => {
  test('holds a stance until the new one has been called for long enough', () => {
    const s = new StanceSelector();
    expect(s.update(0.1, { ...base, power: 230 })).toBe('normal');
    for (let i = 0; i < 8; i++) s.update(0.1, { ...base, power: 230 });
    expect(s.current).toBe('normal');
    s.update(0.2, { ...base, power: 230 });
    expect(s.current).toBe('drops');
  });

  test('standing comes quickly, relaxing slowly, and a blip resets the wait', () => {
    const s = new StanceSelector();
    for (let i = 0; i < 4; i++) s.update(0.1, { ...base, power: 400 });
    expect(s.current).toBe('standing');
    for (let i = 0; i < 15; i++) s.update(0.1, { ...base, power: 80 });
    expect(s.current).toBe('standing');
    s.update(0.1, { ...base, power: 400 }); // back to the current stance: the wait restarts
    for (let i = 0; i < 19; i++) s.update(0.1, { ...base, power: 80 });
    expect(s.current).toBe('standing');
    s.update(0.1, { ...base, power: 80 });
    expect(s.current).toBe('relaxed');
  });
});

describe('postures', () => {
  test('legs can still reach the pedals from every posture', () => {
    const bb = { x: 0.42, y: 0.28 };
    for (const p of Object.values(postures)) {
      const lowest = Math.hypot(bb.x - p.hip.x, bb.y - 0.17 - p.hip.y);
      expect(lowest).toBeLessThan(0.45 + 0.47 + 0.12); // thigh + shin, with the IK's own clamp
      expect(p.head.y).toBeGreaterThan(p.shoulder.y);
      expect(p.shoulder.x).toBeGreaterThan(p.hip.x);
    }
  });

  test('blending moves part of the way and clamps', () => {
    const half = blendPosture(postures.normal, postures.drops, 0.5);
    expect(half.shoulder.y).toBeCloseTo((postures.normal.shoulder.y + postures.drops.shoulder.y) / 2, 10);
    expect(blendPosture(postures.normal, postures.drops, 2)).toEqual(postures.drops);
    expect(blendPosture(postures.normal, postures.drops, -1)).toEqual(postures.normal);
  });
});
