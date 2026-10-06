// A circuit is a closed loop described by an elevation profile.

import type { SceneId } from '../game/scenes.ts';
import { detectSegments, sprintSegments } from './segments.ts';
import type { Segment, SegmentNames, SprintDef } from './segments.ts';

export interface CircuitDef {
  id: string;
  name: string;
  description: string;
  /** Seeds the procedural scenery. */
  seed: number;
  /** Scene used unless the rider picks another. */
  scene: SceneId;
  /** Lap length in metres. */
  length: number;
  /** Control points [distance m, altitude m]; first at distance 0, ascending, all < length. */
  points: Array<[number, number]>;
  /** Names for the climbs and descents found in the profile, in lap order. */
  segmentNames?: SegmentNames;
  /** Hand-placed sprint segments. */
  sprints?: SprintDef[];
}

export interface Circuit extends CircuitDef {
  /** Altitude in metres at any distance; wraps every lap. */
  altitudeAt(distance: number): number;
  /** Gradient as a fraction (0.05 = 5 %) at any distance; wraps every lap. */
  gradeAt(distance: number): number;
  minAltitude: number;
  maxAltitude: number;
  /** Metres climbed per lap. */
  ascent: number;
  /** Steepest gradient (absolute, fraction). */
  maxGrade: number;
  /** Timed climbs, descents and sprints, in lap order. */
  segments: Segment[];
}

const SAMPLE_STEP = 5; // metres, approximate

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Periodic monotone cubic (PCHIP) tangents, so the profile never overshoots a control point. */
function tangents(ds: number[], as: number[], length: number): number[] {
  const n = ds.length;
  const h = (j: number) => (j === n - 1 ? ds[0] + length - ds[j] : ds[j + 1] - ds[j]);
  const secant = (j: number) => (as[(j + 1) % n] - as[j]) / h(j);
  const m: number[] = [];
  for (let j = 0; j < n; j++) {
    const prev = mod(j - 1, n);
    const s0 = secant(prev);
    const s1 = secant(j);
    if (s0 * s1 <= 0) {
      m.push(0);
    } else {
      const h0 = h(prev);
      const h1 = h(j);
      m.push((3 * (h0 + h1)) / ((2 * h1 + h0) / s0 + (h1 + 2 * h0) / s1));
    }
  }
  return m;
}

export function buildCircuit(def: CircuitDef): Circuit {
  const ds = def.points.map((p) => p[0]);
  const as = def.points.map((p) => p[1]);
  if (ds.length < 2) throw new Error(`circuit ${def.id}: needs at least 2 points`);
  if (ds[0] !== 0) throw new Error(`circuit ${def.id}: first point must be at distance 0`);
  for (let j = 1; j < ds.length; j++) {
    if (ds[j] <= ds[j - 1]) throw new Error(`circuit ${def.id}: distances must ascend`);
  }
  if (ds[ds.length - 1] >= def.length) throw new Error(`circuit ${def.id}: points must be < length`);

  const m = tangents(ds, as, def.length);
  const count = Math.max(8, Math.round(def.length / SAMPLE_STEP));
  const step = def.length / count;
  const altitudes = new Float64Array(count);
  const np = ds.length;

  let j = 0;
  for (let i = 0; i < count; i++) {
    const d = i * step;
    while (j < np - 1 && d >= ds[j + 1]) j++;
    const d0 = ds[j];
    const d1 = j === np - 1 ? def.length : ds[j + 1];
    const k = (j + 1) % np;
    const hh = d1 - d0;
    const t = (d - d0) / hh;
    const t2 = t * t;
    const t3 = t2 * t;
    altitudes[i] =
      (2 * t3 - 3 * t2 + 1) * as[j] +
      (t3 - 2 * t2 + t) * hh * m[j] +
      (-2 * t3 + 3 * t2) * as[k] +
      (t3 - t2) * hh * m[k];
  }

  const grades = new Float64Array(count);
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let ascent = 0;
  let maxGrade = 0;
  for (let i = 0; i < count; i++) {
    const next = altitudes[(i + 1) % count];
    const prev = altitudes[mod(i - 1, count)];
    grades[i] = (next - prev) / (2 * step);
    minAltitude = Math.min(minAltitude, altitudes[i]);
    maxAltitude = Math.max(maxAltitude, altitudes[i]);
    ascent += Math.max(0, next - altitudes[i]);
    maxGrade = Math.max(maxGrade, Math.abs(grades[i]));
  }

  const sample = (table: Float64Array, distance: number): number => {
    const x = mod(distance, def.length) / step;
    const i = Math.floor(x) % count;
    const f = x - Math.floor(x);
    return table[i] + (table[(i + 1) % count] - table[i]) * f;
  };

  const altitudeAt = (distance: number) => sample(altitudes, distance);
  const gradeAt = (distance: number) => sample(grades, distance);
  const segments = [
    ...detectSegments(altitudeAt, gradeAt, def.length, def.segmentNames),
    ...sprintSegments(def.sprints ?? [], altitudeAt),
  ].sort((a, b) => a.start - b.start);

  return {
    ...def,
    altitudeAt,
    gradeAt,
    segments,
    minAltitude,
    maxAltitude,
    ascent,
    maxGrade,
  };
}
