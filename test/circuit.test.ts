import { describe, expect, test } from 'bun:test';
import { buildCircuit } from '../src/ride/circuit.ts';
import { circuits } from '../src/ride/circuits/index.ts';

describe('circuit', () => {
  test('passes through control points and closes the loop', () => {
    for (const c of circuits) {
      for (const [d, a] of c.points) expect(c.altitudeAt(d)).toBeCloseTo(a, 1);
      expect(c.altitudeAt(c.length)).toBeCloseTo(c.altitudeAt(0), 6);
      expect(c.altitudeAt(c.length * 3 + 123)).toBeCloseTo(c.altitudeAt(123), 6);
      expect(c.altitudeAt(-50)).toBeCloseTo(c.altitudeAt(c.length - 50), 6);
    }
  });

  test('never overshoots the control points', () => {
    for (const c of circuits) {
      const lo = Math.min(...c.points.map((p) => p[1]));
      const hi = Math.max(...c.points.map((p) => p[1]));
      expect(c.minAltitude).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(c.maxAltitude).toBeLessThanOrEqual(hi + 1e-6);
    }
  });

  test('gradients are rideable and continuous across the lap line', () => {
    for (const c of circuits) {
      expect(c.maxGrade).toBeLessThan(0.16);
      expect(Math.abs(c.gradeAt(c.length - 0.01) - c.gradeAt(0.01))).toBeLessThan(0.002);
    }
    const [harbour, rollers, flats, wall] = circuits;
    expect(harbour.maxGrade).toBeLessThan(0.02);
    expect(flats.maxGrade).toBeLessThan(0.01);
    expect(rollers.maxGrade).toBeGreaterThan(0.04);
    expect(wall.maxGrade).toBeGreaterThan(0.07);
  });

  test('gradient matches the altitude slope', () => {
    const c = circuits[1];
    for (const d of [300, 1200, 2900, 4700]) {
      const numeric = (c.altitudeAt(d + 10) - c.altitudeAt(d - 10)) / 20;
      expect(c.gradeAt(d)).toBeCloseTo(numeric, 2);
    }
  });

  test('ascent per lap is the sum of the climbs', () => {
    const c = buildCircuit({
      id: 't', name: 't', description: '', seed: 1, group: 'short', scene: 'day', length: 1000,
      points: [[0, 0], [500, 20]],
    });
    expect(c.ascent).toBeCloseTo(20, 1);
  });

  test('rejects malformed definitions', () => {
    const base = { id: 'x', name: 'x', description: '', seed: 1, group: 'short' as const, scene: 'day' as const, length: 1000 };
    expect(() => buildCircuit({ ...base, points: [[0, 0]] })).toThrow();
    expect(() => buildCircuit({ ...base, points: [[10, 0], [500, 5]] })).toThrow();
    expect(() => buildCircuit({ ...base, points: [[0, 0], [1000, 5]] })).toThrow();
  });
});
