import { describe, expect, test } from 'bun:test';
import {
  GEAR_COUNT, GEAR_RATIOS, REFERENCE_GEAR, cadenceFor, clampGear, gearFactor,
  gearedSimGrade, offsetSimGrade,
} from '../src/ride/gears.ts';
import { CRR, CW, G0 } from '../src/types.ts';

const base = {
  courseGrade: 0.03, k: 1, gameSpeed: 8, mass: 84, crr: CRR, cw: CW,
  difficulty: 1, minGrade: -0.1, maxGrade: 0.2,
};

describe('gears', () => {
  test('table is ascending and the reference gear is neutral', () => {
    expect(GEAR_COUNT).toBe(24);
    for (let i = 1; i < GEAR_COUNT; i++) expect(GEAR_RATIOS[i]).toBeGreaterThan(GEAR_RATIOS[i - 1]);
    expect(gearFactor(REFERENCE_GEAR)).toBe(1);
    expect(clampGear(-3)).toBe(0);
    expect(clampGear(99)).toBe(GEAR_COUNT - 1);
  });

  test('reference gear sends the true gradient', () => {
    for (const G of [-0.05, 0, 0.03, 0.08]) {
      const r = gearedSimGrade({ ...base, courseGrade: G });
      expect(r.grade).toBeCloseTo(G, 10);
      expect(r.saturated).toBe(0);
    }
  });

  test('harder gears always feel harder, easier gears easier', () => {
    // holds whenever the road is resisting (net force >= 0), i.e. whenever the rider is putting out power
    for (const [G, v] of [[-0.03, 14], [0, 8], [0.05, 4]]) {
      let prev = -Infinity;
      for (let i = 0; i < GEAR_COUNT; i++) {
        const r = gearedSimGrade({ ...base, courseGrade: G, gameSpeed: v, k: gearFactor(i), minGrade: -9, maxGrade: 9 });
        expect(r.grade).toBeGreaterThan(prev);
        prev = r.grade;
      }
    }
  });

  test('matches the force balance it was derived from', () => {
    // trainer force at wheel speed v/k must be k times road force at speed v
    const k = 1.4;
    const v = 9;
    const G = 0.02;
    const sent = gearedSimGrade({ ...base, courseGrade: G, k, gameSpeed: v, maxGrade: 9 }).grade;
    const m = base.mass;
    const road = m * G0 * (G + CRR) + CW * v * v;
    const vt = v / k;
    const trainer = m * G0 * (sent + CRR) + CW * vt * vt;
    expect(trainer).toBeCloseTo(k * road, 6);
  });

  test('clamps and reports saturation', () => {
    expect(gearedSimGrade({ ...base, courseGrade: 0.1, k: 2.2, gameSpeed: 12 })).toEqual({ grade: 0.2, saturated: 1 });
    expect(gearedSimGrade({ ...base, courseGrade: -0.12, k: 2 })).toEqual({ grade: -0.1, saturated: -1 });
  });

  test('difficulty scales only the course gradient', () => {
    const half = gearedSimGrade({ ...base, courseGrade: 0.06, difficulty: 0.5 });
    expect(half.grade).toBeCloseTo(0.03, 10);
  });

  test('offset rule adds a fixed step per gear', () => {
    const o = { courseGrade: 0.02, neutralIndex: 11, stepGrade: 0.005, difficulty: 1, minGrade: -0.1, maxGrade: 0.2 };
    expect(offsetSimGrade({ ...o, gearIndex: 11 }).grade).toBeCloseTo(0.02, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 13 }).grade).toBeCloseTo(0.03, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 0 }).grade).toBeCloseTo(-0.035, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 23, courseGrade: 0.18 }).saturated).toBe(1);
  });

  test('cadence follows speed and gear', () => {
    expect(cadenceFor(0, 5)).toBe(0);
    expect(cadenceFor(8, 11)).toBeCloseTo((8 / (2.4 * 2.105)) * 60, 6);
    expect(cadenceFor(8, 12)).toBeLessThan(cadenceFor(8, 11));
  });
});
