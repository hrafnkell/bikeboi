// Input checks. Hand-rolled; the app's own normalisers do the heavy lifting.

import { ApiError } from './http.ts';

export const MAX_SETTINGS_BYTES = 16 * 1024;

/** A trimmed, lower-cased address that looks like an email. */
export function email(input: unknown): string {
  if (typeof input !== 'string') throw new ApiError(400, 'email is required');
  const value = input.trim().toLowerCase();
  if (value.length < 3 || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new ApiError(400, 'that does not look like an email address');
  }
  return value;
}

export function password(input: unknown): string {
  if (typeof input !== 'string') throw new ApiError(400, 'password is required');
  if (input.length < 8) throw new ApiError(400, 'use at least 8 characters');
  if (input.length > 200) throw new ApiError(400, 'password is too long');
  return input;
}

export function object(input: unknown, what = 'body'): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ApiError(400, `${what} must be an object`);
  return input as Record<string, unknown>;
}

/** A client timestamp in ms, not from the future (beyond clock skew). */
export function timestamp(input: unknown, now = Date.now()): number {
  const v = Number(input);
  if (!Number.isFinite(v) || v < 0) throw new ApiError(400, 'bad timestamp');
  return Math.min(Math.round(v), now + 5 * 60 * 1000);
}

export const CIRCUIT_ID = /^[a-z0-9-]{1,40}$/;
export const SEGMENT_ID = /^[a-z]+-\d{1,3}$/;
export const WORKOUT_ID = /^custom:[a-z0-9]{4,32}$/;

import { isGhostTrace } from '../src/ride/ghost.ts';
import type { GhostTrace } from '../src/ride/ghost.ts';
import { parseWorkout } from '../src/ride/workout.ts';

export const MAX_TRACE_POINTS = 20_000;
export const MAX_TRACE_BYTES = 256 * 1024;
export const MAX_BESTS_BATCH = 200;
export const MAX_WORKOUT_TEXT = 8000;
export const MAX_WORKOUTS = 100;
export const MAX_META_BYTES = 4 * 1024;
export const MIN_FIT_BYTES = 100;
export const MAX_FIT_BYTES = 2 * 1024 * 1024;

export function circuitId(input: unknown): string {
  if (typeof input !== 'string' || !CIRCUIT_ID.test(input)) throw new ApiError(400, 'bad circuit id');
  return input;
}

export function segmentId(input: unknown): string {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || !SEGMENT_ID.test(input)) throw new ApiError(400, 'bad segment id');
  return input;
}

export function workoutId(input: unknown): string {
  if (typeof input !== 'string' || !WORKOUT_ID.test(input)) throw new ApiError(400, 'bad workout id');
  return input;
}

/** A best-lap or segment trace: starts at (0, 0), ends at (lapTime, length), never goes backwards. */
export function trace(input: unknown): GhostTrace {
  if (!isGhostTrace(input)) throw new ApiError(400, 'bad trace');
  const g = input;
  if (g.t.length > MAX_TRACE_POINTS) throw new ApiError(400, 'trace has too many points');
  if (!Number.isFinite(g.lapTime) || !g.t.every(Number.isFinite) || !g.d.every(Number.isFinite)) throw new ApiError(400, 'bad trace');
  if (g.t[0] !== 0 || g.d[0] !== 0) throw new ApiError(400, 'trace must start at zero');
  for (let i = 1; i < g.t.length; i++) {
    if (g.t[i] < g.t[i - 1] || g.d[i] < g.d[i - 1]) throw new ApiError(400, 'trace must not go backwards');
  }
  if (Math.abs(g.t[g.t.length - 1] - g.lapTime) > 0.01) throw new ApiError(400, 'trace must end at the lap time');
  if (JSON.stringify(g).length > MAX_TRACE_BYTES) throw new ApiError(400, 'trace too large');
  return { lapTime: g.lapTime, t: g.t, d: g.d };
}

export function workoutName(input: unknown): string {
  if (typeof input !== 'string') throw new ApiError(400, 'name is required');
  const name = input.trim();
  if (name.length < 1 || name.length > 60) throw new ApiError(400, 'name must be 1 to 60 characters');
  return name;
}

/** Workout text that the app can run. */
export function workoutText(input: unknown): string {
  if (typeof input !== 'string') throw new ApiError(400, 'text is required');
  if (input.length > MAX_WORKOUT_TEXT) throw new ApiError(400, `workout text is longer than ${MAX_WORKOUT_TEXT} characters`);
  const parsed = parseWorkout(input);
  if (parsed.errors.length > 0) throw new ApiError(400, `Line ${parsed.errors[0].line}: ${parsed.errors[0].message}`);
  return input;
}

export function shortText(input: unknown, what: string, max: number): string {
  if (typeof input !== 'string') throw new ApiError(400, `${what} is required`);
  const value = input.trim();
  if (value.length < 1 || value.length > max) throw new ApiError(400, `${what} must be 1 to ${max} characters`);
  return value;
}

export function fitFilename(input: unknown): string {
  if (typeof input !== 'string' || input.length > 80 || !/^[a-z0-9-]+\.fit$/.test(input)) throw new ApiError(400, 'bad filename');
  return input;
}

const SUMMARY_FIELDS = [
  'durationS', 'distanceM', 'avgPower', 'maxPower', 'avgHeartRate', 'avgCadence', 'avgSpeed', 'ascentM', 'calories', 'laps',
] as const;

export type RideSummaryDoc = Record<(typeof SUMMARY_FIELDS)[number], number>;

/** The ten numbers of a ride summary, nothing else. */
export function rideSummary(input: unknown): RideSummaryDoc {
  const o = object(input, 'summary');
  const out = {} as RideSummaryDoc;
  for (const key of SUMMARY_FIELDS) {
    const value = Number(o[key]);
    if (!Number.isFinite(value) || value < 0) throw new ApiError(400, `summary.${key} must be a non-negative number`);
    out[key] = value;
  }
  return out;
}

/** Free-form ride details, bounded in size. */
export function rideMeta(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  const o = object(input, 'meta');
  if (JSON.stringify(o).length > MAX_META_BYTES) throw new ApiError(400, 'meta too large');
  return o;
}

/** Bytes that are a FIT file: ".FIT" at offset 8 of the header. */
export function fitBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < MIN_FIT_BYTES) throw new ApiError(400, 'not a FIT file');
  if (bytes.length > MAX_FIT_BYTES) throw new ApiError(413, 'FIT file too large');
  if (String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== '.FIT') throw new ApiError(400, 'not a FIT file');
  return bytes;
}
