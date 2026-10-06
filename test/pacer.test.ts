import { describe, expect, test } from 'bun:test';
import { buildCircuit } from '../src/ride/circuit.ts';
import { Pacer, Track } from '../src/ride/pacer.ts';
import { RideSim, STEP } from '../src/ride/sim.ts';

const flat = buildCircuit({
  id: 'flat', name: 'flat', description: '', seed: 1, scene: 'day', length: 2000, points: [[0, 10], [1000, 10]],
});

/** Ride both for some seconds: the rider at one power, the pacemaker stepping whenever the rider's clock runs. */
function rideTogether(riderPower: number, pacerPower: number, seconds: number) {
  const pacer = new Pacer(flat, 84, pacerPower);
  const track = new Track();
  const sim = new RideSim(flat, 84, undefined, (s) => {
    track.add(s.time, s.distance);
    pacer.step();
  });
  for (let i = 0; i < Math.round(seconds / STEP); i++) sim.step(riderPower);
  return { sim, pacer, track };
}

describe('track', () => {
  test('answers when a distance was reached, and null if not yet', () => {
    const t = new Track();
    for (let s = 1; s <= 10; s++) t.add(s, s * 8);
    expect(t.timeAt(0)).toBe(0);
    expect(t.timeAt(40)).toBeCloseTo(5, 6);
    expect(t.timeAt(44)).toBeCloseTo(5.5, 6);
    expect(t.timeAt(80)).toBeCloseTo(10, 6);
    expect(t.timeAt(81)).toBeNull();
  });

  test('keeps one point a second and survives a stop', () => {
    const t = new Track();
    t.add(0.2, 1);
    t.add(0.4, 2); // too soon: dropped
    t.add(1, 5);
    t.add(2, 5);
    t.add(3, 5);
    t.add(4, 9);
    expect(t.timeAt(5)).toBe(1);
    expect(t.timeAt(7)).toBeCloseTo(3.5, 6);
  });
});

describe('pacemaker', () => {
  test('matching its power keeps you level with it', () => {
    const { sim, pacer, track } = rideTogether(200, 200, 120);
    expect(pacer.distance).toBeCloseTo(sim.distance, 6);
    const gap = pacer.gap(sim.distance, track, sim.time);
    expect(Math.abs(gap.metres)).toBeLessThan(1e-6);
    expect(Math.abs(gap.seconds)).toBeLessThan(0.01);
  });

  test('riding below its power leaves you behind, by a growing positive gap', () => {
    const early = rideTogether(150, 220, 60);
    const late = rideTogether(150, 220, 180);
    const g1 = early.pacer.gap(early.sim.distance, early.track, early.sim.time);
    const g2 = late.pacer.gap(late.sim.distance, late.track, late.sim.time);
    expect(g1.metres).toBeGreaterThan(0);
    expect(g1.seconds).toBeGreaterThan(0);
    expect(g2.metres).toBeGreaterThan(g1.metres);
    expect(g2.seconds).toBeGreaterThan(g1.seconds);
    // the time gap is the distance gap at roughly the pacemaker's speed
    expect(g2.seconds).toBeCloseTo(g2.metres / late.pacer.sim.speed, 0);
  });

  test('riding above its power puts you ahead, shown as a negative gap', () => {
    const { sim, pacer, track } = rideTogether(260, 180, 180);
    const gap = pacer.gap(sim.distance, track, sim.time);
    expect(gap.metres).toBeLessThan(0);
    expect(gap.seconds).toBeLessThan(0);
    expect(-gap.seconds).toBeCloseTo(-gap.metres / sim.speed, 0);
  });

  test('it waits while you are stopped', () => {
    const { sim, pacer } = rideTogether(200, 200, 60);
    const before = pacer.distance;
    for (let i = 0; i < 2000; i++) sim.step(0); // coast to a halt, then sit
    expect(sim.speed).toBe(0);
    const stopped = pacer.distance;
    for (let i = 0; i < 100; i++) sim.step(0);
    expect(pacer.distance).toBe(stopped);
    expect(stopped).toBeGreaterThan(before); // it kept riding while you were still rolling
    expect(pacer.sim.time).toBeCloseTo(sim.time, 6);
  });

  test('fast-forward puts it where it would have been', () => {
    const { pacer } = rideTogether(200, 210, 300);
    const fresh = new Pacer(flat, 84, 210);
    fresh.fastForward(300);
    expect(fresh.distance).toBeCloseTo(pacer.distance, 6);
    expect(fresh.sim.time).toBeCloseTo(300, 6);
  });

  test('render distance moves between the last two steps', () => {
    const { pacer } = rideTogether(200, 200, 30);
    expect(pacer.renderDistance(0)).toBe(pacer.sim.prevDistance);
    expect(pacer.renderDistance(1)).toBe(pacer.distance);
    expect(pacer.renderDistance(0.5)).toBeCloseTo((pacer.sim.prevDistance + pacer.distance) / 2, 9);
    expect(pacer.renderDistance(7)).toBe(pacer.distance);
  });
});
