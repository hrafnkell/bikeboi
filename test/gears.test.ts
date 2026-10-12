import { describe, expect, test } from 'bun:test';
import {
  GEAR_COUNT, GEAR_RATIOS, REFERENCE_GEAR, RatioEstimator, WHEEL_CIRCUMFERENCE, cadenceFor, clampGear, gearFactor,
  gearedSimGrade, offsetSimGrade, physicalRatio, trainerSpeedFor,
} from '../src/ride/gears.ts';
import { CRR, CW, G0 } from '../src/types.ts';

const base = {
  courseGrade: 0.03, k: 1, trainerSpeed: 6, mass: 84, crr: CRR, cw: CW,
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
    expect(GEAR_COUNT).toBe(27);
    expect(GEAR_RATIOS[REFERENCE_GEAR]).toBe(2.4);
    for (let i = 1; i < GEAR_COUNT; i++) expect(GEAR_RATIOS[i]).toBeGreaterThan(GEAR_RATIOS[i - 1]);
    expect(gearFactor(REFERENCE_GEAR)).toBe(1);
    expect(clampGear(-3)).toBe(0);
    expect(clampGear(99)).toBe(GEAR_COUNT - 1);
  });

  test('in the physical gear itself the road is sent as it is, plus the aero the trainer will not do', () => {
    for (const G of [-0.05, 0, 0.03, 0.08]) {
      const r = gearedSimGrade({ ...base, courseGrade: G });
      expect(r.grade).toBeCloseTo(G + (CW * 36) / (base.mass * G0), 10);
      expect(r.crr).toBeCloseTo(CRR, 10);
      expect(r.cw).toBe(0);
      expect(r.saturated).toBe(0);
    }
    expect(gearedSimGrade({ ...base, courseGrade: 0.03, trainerSpeed: 0 }).grade).toBeCloseTo(0.03, 10);
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
    // the aero part is in the gradient, where the trainer will actually apply it
    expect(p.grade).toBeGreaterThan(0);
    expect(p.cw).toBe(0);
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

  test('the physical gear is read from wheel speed and cadence', () => {
    // 84 rpm at 35.2 km/h was a 50/15-ish 3.3, not the 2.4 we used to assume
    expect(physicalRatio(35.2 / 3.6, 84)).toBeCloseTo(3.32, 1);
    expect(physicalRatio(0, 84)).toBeNull();
    expect(physicalRatio(9, 10)).toBeNull();
    expect(physicalRatio(50, 60)).toBeNull(); // nonsense ratio
    const est = new RatioEstimator();
    expect(est.ratio).toBe(2.4);
    for (let i = 0; i < 6; i++) est.update(9.78, 84);
    expect(est.ratio).toBeCloseTo(3.32, 1);
    est.update(0, 0); // nothing from a stopped wheel
    expect(est.ratio).toBeCloseTo(3.32, 1);
  });

  test('a bigger physical gear makes the same virtual gear lighter per unit of wheel speed, so the feel is unchanged', () => {
    // same virtual ratio, same cadence: the pedal force must come out the same whatever the chainring
    const virtual = 2.4;
    const G = 0.03;
    const forceAtPedal = (physical: number) => {
      const vt = trainerSpeedFor(85, physical);
      const p = gearedSimGrade({ ...base, courseGrade: G, k: virtual / physical, trainerSpeed: vt, minGrade: -9, maxGrade: 9 });
      return trainerForce(p, vt) * physical; // pedal torque ~ wheel force x ratio
    };
    expect(forceAtPedal(3.3)).toBeCloseTo(forceAtPedal(2.4), 3);
  });

  test('clamps and reports saturation', () => {
    expect(gearedSimGrade({ ...base, courseGrade: 0.1, k: 2.2 })).toMatchObject({ grade: 0.2, saturated: 1 });
    expect(gearedSimGrade({ ...base, courseGrade: -0.12, k: 2 })).toMatchObject({ grade: -0.1, saturated: -1 });
  });

  test('difficulty scales only the course gradient', () => {
    const half = gearedSimGrade({ ...base, courseGrade: 0.06, difficulty: 0.5, trainerSpeed: 0 });
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
    expect(cadenceFor(8, REFERENCE_GEAR)).toBeCloseTo((8 / (2.4 * 2.105)) * 60, 6);
    expect(cadenceFor(8, REFERENCE_GEAR + 1)).toBeLessThan(cadenceFor(8, REFERENCE_GEAR));
    expect(trainerSpeedFor(-5)).toBe(0);
    expect(cadenceFor(trainerSpeedFor(80), REFERENCE_GEAR)).toBeCloseTo(80, 10);
    expect(trainerSpeedFor(60)).toBeCloseTo(GEAR_RATIOS[REFERENCE_GEAR] * WHEEL_CIRCUMFERENCE, 10);
  });
});
