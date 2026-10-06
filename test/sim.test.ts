import { describe, expect, test } from 'bun:test';
import { buildCircuit } from '../src/ride/circuit.ts';
import { RideSim, STEP } from '../src/ride/sim.ts';
import type { LapResult } from '../src/ride/sim.ts';

const flat = buildCircuit({
  id: 'flat', name: 'flat', description: '', seed: 1, scene: 'day', length: 500,
  points: [[0, 10], [250, 10]],
});
const hill = buildCircuit({
  id: 'hill', name: 'hill', description: '', seed: 1, scene: 'day', length: 4000,
  points: [[0, 0], [2000, 120]],
});

function ride(sim: RideSim, seconds: number, power: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.step(power);
}

describe('ride sim', () => {
  test('stays put with no power', () => {
    const sim = new RideSim(flat, 84);
    ride(sim, 10, 0);
    expect(sim.distance).toBe(0);
    expect(sim.time).toBe(0);
    expect(sim.moving).toBe(false);
  });

  test('gets going from a standstill on low power', () => {
    const sim = new RideSim(flat, 84);
    ride(sim, 20, 20);
    expect(sim.speed).toBeGreaterThan(1);
    expect(sim.distance).toBeGreaterThan(10);
  });

  test('reaches a plausible flat speed at 200 W', () => {
    const sim = new RideSim(flat, 84);
    ride(sim, 180, 200);
    expect(sim.speed * 3.6).toBeGreaterThan(30);
    expect(sim.speed * 3.6).toBeLessThan(38);
  });

  test('climbing is slower than the flat at the same power', () => {
    const a = new RideSim(flat, 84);
    const b = new RideSim(hill, 84);
    ride(a, 120, 200);
    ride(b, 120, 200);
    expect(b.speed).toBeLessThan(a.speed * 0.6);
    expect(b.ascent).toBeGreaterThan(20);
  });

  test('coasts to a stop and the clock stops with it', () => {
    const sim = new RideSim(flat, 84);
    ride(sim, 60, 200);
    ride(sim, 600, 0);
    expect(sim.speed).toBe(0);
    const t = sim.time;
    ride(sim, 30, 0);
    expect(sim.time).toBe(t);
  });

  test('counts laps with interpolated lap times', () => {
    const laps: LapResult[] = [];
    const sim = new RideSim(flat, 84, (lap) => laps.push(lap));
    ride(sim, 400, 250);
    expect(laps.length).toBeGreaterThanOrEqual(5);
    expect(sim.lapIndex).toBe(laps.length);
    expect(laps[0].number).toBe(1);
    // flying laps at steady speed take length / speed
    const last = laps[laps.length - 1];
    expect(last.time).toBeCloseTo(flat.length / sim.speed, 1);
    // lap times add up to the time of the last crossing
    const total = laps.reduce((s, l) => s + l.time, 0);
    expect(total).toBeCloseTo(last.endTime, 6);
    expect(sim.lapDistance).toBeGreaterThanOrEqual(0);
    expect(sim.lapDistance).toBeLessThan(flat.length);
    expect(sim.bestLap!.time).toBeLessThan(laps[0].time);
  });

  test('advance runs whole steps and interpolates between them', () => {
    const sim = new RideSim(flat, 84);
    expect(sim.advance(0.5, 200)).toBe(2);
    expect(sim.advance(0.05, 200)).toBe(0);
    expect(sim.advance(0.07, 200)).toBe(1);
    expect(sim.renderDistance).toBeLessThanOrEqual(sim.distance);
    // a long frame gap is capped
    expect(sim.advance(30, 200)).toBeLessThanOrEqual(Math.ceil(1 / STEP) + 1);
  });

  test('ignores bad power values', () => {
    const sim = new RideSim(flat, 84);
    ride(sim, 5, NaN);
    ride(sim, 5, -50);
    expect(sim.distance).toBe(0);
  });
});
