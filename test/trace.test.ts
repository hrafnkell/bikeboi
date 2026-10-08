import { describe, expect, test } from 'bun:test';
import { decodeTrace, encodeTrace, recordSamples } from '../src/ride/trace.ts';
import type { RideSample } from '../src/types.ts';

const sample = (i: number, extra: Partial<RideSample> = {}): RideSample => ({
  timestamp: 1_700_000_000_000 + i * 1000, power: 200, cadence: 85, speed: 8, heartRate: 150,
  distance: i * 8, altitude: 10, grade: 2, ...extra,
});

describe('ride trace', () => {
  test('round-trips one entry per record, compactly', () => {
    const samples: RideSample[] = [];
    for (let i = 0; i < 600; i++) {
      samples.push(sample(i, { gear: i < 300 ? 15 : 16, wheelSpeed: 7.5 + (i % 3) * 0.1, sentGrade: i < 300 ? 2.2 : undefined, target: i < 300 ? undefined : 220 }));
    }
    samples.push(sample(599)); // a second sample in the same second is not a record
    const enc = encodeTrace(samples)!;
    expect(enc.gear).toEqual([[15, 300], [16, 300]]);
    expect(enc.wheel.length).toBe(600);
    expect(JSON.stringify(enc).length).toBeLessThan(4000);
    const dec = decodeTrace(JSON.parse(JSON.stringify(enc)))!;
    expect(dec.gear.length).toBe(600);
    expect(dec.gear[299]).toBe(15);
    expect(dec.gear[300]).toBe(16);
    expect(dec.wheelSpeed[1]).toBeCloseTo(7.6, 1);
    expect(dec.sentGrade[0]).toBeCloseTo(2.2, 6);
    expect(dec.sentGrade[300]).toBeNull();
    expect(dec.target[0]).toBeNull();
    expect(dec.target[300]).toBe(220);
    expect(recordSamples(samples).length).toBe(600);
  });

  test('rides without diagnostics have no trace, and junk decodes to null', () => {
    expect(encodeTrace([sample(0), sample(1)])).toBeNull();
    expect(decodeTrace(null)).toBeNull();
    expect(decodeTrace({ v: 2 })).toBeNull();
    expect(decodeTrace({ v: 1, gear: [], wheel: [], sent: [], target: [] })).toEqual({ gear: [], wheelSpeed: [], sentGrade: [], target: [] });
  });
});
