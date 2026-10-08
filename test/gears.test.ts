import { describe, expect, test } from 'bun:test';
import {
  GEAR_COUNT, GEAR_RATIOS, REFERENCE_GEAR, WHEEL_CIRCUMFERENCE, cadenceFor, clampGear, gearFactor,
  gearedSimGrade, offsetSimGrade, trainerSpeedFor,
} from '../src/ride/gears.ts';
import { MAX_CW } from '../src/ble/sim-sender.ts';
import { CRR, CW, G0 } from '../src/types.ts';

const base = {
  courseGrade: 0.03, k: 1, trainerSpeed: 6, mass: 84, crr: CRR, cw: CW, maxCw: MAX_CW,
  difficulty: 1, minGrade: -0.1, maxGrade: 0.2,
};

/** Force the trainer produces for these parameters at wheel speed vt. */
function trainerForce(p: { grade: number; crr: number; cw: number }, vt: number, m = base.mass): number {
  return m * G0 * (p.grade + p.crr) + p.cw * vt * vt;
}

/** Force the road puts on a real bike at speed v. */
function roadForce(G: number, v: number, m = base.mass): number {
  return m * G0 * (G + CRR) + CW * v * v;
}

describe('gears', () => {
  test('table is ascending and the reference gear is neutral', () => {
    expect(GEAR_COUNT).toBe(24);
    for (let i = 1; i < GEAR_COUNT; i++) expect(GEAR_RATIOS[i]).toBeGreaterThan(GEAR_RATIOS[i - 1]);
    expect(gearFactor(REFERENCE_GEAR)).toBe(1);
    expect(clampGear(-3)).toBe(0);
    expect(clampGear(99)).toBe(GEAR_COUNT - 1);
  });

  test('reference gear sends the road as it is', () => {
    for (const G of [-0.05, 0, 0.03, 0.08]) {
      const r = gearedSimGrade({ ...base, courseGrade: G });
      expect(r.grade).toBeCloseTo(G, 10);
      expect(r.crr).toBeCloseTo(CRR, 10);
      expect(r.cw).toBeCloseTo(CW, 10);
      expect(r.saturated).toBe(0);
    }
  });

  test('matches the gearing it was derived from, in every gear', () => {
    // pedalling at cadence c in gear k must feel like a real bike doing k * vt against k times the force
    for (const G of [-0.024, 0, 0.05]) {
      for (let i = 0; i < GEAR_COUNT; i++) {
        const k = gearFactor(i);
        const vt = trainerSpeedFor(70);
        const p = gearedSimGrade({ ...base, courseGrade: G, k, trainerSpeed: vt, minGrade: -9, maxGrade: 9 });
        expect(trainerForce(p, vt)).toBeCloseTo(k * roadForce(G, k * vt), 6);
      }
    }
  });

  test('a mild descent in the top gear still resists at a sensible cadence', () => {
    // the bug report: 2.4% down, max gear, 200 W pacemaker running away
    const k = gearFactor(GEAR_COUNT - 1);
    const vt = trainerSpeedFor(65);
    const p = gearedSimGrade({ ...base, courseGrade: -0.024, k, trainerSpeed: vt });
    expect(p.saturated).toBe(0);
    expect(trainerForce(p, vt) * vt).toBeGreaterThan(180); // watts
    // and does not depend on how fast the avatar happens to be going
    expect(p.cw).toBeGreaterThan(1);
  });

  test('harder gears always feel harder at the same cadence', () => {
    // once the road is resisting at all (coasting down a hill in a low gear is free in any gear)
    for (const [G, c] of [[-0.03, 90], [0, 80], [0.05, 60]]) {
      const vt = trainerSpeedFor(c);
      let prev = -Infinity;
      let resisting = 0;
      for (let i = 0; i < GEAR_COUNT; i++) {
        const p = gearedSimGrade({ ...base, courseGrade: G, k: gearFactor(i), trainerSpeed: vt, minGrade: -9, maxGrade: 9 });
        const f = trainerForce(p, vt);
        if (prev >= 0) expect(f).toBeGreaterThan(prev);
        if (f >= 0) resisting++;
        prev = f;
      }
      expect(resisting).toBeGreaterThanOrEqual(6);
    }
  });

  test('wind resistance beyond what the trainer accepts moves into the gradient', () => {
    const k = gearFactor(GEAR_COUNT - 1);
    expect(k * k * k * CW).toBeGreaterThan(MAX_CW);
    const slow = gearedSimGrade({ ...base, courseGrade: 0, k, trainerSpeed: 2 });
    const fast = gearedSimGrade({ ...base, courseGrade: 0, k, trainerSpeed: 8 });
    expect(slow.cw).toBe(MAX_CW);
    expect(fast.grade).toBeGreaterThan(slow.grade);
    const plenty = gearedSimGrade({ ...base, courseGrade: 0, k, trainerSpeed: 8, maxCw: 9 });
    expect(plenty.cw).toBeCloseTo(k * k * k * CW, 10);
    expect(plenty.grade).toBeCloseTo(0, 10);
  });

  test('clamps and reports saturation', () => {
    expect(gearedSimGrade({ ...base, courseGrade: 0.1, k: 2.2 })).toMatchObject({ grade: 0.2, saturated: 1 });
    expect(gearedSimGrade({ ...base, courseGrade: -0.12, k: 2 })).toMatchObject({ grade: -0.1, saturated: -1 });
  });

  test('difficulty scales only the course gradient', () => {
    const half = gearedSimGrade({ ...base, courseGrade: 0.06, difficulty: 0.5 });
    expect(half.grade).toBeCloseTo(0.03, 10);
  });

  test('offset rule adds a fixed step per gear', () => {
    const o = { courseGrade: 0.02, neutralIndex: 11, stepGrade: 0.005, crr: CRR, cw: CW, difficulty: 1, minGrade: -0.1, maxGrade: 0.2 };
    expect(offsetSimGrade({ ...o, gearIndex: 11 }).grade).toBeCloseTo(0.02, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 13 }).grade).toBeCloseTo(0.03, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 0 }).grade).toBeCloseTo(-0.035, 10);
    expect(offsetSimGrade({ ...o, gearIndex: 23, courseGrade: 0.18 }).saturated).toBe(1);
    expect(offsetSimGrade({ ...o, gearIndex: 5 })).toMatchObject({ crr: CRR, cw: CW });
  });

  test('cadence and trainer speed are inverses in the reference gear', () => {
    expect(cadenceFor(0, 5)).toBe(0);
    expect(cadenceFor(8, 11)).toBeCloseTo((8 / (2.4 * 2.105)) * 60, 6);
    expect(cadenceFor(8, 12)).toBeLessThan(cadenceFor(8, 11));
    expect(trainerSpeedFor(-5)).toBe(0);
    expect(cadenceFor(trainerSpeedFor(80), REFERENCE_GEAR)).toBeCloseTo(80, 10);
    expect(trainerSpeedFor(60)).toBeCloseTo(GEAR_RATIOS[REFERENCE_GEAR] * WHEEL_CIRCUMFERENCE, 10);
  });
});
