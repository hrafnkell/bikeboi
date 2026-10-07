import { describe, expect, test } from 'bun:test';
import { readFitTrack } from '../src/ride/fit-read.ts';
import { Recorder } from '../src/ride/recorder.ts';
import { createMemoryRideStore } from '../src/ride/ride-store.ts';

describe('reading a FIT back', () => {
  test('returns the per-second track with gaps in heart rate', async () => {
    const rec = new Recorder(createMemoryRideStore());
    const T0 = 1_700_000_000_000;
    rec.begin({ circuitId: 'rollers', circuitName: 'Rolling Hills', startedAt: T0 });
    for (let i = 0; i < 90; i++) {
      rec.addSample({
        timestamp: T0 + (i + 1) * 1000, power: 150 + i, cadence: 88, speed: 8, heartRate: i < 30 ? 0 : 140 + i,
        distance: (i + 1) * 8, altitude: 100 + i * 0.5, grade: 6,
      });
    }
    const done = await rec.finish(T0 + 91_000);
    const track = await readFitTrack(done.fit);
    expect(track.seconds.length).toBe(90);
    expect(track.seconds[0]).toBe(0);
    expect(track.seconds[89]).toBe(89);
    expect(track.power[0]).toBe(150);
    expect(track.power[89]).toBe(239);
    expect(track.heartRate.slice(0, 30).every((h) => h === null)).toBe(true);
    expect(track.heartRate[30]).toBe(170);
    expect(track.altitude[10]).toBeCloseTo(105, 1);
    expect(track.distance[89]).toBeCloseTo(720, 1);
  });
});
