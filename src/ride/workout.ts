// Structured workouts in the intervals.icu workout-builder text format, for the pacemaker.
//
//   Warmup
//   - 10m ramp 50-75%
//
//   Main Set 3x
//   - 10m 240w
//   - 2m 180w
//
//   - Cooldown 8m 55%
//
// Supported: time steps (10m, 30s, 1h2m30s, 5', 30", 1'30"), power as % of FTP, watts,
// ranges, zones (Z1-Z7), ramps, freeride, cadence (rpm), cues, and repeats ("3x" alone or
// at the end of a header). Distance steps and heart-rate / pace / MMP targets are not.

export interface StepTarget {
  /** As written: for a ramp, the start and end; otherwise the low and high of the range. */
  a: number;
  b: number;
  unit: 'w' | 'ftp'; // ftp: percent of FTP
  ramp: boolean;
}

export interface WorkoutStep {
  /** Seconds. */
  duration: number;
  /** null is a free ride. */
  target: StepTarget | null;
  label: string;
  cadence: [number, number] | null;
}

export interface WorkoutError {
  /** 1-based line number. */
  line: number;
  message: string;
}

export interface ParsedWorkout {
  steps: WorkoutStep[];
  errors: WorkoutError[];
  /** Seconds. */
  duration: number;
}

const MAX_STEPS = 600;
const MAX_DURATION = 8 * 3600;

/** Percent-of-FTP bounds for the classic seven power zones. */
const ZONES: Array<[number, number]> = [
  [40, 55], [56, 75], [76, 90], [91, 105], [106, 120], [121, 150], [151, 200],
];

export function parseDuration(token: string): number | null {
  let m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(token);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  m = /^(\d+)m(\d+)$/i.exec(token); // 1m30
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)'(?:(\d+)")?$/.exec(token); // 5' and 1'30"
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  m = /^(\d+)"$/.exec(token); // 30"
  if (m) return Number(m[1]);
  return null;
}

function parseTarget(token: string): { a: number; b: number; unit: 'w' | 'ftp' } | null {
  const range = /^(\d+(?:\.\d+)?)(%|w)?(?:-(\d+(?:\.\d+)?)(%|w)?)?$/i.exec(token);
  if (range && (range[2] || range[4])) {
    const unit = (range[4] ?? range[2]).toLowerCase() === 'w' ? 'w' : 'ftp';
    const a = Number(range[1]);
    return { a, b: range[3] !== undefined ? Number(range[3]) : a, unit };
  }
  const zone = /^z([1-7])(?:-z?([1-7]))?$/i.exec(token);
  if (zone) {
    const lo = ZONES[Number(zone[1]) - 1];
    const hi = ZONES[Number(zone[2] ?? zone[1]) - 1];
    return { a: Math.min(lo[0], hi[0]), b: Math.max(lo[1], hi[1]), unit: 'ftp' };
  }
  return null;
}

interface RawStep {
  duration: number;
  target: StepTarget | null;
  cue: string;
  cadence: [number, number] | null;
}

function parseStep(text: string, line: number, errors: WorkoutError[]): RawStep | null {
  const tokens = text.replace(/@/g, ' ').split(/\s+/).filter(Boolean);
  const at = tokens.findIndex((t) => parseDuration(t) !== null);
  if (at < 0) {
    const distance = tokens.some((t) => /^\d+(\.\d+)?(km|mi|mtr)$/i.test(t));
    errors.push({ line, message: distance ? 'Distance steps are not supported; give a time such as 10m.' : 'No duration found; write one such as 10m, 30s or 1h.' });
    return null;
  }
  const unsupported = tokens.find((t) => ['hr', 'lthr', 'pace', 'mmp'].includes(t.toLowerCase()) || /^cz\d/i.test(t));
  if (unsupported) {
    errors.push({ line, message: `"${unsupported}" targets are not supported; use watts, % of FTP or a zone (Z1 to Z7).` });
    return null;
  }
  const duration = parseDuration(tokens[at])!;
  if (duration <= 0) {
    errors.push({ line, message: 'A step must last at least a second.' });
    return null;
  }
  const cue = tokens.slice(0, at);
  let target: StepTarget | null = null;
  let ramp = false;
  let free = false;
  let cadence: [number, number] | null = null;

  for (const token of tokens.slice(at + 1)) {
    const lower = token.toLowerCase();
    const rpm = /^(\d+)(?:-(\d+))?rpm$/i.exec(token);
    const parsed = parseTarget(token);
    if (lower === 'ramp') ramp = true;
    else if (lower === 'freeride') free = true;
    else if (rpm) cadence = [Number(rpm[1]), Number(rpm[2] ?? rpm[1])];
    else if (parsed && !target) target = { ...parsed, ramp: false };
    else if (/^\d+(\.\d+)?(km|mi|mtr)$/i.test(token)) {
      errors.push({ line, message: 'Distance steps are not supported; give a time such as 10m.' });
      return null;
    } else cue.push(token);
  }

  if (target) {
    const max = target.unit === 'w' ? 2000 : 300;
    if (target.a > max || target.b > max) {
      errors.push({ line, message: target.unit === 'w' ? 'Power above 2000 W is not accepted.' : 'Power above 300% of FTP is not accepted.' });
      return null;
    }
    target.ramp = ramp && target.a !== target.b;
  }
  return { duration, target: free ? null : target, cue: cue.join(' '), cadence };
}

export function parseWorkout(text: string): ParsedWorkout {
  const errors: WorkoutError[] = [];
  const steps: WorkoutStep[] = [];
  let section = '';
  let block: { title: string; count: number; steps: RawStep[] } | null = null;

  const flush = () => {
    if (!block) return;
    for (let i = 1; i <= block.count; i++) {
      for (const s of block.steps) {
        const name = s.cue || block.title || 'Set';
        steps.push({ duration: s.duration, target: s.target, cadence: s.cadence, label: `${name} ${i}/${block.count}` });
      }
    }
    block = null;
  };

  const lines = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;
    if (line === '') {
      if (block && block.steps.length > 0) flush();
      return;
    }
    const dashed = line.startsWith('-');
    const body = dashed ? line.slice(1).trim() : line;
    const firstToken = body.replace(/@/g, ' ').split(/\s+/)[0] ?? '';
    const isStep = dashed || parseDuration(firstToken) !== null;

    if (!isStep) {
      flush();
      const repeat = /^(.*?)\s*(\d+)\s*x$/i.exec(line);
      if (repeat) {
        const count = Number(repeat[2]);
        if (count < 1 || count > 50) {
          errors.push({ line: number, message: 'Repeats must be between 1x and 50x.' });
          return;
        }
        section = repeat[1].trim();
        block = { title: section, count, steps: [] };
      } else {
        section = line;
      }
      return;
    }

    const step = parseStep(body, number, errors);
    if (!step) return;
    if (block) block.steps.push(step);
    else steps.push({ duration: step.duration, target: step.target, cadence: step.cadence, label: step.cue || section || 'Step' });
  });
  flush();

  const duration = steps.reduce((sum, s) => sum + s.duration, 0);
  if (errors.length === 0 && steps.length === 0) errors.push({ line: 1, message: 'No steps found. A step looks like "- 10m 75%".' });
  if (steps.length > MAX_STEPS) errors.push({ line: 1, message: `Too many steps (${steps.length}); the limit is ${MAX_STEPS}.` });
  if (duration > MAX_DURATION) errors.push({ line: 1, message: 'The workout is longer than 8 hours.' });
  return { steps, errors, duration };
}

// --- a workout resolved to watts against an FTP ---------------------------------------

export interface PlanStep {
  start: number; // seconds into the workout
  end: number;
  label: string;
  free: boolean;
  ramp: boolean;
  /** What the pacemaker rides at the start and end of the step, watts. */
  from: number;
  to: number;
  /** The target band over the whole step, watts (equal for a single target). */
  low: number;
  high: number;
  cadence: [number, number] | null;
}

export interface PlanMoment {
  index: number;
  step: PlanStep;
  /** Pacemaker power right now, watts. */
  power: number;
  /** Target band right now, watts; for a ramp both follow the ramp. */
  low: number;
  high: number;
  /** Seconds left in the step. */
  remaining: number;
  next: PlanStep | null;
  /** True once the last step has finished. */
  done: boolean;
}

export class WorkoutPlan {
  readonly steps: PlanStep[] = [];
  readonly duration: number;

  constructor(workout: ParsedWorkout, ftp: number) {
    let t = 0;
    let last = Math.round(ftp * 0.5);
    for (const s of workout.steps) {
      const watts = (v: number) => Math.round(s.target!.unit === 'ftp' ? (ftp * v) / 100 : v);
      let step: PlanStep;
      if (!s.target) {
        step = { start: t, end: t + s.duration, label: s.label, free: true, ramp: false, from: last, to: last, low: last, high: last, cadence: s.cadence };
      } else {
        const a = watts(s.target.a);
        const b = watts(s.target.b);
        const mid = Math.round((a + b) / 2);
        step = {
          start: t, end: t + s.duration, label: s.label, free: false, ramp: s.target.ramp,
          from: s.target.ramp ? a : mid, to: s.target.ramp ? b : mid,
          low: Math.min(a, b), high: Math.max(a, b), cadence: s.cadence,
        };
      }
      this.steps.push(step);
      last = step.to;
      t = step.end;
    }
    this.duration = t;
  }

  /** The step in force at a time into the workout. After the end, the last step holds. */
  at(time: number): PlanMoment {
    const steps = this.steps;
    const done = time >= this.duration;
    let index = steps.length - 1;
    if (!done) {
      let lo = 0;
      let hi = steps.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (time < steps[mid].end) hi = mid;
        else lo = mid + 1;
      }
      index = lo;
    }
    const step = steps[index];
    const span = step.end - step.start;
    const f = done || span <= 0 ? 1 : Math.min(1, Math.max(0, (time - step.start) / span));
    const power = step.from + (step.to - step.from) * f;
    return {
      index,
      step,
      power,
      low: step.ramp ? power : step.low,
      high: step.ramp ? power : step.high,
      remaining: done ? 0 : step.end - time,
      next: steps[index + 1] ?? null,
      done,
    };
  }
}

/** "240 W", "228-252 W" or "free ride". */
export function describeTarget(low: number, high: number, free = false): string {
  if (free) return 'free ride';
  const lo = Math.round(low);
  const hi = Math.round(high);
  return lo === hi ? `${lo} W` : `${lo}–${hi} W`;
}
