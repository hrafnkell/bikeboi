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

function clampGrade(grade: number, minGrade: number, maxGrade: number): SimGrade {
  if (grade < minGrade) return { grade: minGrade, saturated: -1 };
  if (grade > maxGrade) return { grade: maxGrade, saturated: 1 };
  return { grade, saturated: 0 };
}

export interface GearedInput {
  /** True course gradient, fraction. */
  courseGrade: number;
  /** Selected ratio / reference ratio. */
  k: number;
  /** Game road speed, m/s. */
  gameSpeed: number;
  /** Rider + bike, kg. */
  mass: number;
  crr: number;
  /** 0.5 * rho * CdA, kg/m. */
  cw: number;
  /** Scales how much of the course gradient is felt, 0..1. */
  difficulty: number;
  minGrade: number;
  maxGrade: number;
}

/**
 * Model-based rule. The trainer simulates a bike in the reference gear; to feel like gear k
 * at the same pedalling speed it must produce k times the force of the road at k times the
 * wheel speed. Solving for the gradient that does this:
 *   sent = k (G + crr) - crr + cw v^2 (k - 1/k^2) / (m g)
 * with v the game speed.
 */
export function gearedSimGrade(i: GearedInput): SimGrade {
  const k = Math.max(0.05, i.k);
  const G = i.courseGrade * i.difficulty;
  const aero = (i.cw * i.gameSpeed * i.gameSpeed * (k - 1 / (k * k))) / (i.mass * G0);
  return clampGrade(k * (G + i.crr) - i.crr + aero, i.minGrade, i.maxGrade);
}

export interface OffsetInput {
  courseGrade: number;
  gearIndex: number;
  neutralIndex: number;
  /** Gradient added per gear step, fraction. */
  stepGrade: number;
  difficulty: number;
  minGrade: number;
  maxGrade: number;
}

/** Fallback rule with no physical model: each gear step adds a fixed amount of gradient. */
export function offsetSimGrade(i: OffsetInput): SimGrade {
  const grade = i.courseGrade * i.difficulty + (i.gearIndex - i.neutralIndex) * i.stepGrade;
  return clampGrade(grade, i.minGrade, i.maxGrade);
}
