import { describe, expect, test } from 'bun:test';
import { buildCircuit } from '../src/ride/circuit.ts';
import { Recorder, recoverRide } from '../src/ride/recorder.ts';
import { resumeState } from '../src/ride/resume.ts';
import { createMemoryRideStore } from '../src/ride/ride-store.ts';
import type { SavedRide } from '../src/ride/ride-store.ts';
import { SegmentTracker } from '../src/ride/segments.ts';
import { RideSim, STEP } from '../src/ride/sim.ts';
import type { RideSample } from '../src/types.ts';

const circuit = buildCircuit({
  id: 'loop', name: 'Loop', description: '', seed: 1, group: 'short', scene: 'day', length: 1000,
  points: [[0, 0], [250, 20], [500, 0]],
});

const T0 = 1_700_000_000_000;

/** A steady 10 m/s ride: one sample per second. */
function samples(count: number, from = 0): RideSample[] {
  return Array.from({ length: count }, (_, i) => {
    const distance = (from + i + 1) * 10;
    return {
      timestamp: T0 + (from + i + 1) * 1000, power: 200 + (i % 3) * 10, cadence: 90, speed: 10, heartRate: 150,
      distance, altitude: circuit.altitudeAt(distance), grade: circuit.gradeAt(distance) * 100,
    };
  });
}

function saved(count: number): SavedRide {
  return {
    meta: { circuitId: 'loop', circuitName: 'Loop', startedAt: T0 },
    samples: samples(count),
    laps: count >= 100 ? [{ startTime: T0, endTime: T0 + 100_000 }] : [],
    events: [{ timestamp: T0, type: 'start' }],
  };
}

describe('resume state', () => {
  test('rebuilds time, distance, laps and totals from the samples', () => {
    const s = resumeState(saved(250), circuit);
    expect(s.time).toBe(250);
    expect(s.distance).toBe(2500);
    expect(s.laps.map((l) => l.number)).toEqual([1, 2]);
    expect(s.laps[0].time).toBeCloseTo(100, 6);
    expect(s.laps[1].endTime).toBeCloseTo(200, 6);
    expect(s.lapStartTime).toBeCloseTo(200, 6);
    expect(s.ascent).toBeCloseTo(60, 0); // 20 m up per lap, three times
    expect(s.work).toBe(saved(250).samples.reduce((j, x) => j + x.power, 0));
    expect(s.peak).toEqual({ power: 220, cadence: 90, heartRate: 150 });
    expect(s.lastSampleTs).toBe(T0 + 250_000);
    expect(s.lapStartWall).toBe(T0 + 100_000);
  });

  test('gives the unfinished lap so far for the ghost trace', () => {
    const s = resumeState(saved(130), circuit);
    expect(s.lapTrace.length).toBe(30);
    expect(s.lapTrace[0]).toEqual([1, 10]);
    expect(s.lapTrace[29]).toEqual([30, 300]);
    expect(s.track.length).toBe(130);
  });

  test('a short ride with no laps starts its lap at the ride start', () => {
    const s = resumeState(saved(40), circuit);
    expect(s.laps).toEqual([]);
    expect(s.lapStartTime).toBe(0);
    expect(s.lapStartWall).toBe(T0);
    expect(s.distance).toBe(400);
  });
});

describe('resuming', () => {
  test('the sim carries on from where it stopped, from a standstill', () => {
    const laps: number[] = [];
    const sim = new RideSim(circuit, 84, (lap) => laps.push(lap.number));
    sim.restore(resumeState(saved(250), circuit));
    expect(sim.distance).toBe(2500);
    expect(sim.time).toBe(250);
    expect(sim.lapIndex).toBe(2);
    expect(sim.lapDistance).toBeCloseTo(500, 6);
    expect(sim.lapTime).toBeCloseTo(50, 6);
    expect(sim.speed).toBe(0);
    expect(sim.renderDistance).toBe(2500);
    while (sim.lapIndex < 3) sim.step(250);
    expect(laps).toEqual([3]);
    expect(sim.laps.length).toBe(3);
    expect(sim.time).toBeGreaterThan(250);
    expect(sim.work).toBeGreaterThan(resumeState(saved(250), circuit).work);
    expect(Math.round((sim.time - 250) / STEP)).toBeGreaterThan(0);
  });

  test('the recorder continues the saved ride and leaves the break out of the timer', async () => {
    const store = createMemoryRideStore();
    const first = new Recorder(store);
    first.begin({ circuitId: 'loop', circuitName: 'Loop', startedAt: T0 });
    for (const s of samples(120)) first.addSample(s);
    first.addLap({ startTime: T0, endTime: T0 + 100_000 });
    await first.flush(); // the tab dies here, without a stop event

    const recovered = (await recoverRide(store))!;
    expect(recovered.samples.length).toBe(120);

    const second = new Recorder(store);
    second.resumeFrom(recovered);
    expect(second.active).toBe(true);
    expect(second.isPaused).toBe(true);
    second.addSample(samples(1, 120)[0]); // ignored while still paused
    const later = T0 + 3_600_000; // an hour's break
    second.resume(later);
    for (const s of samples(60, 120)) second.addSample({ ...s, timestamp: later + (s.timestamp - T0 - 120_000) });
    const done = await second.finish(later + 60_000);

    expect(done.ride.samples.length).toBe(180);
    expect(done.ride.laps.length).toBe(1);
    expect(done.ride.events.map((e) => e.type)).toEqual(['start', 'stop', 'start', 'stop']);
    expect(done.summary.durationS).toBeCloseTo(180, 0);
    expect(done.summary.distanceM).toBe(1800);
    expect(String.fromCharCode(...done.fit.slice(8, 12))).toBe('.FIT');
    expect(await store.load()).toBeNull();
  });

  test('a ride resumed and interrupted again can be recovered whole', async () => {
    const store = createMemoryRideStore();
    const first = new Recorder(store);
    first.begin({ circuitId: 'loop', circuitName: 'Loop', startedAt: T0 });
    for (const s of samples(30)) first.addSample(s);
    await first.flush();
    const second = new Recorder(store);
    second.resumeFrom((await recoverRide(store))!);
    second.resume(T0 + 500_000);
    for (const s of samples(20, 30)) second.addSample({ ...s, timestamp: T0 + 500_000 + (s.timestamp - T0 - 30_000) });
    await second.flush();
    const again = (await recoverRide(store))!;
    expect(again.samples.length).toBe(50);
    expect(again.events.map((e) => e.type)).toEqual(['start', 'stop', 'start', 'stop']);
  });

  test('replayed segments are listed quietly and never saved as bests', () => {
    const seg = { id: 'climb-1', type: 'climb' as const, name: 'Hill', start: 50, length: 200, gain: 20, avgGrade: 0.1 };
    const saves: string[] = [];
    const announced: string[] = [];
    const tracker = new SegmentTracker([seg], 1000, { load: () => null, save: (id) => void saves.push(id) }, (e) => announced.push(e.segment.id));
    tracker.replaying = true;
    let from: [number, number] = [0, 0];
    for (const point of resumeState(saved(130), circuit).track) {
      tracker.update(from[1], point[1], from[0], point[0]);
      from = point;
    }
    tracker.replaying = false;
    expect(tracker.efforts.length).toBe(2);
    expect(tracker.efforts.every((e) => e.restored === true && e.isBest === false)).toBe(true);
    expect(tracker.efforts[0].time).toBeCloseTo(20, 6);
    expect(saves).toEqual([]);
    expect(announced).toEqual([]);
    // riding on after the replay behaves normally
    tracker.update(1300, 2060, 130, 206);
    tracker.update(2060, 2300, 206, 230);
    expect(announced).toEqual(['climb-1']);
    expect(saves).toEqual(['climb-1']);
    expect(tracker.efforts[2].restored).toBeUndefined();
  });
});
