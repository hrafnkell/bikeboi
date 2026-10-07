import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../server/http.ts';
import * as v from '../../server/validate.ts';
import { fakeFit } from './helpers.ts';

function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
  return 0;
}

describe('validators', () => {
  test('email and password', () => {
    expect(v.email('  Foo@Example.COM ')).toBe('foo@example.com');
    for (const bad of ['', 'nope', 'a@b', 42, 'a b@c.d', 'x'.repeat(251) + '@a.b']) expect(status(() => v.email(bad))).toBe(400);
    expect(v.password('12345678')).toBe('12345678');
    expect(status(() => v.password('1234567'))).toBe(400);
    expect(status(() => v.password('x'.repeat(201)))).toBe(400);
    expect(status(() => v.password(null))).toBe(400);
  });

  test('timestamp is capped at a little past now', () => {
    expect(v.timestamp(1000, 5000)).toBe(1000);
    expect(v.timestamp(1e15, 5000)).toBe(5000 + 5 * 60 * 1000);
    expect(status(() => v.timestamp(-1))).toBe(400);
    expect(status(() => v.timestamp('soon'))).toBe(400);
  });

  test('ids', () => {
    expect(v.circuitId('rollers')).toBe('rollers');
    expect(status(() => v.circuitId('Rollers!'))).toBe(400);
    expect(v.segmentId(undefined)).toBe('');
    expect(v.segmentId('climb-12')).toBe('climb-12');
    expect(status(() => v.segmentId('climb'))).toBe(400);
    expect(v.workoutId('custom:ab12cd')).toBe('custom:ab12cd');
    expect(status(() => v.workoutId('builtin:x'))).toBe(400);
  });

  test('traces must be well formed', () => {
    const good = { lapTime: 100, t: [0, 50, 100], d: [0, 500, 1000] };
    expect(v.trace(good)).toEqual(good);
    expect(status(() => v.trace({ lapTime: 100, t: [1, 100], d: [0, 1000] }))).toBe(400); // not from zero
    expect(status(() => v.trace({ lapTime: 100, t: [0, 60, 50], d: [0, 500, 1000] }))).toBe(400); // backwards
    expect(status(() => v.trace({ lapTime: 90, t: [0, 100], d: [0, 1000] }))).toBe(400); // end mismatch
    expect(status(() => v.trace({ lapTime: 100, t: [0, NaN], d: [0, 1] }))).toBe(400);
    const n = 20_001;
    expect(status(() => v.trace({ lapTime: n - 1, t: Array.from({ length: n }, (_, i) => i), d: Array.from({ length: n }, (_, i) => i) }))).toBe(400);
    expect(status(() => v.trace('x'))).toBe(400);
  });

  test('workouts', () => {
    expect(v.workoutName('  Hills  ')).toBe('Hills');
    expect(status(() => v.workoutName(''))).toBe(400);
    expect(status(() => v.workoutName('x'.repeat(61)))).toBe(400);
    expect(v.workoutText('- 10m 75%')).toBe('- 10m 75%');
    expect(() => v.workoutText('- 2km 75%')).toThrow(/^Line 1: /);
    expect(status(() => v.workoutText('- 10m 75%\n'.repeat(900)))).toBe(400);
  });

  test('ride pieces', () => {
    expect(v.fitFilename('bikeboi-rollers-2026-10-07-0900.fit')).toBeTruthy();
    for (const bad of ['../x.fit', 'ride.FIT', 'r.txt', 'x'.repeat(80) + '.fit']) expect(status(() => v.fitFilename(bad))).toBe(400);
    const summary = { durationS: 1, distanceM: 2, avgPower: 3, maxPower: 4, avgHeartRate: 0, avgCadence: 6, avgSpeed: 7, ascentM: 8, calories: 9, laps: 1, extra: 'dropped' };
    expect(Object.keys(v.rideSummary(summary))).not.toContain('extra');
    expect(status(() => v.rideSummary({ ...summary, laps: -1 }))).toBe(400);
    expect(status(() => v.rideSummary({ ...summary, avgPower: 'lots' }))).toBe(400);
    expect(v.rideMeta(undefined)).toEqual({});
    expect(status(() => v.rideMeta({ big: 'x'.repeat(5000) }))).toBe(400);
    expect(v.fitBytes(fakeFit()).length).toBe(200);
    expect(status(() => v.fitBytes(new Uint8Array(50)))).toBe(400);
    const notFit = fakeFit();
    notFit[8] = 0x41;
    expect(status(() => v.fitBytes(notFit))).toBe(400);
    expect(status(() => v.fitBytes(fakeFit(2 * 1024 * 1024 + 1)))).toBe(413);
  });
});
