// Segments: timed stretches of a circuit (climbs, descents, sprints) with personal bests.

import { TraceRecorder, distanceAt, timeAt } from './ghost.ts';
import type { GhostTrace } from './ghost.ts';

export type SegmentType = 'climb' | 'descent' | 'sprint';

export interface Segment {
  /** Stable within a circuit, e.g. "climb-2". */
  id: string;
  type: SegmentType;
  name: string;
  /** Metres from the lap line to the segment start. A segment may run across the lap line. */
  start: number;
  /** Metres. */
  length: number;
  /** Altitude change start to end, metres (negative for descents). */
  gain: number;
  /** Average gradient, fraction. */
  avgGrade: number;
}

export interface SprintDef {
  name: string;
  start: number;
  length: number;
}

export interface SegmentNames {
  climbs?: string[];
  descents?: string[];
}

export interface DetectOptions {
  /** Sampling interval, metres. */
  step: number;
  /** Altitude reversals smaller than this are ignored, metres. */
  hysteresis: number;
  /** Smallest climb or drop that counts, metres. */
  minGain: number;
  /** Shortest segment, metres. */
  minLength: number;
  /** Gentlest average gradient that counts, fraction. */
  minAvgGrade: number;
  /** Flat lead-in and run-out below this gradient are trimmed off, fraction. */
  edgeGrade: number;
}

export const defaultDetect: DetectOptions = {
  step: 10, hysteresis: 3, minGain: 10, minLength: 200, minAvgGrade: 0.02, edgeGrade: 0.012,
};

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Find the climbs and descents of a closed-loop profile. */
export function detectSegments(
  altitudeAt: (d: number) => number,
  gradeAt: (d: number) => number,
  length: number,
  names: SegmentNames = {},
  opts: DetectOptions = defaultDetect,
): Segment[] {
  const n = Math.max(4, Math.round(length / opts.step));
  const ds = length / n;

  // start the walk at the lowest point, so nothing wraps around the walk's own origin
  let low = 0;
  for (let i = 1; i < n; i++) if (altitudeAt(i * ds) < altitudeAt(low * ds)) low = i;
  const origin = low * ds;
  const alt = (i: number) => altitudeAt(origin + i * ds);

  // turning points, ignoring wiggles smaller than the hysteresis
  const turns: number[] = [0];
  let dir = 1;
  let extreme = 0;
  for (let i = 1; i <= n; i++) {
    const a = alt(i);
    if ((a - alt(extreme)) * dir >= 0) {
      extreme = i;
    } else if ((alt(extreme) - a) * dir >= opts.hysteresis) {
      turns.push(extreme);
      dir = -dir;
      extreme = i;
    }
  }
  if (turns[turns.length - 1] !== extreme) turns.push(extreme);
  if (turns[turns.length - 1] !== n) turns.push(n);

  const found: Array<Omit<Segment, 'id' | 'name'>> = [];
  for (let k = 1; k < turns.length; k++) {
    let a = turns[k - 1];
    let b = turns[k];
    const sign = Math.sign(alt(b) - alt(a));
    if (sign === 0) continue;
    while (a < b && gradeAt(origin + a * ds) * sign < opts.edgeGrade) a++;
    while (b > a && gradeAt(origin + b * ds) * sign < opts.edgeGrade) b--;
    const len = (b - a) * ds;
    const gain = alt(b) - alt(a);
    if (len < opts.minLength || Math.abs(gain) < opts.minGain || Math.abs(gain / len) < opts.minAvgGrade) continue;
    found.push({
      type: sign > 0 ? 'climb' : 'descent',
      start: mod(origin + a * ds, length),
      length: len,
      gain,
      avgGrade: gain / len,
    });
  }

  found.sort((p, q) => p.start - q.start);
  const counts = { climb: 0, descent: 0, sprint: 0 };
  return found.map((s) => {
    const index = counts[s.type]++;
    const given = (s.type === 'climb' ? names.climbs : names.descents)?.[index];
    return { ...s, id: `${s.type}-${index + 1}`, name: given ?? `${s.type === 'climb' ? 'Climb' : 'Descent'} ${index + 1}` };
  });
}

/** Hand-placed sprints, with their gradient figures filled in from the profile. */
export function sprintSegments(defs: SprintDef[], altitudeAt: (d: number) => number): Segment[] {
  return defs.map((def, i) => {
    const gain = altitudeAt(def.start + def.length) - altitudeAt(def.start);
    return {
      id: `sprint-${i + 1}`, type: 'sprint', name: def.name, start: def.start, length: def.length,
      gain, avgGrade: gain / def.length,
    };
  });
}

export function describeSegment(s: Segment): string {
  const dist = s.length >= 1000 ? `${(s.length / 1000).toFixed(1)} km` : `${Math.round(s.length / 10) * 10} m`;
  if (s.type === 'sprint') return dist;
  return `${dist} at ${Math.abs(s.avgGrade * 100).toFixed(1)}%`;
}

// --- tracking a ride against the segments -------------------------------------------

export interface SegmentEffort {
  segment: Segment;
  /** Seconds of ride time. */
  time: number;
  /** Best time before this effort, or null if it was the first. */
  previousBest: number | null;
  isBest: boolean;
  /** Rebuilt from an interrupted ride's record: the comparison with the best is not known. */
  restored?: boolean;
}

export interface ActiveSegment {
  segment: Segment;
  elapsed: number;
  remaining: number; // metres
  fraction: number; // 0..1 done
  /** Projected finishing time for the segment, seconds. */
  estimate: number;
  best: number | null;
  /** Seconds behind (+) or ahead (-) of the best effort at this point; null without one. */
  gap: number | null;
}

export interface UpcomingSegment {
  segment: Segment;
  distanceTo: number; // metres
  best: number | null;
}

export interface BestStore {
  load(segmentId: string): GhostTrace | null;
  save(segmentId: string, trace: GhostTrace): void;
}

interface Running {
  segment: Segment;
  startDistance: number;
  startTime: number;
  trace: TraceRecorder;
  lastSample: number;
  startedAt: number; // order of starting, to pick the most recent for display
}

const UPCOMING_WITHIN = 200; // metres
const GHOST_LINGER = 3; // seconds a finished segment ghost stays at the line

export interface SegmentGhost {
  segment: Segment;
  /** World distance (m). */
  distance: number;
}

export class SegmentTracker {
  readonly efforts: SegmentEffort[] = [];
  private best = new Map<string, GhostTrace | null>();
  private running = new Map<string, Running>();
  private speed = 0;
  private counter = 0;
  /** While true, finished efforts are listed but neither announced nor saved as bests. */
  replaying = false;

  constructor(
    private segments: Segment[],
    private lapLength: number,
    private store: BestStore,
    private onEffort?: (effort: SegmentEffort) => void,
  ) {
    for (const s of segments) {
      const trace = store.load(s.id);
      // a stored best only applies if the segment is still the same length
      this.best.set(s.id, trace && Math.abs(trace.d[trace.d.length - 1] - s.length) < 1 ? trace : null);
    }
  }

  bestTime(segmentId: string): number | null {
    return this.best.get(segmentId)?.lapTime ?? null;
  }

  /** Feed one physics step: distance and ride time before and after. */
  update(d0: number, d1: number, t0: number, t1: number): void {
    if (d1 <= d0) return;
    const at = (d: number) => t0 + ((d - d0) / (d1 - d0)) * (t1 - t0);
    if (t1 > t0) this.speed += ((d1 - d0) / (t1 - t0) - this.speed) * 0.12;

    for (const s of this.segments) {
      const lap = Math.floor((d1 - s.start) / this.lapLength);
      const begin = lap * this.lapLength + s.start;
      if (begin >= 0 && d0 <= begin && begin < d1 && !this.running.has(s.id)) {
        this.running.set(s.id, {
          segment: s, startDistance: begin, startTime: at(begin), trace: new TraceRecorder(), lastSample: 0,
          startedAt: this.counter++,
        });
      }
      const run = this.running.get(s.id);
      if (!run) continue;
      const end = run.startDistance + s.length;
      if (d1 >= end) {
        this.running.delete(s.id);
        this.finish(run, at(end) - run.startTime);
      } else {
        const elapsed = t1 - run.startTime;
        if (elapsed - run.lastSample >= 1) {
          run.trace.sample(elapsed, d1 - run.startDistance);
          run.lastSample = elapsed;
        }
      }
    }
  }

  private finish(run: Running, time: number): void {
    const s = run.segment;
    if (this.replaying) {
      this.efforts.push({ segment: s, time, previousBest: null, isBest: false, restored: true });
      return;
    }
    const previousBest = this.bestTime(s.id);
    const isBest = previousBest === null || time < previousBest;
    if (isBest) {
      const trace = run.trace.finish(time, s.length);
      this.best.set(s.id, trace);
      this.store.save(s.id, trace);
    }
    const effort: SegmentEffort = { segment: s, time, previousBest, isBest };
    this.efforts.push(effort);
    this.onEffort?.(effort);
  }

  /**
   * The segment being ridden right now (the most recently started, if they overlap).
   * `project` gives the seconds needed to ride between two distances; without it the
   * estimate assumes the current speed holds.
   */
  active(
    distance: number, time: number, project?: (from: number, to: number) => number,
  ): ActiveSegment | null {
    let run: Running | null = null;
    for (const r of this.running.values()) if (!run || r.startedAt > run.startedAt) run = r;
    if (!run) return null;
    const s = run.segment;
    const done = Math.min(s.length, Math.max(0, distance - run.startDistance));
    const elapsed = Math.max(0, time - run.startTime);
    const remaining = s.length - done;
    const trace = this.best.get(s.id) ?? null;
    return {
      segment: s,
      elapsed,
      remaining,
      fraction: done / s.length,
      estimate: elapsed + (project
        ? project(run.startDistance + done, run.startDistance + s.length)
        : remaining / Math.max(0.5, this.speed)),
      best: trace?.lapTime ?? null,
      gap: trace ? elapsed - timeAt(trace, done) : null,
    };
  }

  /**
   * Where the best efforts are right now: a ghost per running segment with a stored best,
   * riding its trace from the segment start, plus one waiting on the line of a segment the
   * rider is about to reach. A ghost that has finished lingers at the end for a moment.
   */
  ghosts(distance: number, time: number): SegmentGhost[] {
    const out: SegmentGhost[] = [];
    for (const run of this.running.values()) {
      const trace = this.best.get(run.segment.id);
      if (!trace) continue;
      const elapsed = time - run.startTime;
      if (elapsed > trace.lapTime + GHOST_LINGER) continue;
      out.push({ segment: run.segment, distance: run.startDistance + distanceAt(trace, Math.min(elapsed, trace.lapTime)) });
    }
    const next = this.upcoming(distance);
    if (next && next.best !== null) out.push({ segment: next.segment, distance: distance + next.distanceTo });
    return out;
  }

  /** The next segment start within a couple of hundred metres, if any. */
  upcoming(distance: number): UpcomingSegment | null {
    let next: UpcomingSegment | null = null;
    for (const s of this.segments) {
      if (this.running.has(s.id)) continue;
      const distanceTo = mod(s.start - distance, this.lapLength);
      if (distanceTo > 0 && distanceTo <= UPCOMING_WITHIN && (!next || distanceTo < next.distanceTo)) {
        next = { segment: s, distanceTo, best: this.bestTime(s.id) };
      }
    }
    return next;
  }
}
