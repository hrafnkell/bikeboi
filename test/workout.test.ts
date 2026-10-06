import { describe, expect, test } from 'bun:test';
import { WorkoutPlan, describeTarget, parseDuration, parseWorkout } from '../src/ride/workout.ts';
import { builtInProblems, listWorkouts } from '../src/ride/workouts.ts';

describe('durations', () => {
  test('every documented form', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('1h2m30s')).toBe(3750);
    expect(parseDuration('5m30s')).toBe(330);
    expect(parseDuration('1m30')).toBe(90);
    expect(parseDuration("5'")).toBe(300);
    expect(parseDuration('30"')).toBe(30);
    expect(parseDuration('1\'30"')).toBe(90);
  });

  test('things that are not durations', () => {
    for (const t of ['', '75%', '220w', '500mtr', '2km', 'ramp', 'Z2', '90rpm', '10', 'm']) {
      expect(parseDuration(t)).toBeNull();
    }
  });
});

describe('parsing', () => {
  test('the intervals.icu example', () => {
    const w = parseWorkout(`- Warmup 5m 60%

Main Set 4x
- 2m 95%
- 2m 55%

- Recovery 3m 50%`);
    expect(w.errors).toEqual([]);
    expect(w.steps.length).toBe(10);
    expect(w.duration).toBe(300 + 4 * 240 + 180);
    expect(w.steps[0]).toMatchObject({ duration: 300, label: 'Warmup', target: { a: 60, b: 60, unit: 'ftp', ramp: false } });
    expect(w.steps.slice(1, 9).map((s) => s.label)).toEqual([
      'Main Set 1/4', 'Main Set 1/4', 'Main Set 2/4', 'Main Set 2/4', 'Main Set 3/4', 'Main Set 3/4', 'Main Set 4/4', 'Main Set 4/4',
    ]);
    expect(w.steps[9]).toMatchObject({ duration: 180, label: 'Recovery' });
  });

  test('the looser form with @, no dashes and a bare 3x line', () => {
    const w = parseWorkout(`Warmup
5m@150-210w

3x
10m@240w
2m@180w

Cooldown
8m@150w`);
    expect(w.errors).toEqual([]);
    expect(w.steps.map((s) => s.duration)).toEqual([300, 600, 120, 600, 120, 600, 120, 480]);
    expect(w.steps[0]).toMatchObject({ label: 'Warmup', target: { a: 150, b: 210, unit: 'w', ramp: false } });
    expect(w.steps[1].label).toBe('Set 1/3');
    expect(w.steps[7]).toMatchObject({ label: 'Cooldown', target: { a: 150, b: 150, unit: 'w' } });
  });

  test('ramps, ranges, zones, cadence and free rides', () => {
    const w = parseWorkout(`- 10m ramp 50%-75% 85rpm
- 15m ramp 65-45%
- 5m 200-240w 90-100rpm
- 20m Z2
- 8m Z3-Z4
- 20m freeride
- 3m`);
    expect(w.errors).toEqual([]);
    expect(w.steps[0]).toMatchObject({ target: { a: 50, b: 75, unit: 'ftp', ramp: true }, cadence: [85, 85] });
    expect(w.steps[1].target).toEqual({ a: 65, b: 45, unit: 'ftp', ramp: true });
    expect(w.steps[2]).toMatchObject({ target: { a: 200, b: 240, unit: 'w', ramp: false }, cadence: [90, 100] });
    expect(w.steps[3].target).toEqual({ a: 56, b: 75, unit: 'ftp', ramp: false });
    expect(w.steps[4].target).toEqual({ a: 76, b: 105, unit: 'ftp', ramp: false });
    expect(w.steps[5].target).toBeNull();
    expect(w.steps[6].target).toBeNull();
  });

  test('cues before and after the numbers, and pasted curly quotes', () => {
    const w = parseWorkout(`- Hard start 2m 110% stay seated
- 5’ 60%`);
    expect(w.errors).toEqual([]);
    expect(w.steps[0].label).toBe('Hard start stay seated');
    expect(w.steps[1].duration).toBe(300);
  });

  test('a repeat block ends at a blank line or a new header', () => {
    const w = parseWorkout(`2x
- 1m 100%
- 1m 50%
Cooldown
- 5m 50%`);
    expect(w.steps.length).toBe(5);
    expect(w.steps[4].label).toBe('Cooldown');
  });

  test('problems are reported with their line', () => {
    const w = parseWorkout(`- 10m 75%
- 2km 80%
- 5m 70% HR
- 60% MMP 5m
- ten minutes easy
0x
- 1m 900%
- 1m 5000w`);
    expect(w.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(w.errors[0].message).toMatch(/Distance/);
    expect(w.errors[1].message).toMatch(/HR/);
    expect(w.errors[3].message).toMatch(/duration/i);
    expect(w.steps.length).toBe(1);
  });

  test('empty text and oversized workouts are refused', () => {
    expect(parseWorkout('').errors[0].message).toMatch(/No steps/);
    expect(parseWorkout('Just a title').errors.length).toBe(1);
    expect(parseWorkout('50x\n- 1h 50%').errors.some((e) => /8 hours/.test(e.message))).toBe(true);
    expect(parseWorkout('99x\n- 1m 50%').errors[0].message).toMatch(/Repeats/);
  });
});

describe('plan', () => {
  const plan = new WorkoutPlan(parseWorkout(`- 10m ramp 50-100%
- 5m 200-240w
- 5m freeride
- 2m 120%`), 250);

  test('resolves targets to watts against FTP', () => {
    expect(plan.duration).toBe(1320);
    expect(plan.steps[0]).toMatchObject({ start: 0, end: 600, ramp: true, from: 125, to: 250, low: 125, high: 250 });
    expect(plan.steps[1]).toMatchObject({ from: 220, to: 220, low: 200, high: 240, free: false });
    expect(plan.steps[2]).toMatchObject({ free: true, from: 220, to: 220 });
    expect(plan.steps[3]).toMatchObject({ from: 300, low: 300, high: 300 });
  });

  test('gives the step, power and time left at any moment', () => {
    const mid = plan.at(300);
    expect(mid.index).toBe(0);
    expect(mid.power).toBeCloseTo(187.5, 6);
    expect(mid.low).toBeCloseTo(187.5, 6);
    expect(mid.remaining).toBe(300);
    expect(mid.next?.low).toBe(200);
    expect(plan.at(600).index).toBe(1);
    expect(plan.at(599.9).index).toBe(0);
    const range = plan.at(700);
    expect(range.power).toBe(220);
    expect([range.low, range.high]).toEqual([200, 240]);
    expect(plan.at(1000).step.free).toBe(true);
    expect(plan.at(1319).next).toBeNull();
  });

  test('after the end the last step holds and it reports done', () => {
    const after = plan.at(5000);
    expect(after.done).toBe(true);
    expect(after.power).toBe(300);
    expect(after.remaining).toBe(0);
    expect(plan.at(0).done).toBe(false);
  });

  test('a free ride first uses half of FTP for the pacemaker', () => {
    const p = new WorkoutPlan(parseWorkout('- 5m freeride\n- 5m 80%'), 200);
    expect(p.steps[0].from).toBe(100);
    expect(p.steps[1].from).toBe(160);
  });

  test('describes targets', () => {
    expect(describeTarget(240, 240)).toBe('240 W');
    expect(describeTarget(228, 252)).toBe('228–252 W');
    expect(describeTarget(100, 100, true)).toBe('free ride');
  });
});

describe('library', () => {
  test('every built-in workout parses cleanly', () => {
    expect(builtInProblems()).toEqual([]);
    const all = listWorkouts();
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(new Set(all.map((w) => w.id)).size).toBe(all.length);
    for (const w of all) {
      const parsed = parseWorkout(w.text);
      expect(parsed.duration).toBeGreaterThan(600);
      expect(parsed.steps.length).toBeGreaterThan(0);
    }
  });
});
