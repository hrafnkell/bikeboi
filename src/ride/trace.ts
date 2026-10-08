// Diagnostics kept beside a ride's FIT file: the virtual gear, the trainer's own wheel speed
// and what the trainer was told, one entry per FIT record. Stored in the ride's meta on
// the account as a compact JSON object.

import type { RideSample } from '../types.ts';

/** [value, run length] pairs. */
type Runs = Array<[number, number]>;

export interface EncodedTrace {
  v: 1;
  /** Gear per record, run-length encoded. */
  gear: Runs;
  /** Wheel speed per record in 0.1 km/h. */
  wheel: number[];
  /** Gradient sent per record in 0.1 %, run-length encoded; null where the trainer held a power. */
  sent: Runs;
  /** ERG target per record in watts, run-length encoded; 0 where the road was simulated. */
  target: Runs;
}

export interface RideTrace {
  gear: number[];
  /** m/s */
  wheelSpeed: number[];
  /** Percent, or null while in ERG. */
  sentGrade: Array<number | null>;
  /** Watts, or null while simulating the road. */
  target: Array<number | null>;
}

const SENT_NONE = -9999;

function runs(values: number[]): Runs {
  const out: Runs = [];
  for (const v of values) {
    const last = out[out.length - 1];
    if (last && last[0] === v) last[1]++;
    else out.push([v, 1]);
  }
  return out;
}

function expand(r: Runs): number[] {
  const out: number[] = [];
  for (const [v, n] of r) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

/** One entry per FIT record: the recorder writes one record per distinct second. */
export function recordSamples(samples: RideSample[]): RideSample[] {
  const out: RideSample[] = [];
  let prev = -Infinity;
  for (const s of samples) {
    const second = Math.floor(s.timestamp / 1000);
    if (second <= prev) continue;
    prev = second;
    out.push(s);
  }
  return out;
}

export function encodeTrace(samples: RideSample[]): EncodedTrace | null {
  const recs = recordSamples(samples);
  if (!recs.some((s) => s.gear !== undefined)) return null;
  return {
    v: 1,
    gear: runs(recs.map((s) => s.gear ?? 0)),
    wheel: recs.map((s) => Math.round((s.wheelSpeed ?? 0) * 36)),
    sent: runs(recs.map((s) => (s.sentGrade === undefined ? SENT_NONE : Math.round(s.sentGrade * 10)))),
    target: runs(recs.map((s) => s.target ?? 0)),
  };
}

export function decodeTrace(input: unknown): RideTrace | null {
  if (typeof input !== 'object' || input === null) return null;
  const t = input as Partial<EncodedTrace>;
  if (t.v !== 1 || !Array.isArray(t.gear) || !Array.isArray(t.wheel) || !Array.isArray(t.sent) || !Array.isArray(t.target)) return null;
  const sent = expand(t.sent as Runs);
  const target = expand(t.target as Runs);
  return {
    gear: expand(t.gear as Runs),
    wheelSpeed: (t.wheel as number[]).map((w) => w / 36),
    sentGrade: sent.map((v) => (v === SENT_NONE ? null : v / 10)),
    target: target.map((v) => (v > 0 ? v : null)),
  };
}
