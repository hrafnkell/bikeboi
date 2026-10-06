import { describe, expect, test } from 'bun:test';
import { GROSS_EFFICIENCY, kcalFromJoules } from '../src/ride/energy.ts';
import { buildCircuit } from '../src/ride/circuit.ts';
import { RideSim, STEP } from '../src/ride/sim.ts';

describe('energy', () => {
  test('an hour at 200 W is about 717 kcal', () => {
    const joules = 200 * 3600;
    expect(kcalFromJoules(joules)).toBeCloseTo(720000 / 4184 / GROSS_EFFICIENCY, 6);
    expect(Math.round(kcalFromJoules(joules))).toBe(717);
  });

  test('nothing burned for zero, negative or bad input', () => {
    expect(kcalFromJoules(0)).toBe(0);
    expect(kcalFromJoules(-5)).toBe(0);
    expect(kcalFromJoules(NaN)).toBe(0);
  });

  test('the sim accumulates work only while riding', () => {
    const flat = buildCircuit({
      id: 'f', name: 'f', description: '', seed: 1, scene: 'day', length: 500, points: [[0, 0], [250, 0]],
    });
    const sim = new RideSim(flat, 84);
    for (let i = 0; i < 50; i++) sim.step(0);
    expect(sim.work).toBe(0);
    for (let i = 0; i < 60 / STEP; i++) sim.step(250);
    expect(sim.work).toBeCloseTo(250 * 60, 6);
    const before = sim.work;
    for (let i = 0; i < 20; i++) sim.step(0); // coasting adds no work
    expect(sim.work).toBe(before);
  });
});
