import { describe, expect, test } from 'bun:test';
import {
  TraceRecorder, distanceAt, gapSeconds, ghostLapDistance, isGhostTrace, timeAt,
} from '../src/ride/ghost.ts';

function steady(lapTime: number, length: number) {
  const rec = new TraceRecorder();
  for (let t = 1; t < lapTime; t++) rec.sample(t, (t / lapTime) * length);
  return rec.finish(lapTime, length);
}

describe('ghost', () => {
  test('trace starts at zero and ends exactly at the lap', () => {
    const g = steady(100.4, 1000);
    expect(g.t[0]).toBe(0);
    expect(g.d[0]).toBe(0);
    expect(g.t[g.t.length - 1]).toBe(100.4);
    expect(g.d[g.d.length - 1]).toBe(1000);
    expect(isGhostTrace(g)).toBe(true);
  });

  test('interpolates distance and time both ways', () => {
    const g = steady(100, 1000);
    expect(distanceAt(g, 50)).toBeCloseTo(500, 6);
    expect(distanceAt(g, 12.5)).toBeCloseTo(125, 6);
    expect(distanceAt(g, -5)).toBe(0);
    expect(distanceAt(g, 500)).toBe(1000);
    expect(timeAt(g, 250)).toBeCloseTo(25, 6);
    expect(timeAt(g, 1000)).toBe(100);
  });

  test('ghost rides on into another lap', () => {
    const g = steady(100, 1000);
    expect(ghostLapDistance(g, 30)).toBeCloseTo(300, 6);
    expect(ghostLapDistance(g, 130)).toBeCloseTo(1300, 6);
  });

  test('gap is positive when behind the ghost', () => {
    const g = steady(100, 1000);
    expect(gapSeconds(g, 60, 500)).toBeCloseTo(10, 6);
    expect(gapSeconds(g, 40, 500)).toBeCloseTo(-10, 6);
  });

  test('handles a stop mid-lap and out-of-order samples', () => {
    const rec = new TraceRecorder();
    rec.sample(1, 10);
    rec.sample(2, 20);
    rec.sample(3, 20);
    rec.sample(3, 99); // same time: ignored
    rec.sample(4, 15); // distance never goes backwards
    rec.sample(5, 40);
    const g = rec.finish(6, 50);
    expect(g.d).toEqual([0, 10, 20, 20, 20, 40, 50]);
    expect(Number.isFinite(timeAt(g, 20))).toBe(true);
    expect(distanceAt(g, 3.5)).toBe(20);
  });

  test('rejects malformed stored traces', () => {
    expect(isGhostTrace(null)).toBe(false);
    expect(isGhostTrace({ lapTime: 10, t: [0, 10], d: [0] })).toBe(false);
    expect(isGhostTrace({ lapTime: 0, t: [0, 1], d: [0, 1] })).toBe(false);
    expect(isGhostTrace({ lapTime: 10, t: [0, '10'], d: [0, 5] })).toBe(false);
  });
});
