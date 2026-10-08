import { describe, expect, test } from 'bun:test';
import { buildCircuit } from '../src/ride/circuit.ts';
import { circuits } from '../src/ride/circuits/index.ts';
import type { GhostTrace } from '../src/ride/ghost.ts';
import { SegmentTracker, describeSegment } from '../src/ride/segments.ts';
import type { BestStore, SegmentEffort } from '../src/ride/segments.ts';

const def = { id: 't', name: 't', description: '', seed: 1, group: 'short' as const, scene: 'day' as const };

function memoryStore(): BestStore & { saved: Map<string, GhostTrace> } {
  const saved = new Map<string, GhostTrace>();
  return { saved, load: (id) => saved.get(id) ?? null, save: (id, t) => void saved.set(id, t) };
}

/** Ride from `from` to `to` metres at a steady speed in 0.2 s steps. */
function ride(tracker: SegmentTracker, from: number, to: number, speed: number, t = 0): number {
  let d = from;
  while (d < to - 1e-9) {
    const next = Math.min(to, d + speed * 0.2);
    const dt = (next - d) / speed;
    tracker.update(d, next, t, t + dt);
    d = next;
    t += dt;
  }
  return t;
}

describe('segment detection', () => {
  test('one hill gives one climb and one descent with sensible bounds', () => {
    const c = buildCircuit({ ...def, length: 4000, points: [[0, 0], [1000, 0], [2000, 60], [3000, 0]] });
    expect(c.segments.map((s) => s.type)).toEqual(['climb', 'descent']);
    const [up, down] = c.segments;
    expect(up.start).toBeGreaterThan(900);
    expect(up.start + up.length).toBeLessThanOrEqual(2000);
    expect(up.gain).toBeGreaterThan(50);
    expect(up.avgGrade).toBeGreaterThan(0.05);
    expect(down.start).toBeGreaterThanOrEqual(2000);
    expect(down.gain).toBeLessThan(-50);
    expect(up.id).toBe('climb-1');
    expect(down.id).toBe('descent-1');
  });

  test('a climb across the lap line is found once and wraps', () => {
    const c = buildCircuit({ ...def, length: 3000, points: [[0, 30], [500, 60], [1500, 0], [2500, 0]] });
    const climbs = c.segments.filter((s) => s.type === 'climb');
    expect(climbs.length).toBe(1);
    expect(climbs[0].start).toBeGreaterThan(2400);
    expect(climbs[0].start + climbs[0].length).toBeGreaterThan(3000);
    expect(climbs[0].gain).toBeGreaterThan(50);
  });

  test('flat circuits have no climbs; small bumps are ignored', () => {
    const flat = buildCircuit({ ...def, length: 2000, points: [[0, 10], [500, 12], [1000, 10], [1500, 13]] });
    expect(flat.segments).toEqual([]);
  });

  test('names and sprints come from the definition', () => {
    const c = buildCircuit({
      ...def, length: 4000, points: [[0, 0], [1000, 0], [2000, 60], [3000, 0]],
      segmentNames: { climbs: ['Big One'] }, sprints: [{ name: 'Dash', start: 200, length: 300 }],
    });
    expect(c.segments.map((s) => s.name)).toEqual(['Dash', 'Big One', 'Descent 1']);
    expect(c.segments[0]).toMatchObject({ id: 'sprint-1', type: 'sprint', start: 200, length: 300 });
    expect(describeSegment(c.segments[0])).toBe('300 m');
    expect(describeSegment(c.segments[1])).toMatch(/at \d\.\d%$/);
  });

  test('every built-in circuit has segments that fit inside a lap', () => {
    for (const c of circuits) {
      expect(c.segments.length).toBeGreaterThan(0);
      const ids = new Set(c.segments.map((s) => s.id));
      expect(ids.size).toBe(c.segments.length);
      for (const s of c.segments) {
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.start).toBeLessThan(c.length);
        expect(s.length).toBeGreaterThanOrEqual(200);
        expect(s.length).toBeLessThan(c.length);
        expect(s.name).not.toMatch(/^(Climb|Descent) \d/);
      }
    }
    const wall = circuits.find((c) => c.id === 'wall')!;
    expect(wall.segments.map((s) => s.name)).toEqual(['The Wall', 'The Freefall']);
  });
});

describe('segment tracker', () => {
  const seg = { id: 'climb-1', type: 'climb' as const, name: 'Hill', start: 1000, length: 500, gain: 25, avgGrade: 0.05 };

  test('times an effort exactly, between physics steps', () => {
    const efforts: SegmentEffort[] = [];
    const store = memoryStore();
    const tracker = new SegmentTracker([seg], 4000, store, (e) => efforts.push(e));
    ride(tracker, 0, 2000, 7.3);
    expect(efforts.length).toBe(1);
    expect(efforts[0].time).toBeCloseTo(500 / 7.3, 6);
    expect(efforts[0].previousBest).toBeNull();
    expect(efforts[0].isBest).toBe(true);
    const saved = store.saved.get('climb-1')!;
    expect(saved.lapTime).toBeCloseTo(500 / 7.3, 6);
    expect(saved.d[saved.d.length - 1]).toBe(500);
  });

  test('reports progress, estimate and what is coming up', () => {
    const tracker = new SegmentTracker([seg], 4000, memoryStore());
    let t = ride(tracker, 0, 850, 10);
    expect(tracker.active(850, t)).toBeNull();
    expect(tracker.upcoming(850)).toMatchObject({ distanceTo: 150, best: null });
    expect(tracker.upcoming(700)).toBeNull();
    t = ride(tracker, 850, 1200, 10, t);
    const a = tracker.active(1200, t)!;
    expect(a.segment.id).toBe('climb-1');
    expect(a.fraction).toBeCloseTo(0.4, 6);
    expect(a.remaining).toBeCloseTo(300, 6);
    expect(a.elapsed).toBeCloseTo(20, 6);
    expect(a.estimate).toBeGreaterThan(45);
    expect(a.estimate).toBeLessThan(60);
    expect(a.gap).toBeNull();
    expect(tracker.upcoming(1200)).toBeNull();
    t = ride(tracker, 1200, 1600, 10, t);
    expect(tracker.active(1600, t)).toBeNull();
  });

  test('second lap is compared against the first, and only a faster one becomes the best', () => {
    const efforts: SegmentEffort[] = [];
    const store = memoryStore();
    const tracker = new SegmentTracker([seg], 4000, store, (e) => efforts.push(e));
    let t = ride(tracker, 0, 4000, 10); // lap 1: 50 s
    t = ride(tracker, 4000, 5250, 8, t); // lap 2, slower, half way up
    const a = tracker.active(5250, t)!;
    expect(a.best).toBeCloseTo(50, 6);
    expect(a.gap).toBeCloseTo(250 / 8 - 25, 1);
    t = ride(tracker, 5250, 8000, 8, t);
    t = ride(tracker, 8000, 12000, 12.5, t); // lap 3, faster
    expect(efforts.map((e) => e.isBest)).toEqual([true, false, true]);
    expect(efforts[1].previousBest).toBeCloseTo(50, 6);
    expect(efforts[2].time).toBeCloseTo(40, 6);
    expect(store.saved.get('climb-1')!.lapTime).toBeCloseTo(40, 6);
    expect(tracker.bestTime('climb-1')).toBeCloseTo(40, 6);
  });

  test('joining part-way through a segment does not count', () => {
    const efforts: SegmentEffort[] = [];
    const tracker = new SegmentTracker([seg], 4000, memoryStore(), (e) => efforts.push(e));
    ride(tracker, 1200, 2000, 10);
    expect(efforts).toEqual([]);
  });

  test('a segment across the lap line is timed across it', () => {
    const wrap = { ...seg, id: 'climb-2', start: 3800, length: 500 };
    const efforts: SegmentEffort[] = [];
    const tracker = new SegmentTracker([wrap], 4000, memoryStore(), (e) => efforts.push(e));
    ride(tracker, 0, 4500, 10);
    expect(efforts.length).toBe(1);
    expect(efforts[0].time).toBeCloseTo(50, 6);
  });

  test('a stored best for a different segment length is ignored', () => {
    const store = memoryStore();
    store.saved.set('climb-1', { lapTime: 30, t: [0, 30], d: [0, 900] });
    const tracker = new SegmentTracker([seg], 4000, store);
    expect(tracker.bestTime('climb-1')).toBeNull();
  });

  test('a segment starting on the line counts from a standing start', () => {
    const first = { ...seg, id: 'sprint-1', type: 'sprint' as const, start: 0, length: 300 };
    const efforts: SegmentEffort[] = [];
    const tracker = new SegmentTracker([first], 4000, memoryStore(), (e) => efforts.push(e));
    ride(tracker, 0, 400, 10);
    expect(efforts.length).toBe(1);
    expect(efforts[0].time).toBeCloseTo(30, 6);
  });
});
