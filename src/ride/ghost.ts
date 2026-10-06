// Best-lap ghost: a (time, distance) trace of one lap, recorded once a second.

export interface GhostTrace {
  /** Total lap time in seconds. */
  lapTime: number;
  /** Seconds since lap start, ascending, starting at 0 and ending at lapTime. */
  t: number[];
  /** Metres since lap start, non-decreasing, starting at 0 and ending at the lap length. */
  d: number[];
}

export class TraceRecorder {
  private t: number[] = [0];
  private d: number[] = [0];

  reset(): void {
    this.t = [0];
    this.d = [0];
  }

  /** Add a point; call about once a second with lap-relative time and distance. */
  sample(lapTime: number, lapDistance: number): void {
    const last = this.t.length - 1;
    if (lapTime <= this.t[last]) return;
    this.t.push(lapTime);
    this.d.push(Math.max(lapDistance, this.d[last]));
  }

  finish(lapTime: number, length: number): GhostTrace {
    const t = this.t.filter((x) => x < lapTime);
    const d = this.d.slice(0, t.length).map((x) => Math.min(x, length));
    t.push(lapTime);
    d.push(length);
    return { lapTime, t, d };
  }
}

function interpolate(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  if (span <= 0) return ys[lo];
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span;
}

/** Ghost's distance into its lap at a given lap time (clamped to the lap). */
export function distanceAt(trace: GhostTrace, lapTime: number): number {
  return interpolate(trace.t, trace.d, lapTime);
}

/** Lap time at which the ghost reached a given distance into the lap. */
export function timeAt(trace: GhostTrace, lapDistance: number): number {
  return interpolate(trace.d, trace.t, lapDistance);
}

/** Ghost position relative to the start of the rider's current lap; it rides on into another lap. */
export function ghostLapDistance(trace: GhostTrace, lapTime: number): number {
  const length = trace.d[trace.d.length - 1];
  if (trace.lapTime <= 0) return 0;
  const lapsDone = Math.floor(lapTime / trace.lapTime);
  return lapsDone * length + distanceAt(trace, lapTime - lapsDone * trace.lapTime);
}

/** Seconds behind (+) or ahead (-) of the ghost at the rider's current position. */
export function gapSeconds(trace: GhostTrace, lapTime: number, lapDistance: number): number {
  return lapTime - timeAt(trace, lapDistance);
}

const key = (circuitId: string) => `bikeboi:ghost:${circuitId}`;

export function isGhostTrace(x: unknown): x is GhostTrace {
  const g = x as GhostTrace;
  return (
    !!g &&
    typeof g.lapTime === 'number' &&
    g.lapTime > 0 &&
    Array.isArray(g.t) &&
    Array.isArray(g.d) &&
    g.t.length === g.d.length &&
    g.t.length >= 2 &&
    g.t.every((v) => typeof v === 'number') &&
    g.d.every((v) => typeof v === 'number')
  );
}

export function loadGhost(circuitId: string): GhostTrace | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(circuitId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isGhostTrace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGhost(circuitId: string, trace: GhostTrace): void {
  try {
    const compact: GhostTrace = {
      lapTime: Math.round(trace.lapTime * 100) / 100,
      t: trace.t.map((v) => Math.round(v * 100) / 100),
      d: trace.d.map((v) => Math.round(v * 10) / 10),
    };
    globalThis.localStorage?.setItem(key(circuitId), JSON.stringify(compact));
  } catch {
    // storage unavailable: the ghost lives for this session only
  }
}
