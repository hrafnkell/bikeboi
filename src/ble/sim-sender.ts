// Latest-value-wins sender for trainer simulation parameters.
//
// The borrowed trainer services drop a sim write while the control point is busy and never
// resend it, and their encoders wrap instead of clamping. This sender clamps every field,
// keeps only the newest pending value and delivers it as soon as the control point is free.

import { CRR, CW } from '../types.ts';
import type { SimParams } from '../types.ts';

export interface SimLimits {
  minGrade: number; // fraction
  maxGrade: number; // fraction
}

export const DEFAULT_SIM_LIMITS: SimLimits = { minGrade: -0.1, maxGrade: 0.2 };

// uint8 fields on the wire: crr at 0.0001, wind resistance at 0.01 kg/m
const MAX_CRR = 0.0254;
const MAX_CW = 1.86;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampSim(p: SimParams, limits: SimLimits = DEFAULT_SIM_LIMITS): SimParams {
  return {
    grade: clamp(p.grade, limits.minGrade, limits.maxGrade, 0),
    crr: clamp(p.crr, 0, MAX_CRR, CRR),
    cw: clamp(p.cw, 0, MAX_CW, CW),
  };
}

/** True when both values encode to the same bytes (grade 0.01 %, crr 0.0001, cw 0.01). */
function sameOnWire(a: SimParams, b: SimParams): boolean {
  return (
    Math.round(a.grade * 1e4) === Math.round(b.grade * 1e4) &&
    Math.round(a.crr * 1e4) === Math.round(b.crr * 1e4) &&
    Math.round(a.cw * 100) === Math.round(b.cw * 100)
  );
}

export interface SenderOptions<T> {
  /** True when the trainer can take a write right now. */
  isReady(): boolean;
  /** Performs the write. Returning (or resolving to) `false`, or throwing, counts as a failure and is retried. */
  write(value: T): unknown;
  /** How often to re-check a busy control point, ms. */
  pollMs?: number;
  /** Minimum spacing between writes, ms. */
  minIntervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Sender<T> {
  /** Queue a value; replaces anything still pending. */
  set(value: T): void;
  /** Try to deliver the pending value now, ignoring the minimum spacing. */
  flush(): void;
  /** Forget what was last delivered so the next `set` is always written (use after a reconnect). */
  reset(): void;
  /** Drop the pending value and cancel timers. */
  stop(): void;
}

/**
 * Delivers the latest value to a control point that can be busy: values set while it is
 * busy replace each other, identical values are not re-sent, and failures are retried.
 */
function createLatestSender<T>(
  opts: SenderOptions<T>, prepare: (value: T) => T, same: (a: T, b: T) => boolean,
): Sender<T> {
  const pollMs = opts.pollMs ?? 100;
  const minIntervalMs = opts.minIntervalMs ?? 250;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let pending: { value: T } | null = null;
  let delivered: { value: T } | null = null;
  let lastWriteAt = -Infinity;
  let timer: unknown = null;
  let epoch = 0;

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function schedule(ms: number): void {
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      deliver(false);
    }, ms);
  }

  function failed(p: { value: T }, atEpoch: number): void {
    if (atEpoch !== epoch) return;
    if (delivered === p) delivered = null;
    if (pending === null) pending = p;
    schedule(pollMs);
  }

  function deliver(force: boolean): void {
    if (pending === null) return;

    const wait = lastWriteAt + minIntervalMs - now();
    if (!force && wait > 0) {
      schedule(wait);
      return;
    }
    if (!opts.isReady()) {
      schedule(pollMs);
      return;
    }

    const p = pending;
    const atEpoch = epoch;
    pending = null;
    delivered = p;
    lastWriteAt = now();

    let result: unknown;
    try {
      result = opts.write(p.value);
    } catch {
      result = false;
    }

    if (result === false) {
      failed(p, atEpoch);
    } else if (typeof (result as PromiseLike<unknown> | null)?.then === 'function') {
      (result as PromiseLike<unknown>).then(
        (ok) => {
          if (ok === false) failed(p, atEpoch);
        },
        () => failed(p, atEpoch),
      );
    }
  }

  return {
    set(value) {
      const next = prepare(value);
      if (delivered !== null && same(next, delivered.value)) {
        pending = null;
        cancelTimer();
        return;
      }
      pending = { value: next };
      deliver(false);
    },
    flush() {
      cancelTimer();
      deliver(true);
    },
    reset() {
      delivered = null;
    },
    stop() {
      epoch += 1;
      pending = null;
      cancelTimer();
    },
  };
}

export interface SimSenderOptions extends SenderOptions<SimParams> {
  limits?: SimLimits;
}

export type SimSender = Sender<SimParams>;

export function createSimSender(opts: SimSenderOptions): SimSender {
  const limits = opts.limits ?? DEFAULT_SIM_LIMITS;
  return createLatestSender(opts, (p) => clampSim(p, limits), sameOnWire);
}

export const MAX_TARGET_POWER = 2000;

/** Whole watts within what a trainer can be asked for. */
export function clampPower(watts: number): number {
  if (!Number.isFinite(watts)) return 0;
  return Math.min(MAX_TARGET_POWER, Math.max(0, Math.round(watts)));
}

/** Sender for ERG power targets, in watts. */
export function createPowerSender(opts: SenderOptions<number>): Sender<number> {
  return createLatestSender(opts, clampPower, (a, b) => a === b);
}
