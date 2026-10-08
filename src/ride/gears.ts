// Virtual gears. Gears never change game speed; they change the gradient the trainer is told.

import { G0 } from '../types.ts';

/** Sequential virtual gear ratios, easiest first. */
export const GEAR_RATIOS: readonly number[] = [
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.4, 2.61, 2.82, 3.03, 3.24,
  3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49,
];

export const GEAR_COUNT = GEAR_RATIOS.length;

/** The gear in which the trainer is told the true gradient. */
export const REFERENCE_GEAR = 11;

export const WHEEL_CIRCUMFERENCE = 2.105; // m

export function clampGear(index: number): number {
  return Math.min(GEAR_COUNT - 1, Math.max(0, Math.round(index)));
}

/** Ratio of the selected gear to the reference gear. */
export function gearFactor(index: number, reference = REFERENCE_GEAR): number {
  return GEAR_RATIOS[clampGear(index)] / GEAR_RATIOS[clampGear(reference)];
}

/** Cadence (rpm) that would give this road speed in this gear. */
export function cadenceFor(speed: number, index: number): number {
  return (speed / (GEAR_RATIOS[clampGear(index)] * WHEEL_CIRCUMFERENCE)) * 60;
}

export interface SimGrade {
  /** Gradient to send to the trainer, as a fraction. */
  grade: number;
  /** -1 clamped at the minimum, 1 clamped at the maximum, 0 within range. */
  saturated: -1 | 0 | 1;
}

/** Everything the trainer is told in simulation mode. */
export interface SimControl extends SimGrade {
  crr: number;
  /** Wind resistance coefficient, kg/m. */
  cw: number;
}

function clampGrade(grade: number, minGrade: number, maxGrade: number): SimGrade {
  if (grade < minGrade) return { grade: minGrade, saturated: -1 };
  if (grade > maxGrade) return { grade: maxGrade, saturated: 1 };
  return { grade, saturated: 0 };
}

/** Wheel speed the trainer sees at this cadence, assuming the bike is in the reference gear. */
export function trainerSpeedFor(cadence: number, reference = REFERENCE_GEAR): number {
  return (Math.max(0, cadence) / 60) * GEAR_RATIOS[clampGear(reference)] * WHEEL_CIRCUMFERENCE;
}

export interface GearedInput {
  /** True course gradient, fraction. */
  courseGrade: number;
  /** Selected ratio / reference ratio. */
  k: number;
  /** Wheel speed the trainer is measuring, m/s (see trainerSpeedFor). */
  trainerSpeed: number;
  /** Rider + bike, kg. */
  mass: number;
  crr: number;
  /** 0.5 * rho * CdA, kg/m. */
  cw: number;
  /** Largest wind resistance coefficient the trainer accepts, kg/m. */
  maxCw: number;
  /** Scales how much of the course gradient is felt, 0..1. */
  difficulty: number;
  minGrade: number;
  maxGrade: number;
}

/**
 * Model-based rule. The bike on the trainer is in the reference gear, so the trainer's
 * wheel speed is v_t = cadence x reference gear. In virtual gear k the same cadence would
 * move a real bike at k v_t, against k times the force at the pedals (gearing). So the
 * trainer must produce
 *   F = k (m g (G + crr) + cw (k v_t)^2) = m g (kG + k crr) + k^3 cw v_t^2
 * which maps straight onto the three simulation parameters: grade kG, crr k crr and wind
 * resistance k^3 cw. The trainer then reacts to cadence on its own, instantly, instead of
 * waiting for the game's speed to catch up (which left descents with no resistance at all).
 * What does not fit in the wind resistance field goes into the gradient using the
 * estimated wheel speed.
 */
export function gearedSimGrade(i: GearedInput): SimControl {
  const k = Math.max(0.05, i.k);
  const G = i.courseGrade * i.difficulty;
  const cw = Math.min(i.maxCw, k * k * k * i.cw);
  const residual = (k * k * k * i.cw - cw) * i.trainerSpeed * i.trainerSpeed;
  const grade = clampGrade(k * G + residual / (i.mass * G0), i.minGrade, i.maxGrade);
  return { ...grade, crr: k * i.crr, cw };
}

export interface OffsetInput {
  courseGrade: number;
  gearIndex: number;
  neutralIndex: number;
  /** Gradient added per gear step, fraction. */
  stepGrade: number;
  crr: number;
  cw: number;
  difficulty: number;
  minGrade: number;
  maxGrade: number;
}

/** Fallback rule with no physical model: each gear step adds a fixed amount of gradient. */
export function offsetSimGrade(i: OffsetInput): SimControl {
  const grade = i.courseGrade * i.difficulty + (i.gearIndex - i.neutralIndex) * i.stepGrade;
  return { ...clampGrade(grade, i.minGrade, i.maxGrade), crr: i.crr, cw: i.cw };
}
