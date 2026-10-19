// Virtual gears. Gears never change game speed; they change the gradient the trainer is told.

import { G0 } from '../types.ts';

/**
 * Sequential virtual gear ratios, easiest first. The span is Zwift's 24 (0.75 to 5.49) with
 * room below, since on a trainer the lightest gear a real cassette gives is not light enough
 * for a long 7 % in the saddle; the steps are about 13 % (a touch coarser than a cassette)
 * so a meaningful change is one or two clicks rather than three or four.
 */
export const GEAR_COUNT = 20;

/** A middling real ratio (50/21, 36/15, 34/14): rides start in the gear nearest it. */
export const REFERENCE_RATIO = 2.4;

/** The default span, and how far the rider may stretch it either way. */
export const GEAR_SPAN = { low: 0.55, high: 5.49 } as const;
export const GEAR_LOW_RANGE = { min: 0.3, max: 1.5 } as const;
export const GEAR_HIGH_RANGE = { min: 3, max: 8 } as const;

/**
 * The gear table for a span: GEAR_COUNT ratios from low to high in even (geometric) steps,
 * passing exactly through the reference ratio (the ranges keep it inside every span).
 */
export function buildGears(low: number = GEAR_SPAN.low, high: number = GEAR_SPAN.high): number[] {
  low = Math.min(Math.max(low, GEAR_LOW_RANGE.min), GEAR_LOW_RANGE.max);
  high = Math.min(Math.max(high, GEAR_HIGH_RANGE.min), GEAR_HIGH_RANGE.max);
  const steps = GEAR_COUNT - 1;
  const out: number[] = [];
  const below = Math.round((steps * Math.log(REFERENCE_RATIO / low)) / Math.log(high / low));
  for (let i = 0; i < GEAR_COUNT; i++) {
    const r = i <= below
      ? REFERENCE_RATIO * Math.pow(REFERENCE_RATIO / low, (i - below) / below)
      : REFERENCE_RATIO * Math.pow(high / REFERENCE_RATIO, (i - below) / (steps - below));
    out.push(Math.round(r * 100) / 100);
  }
  return out;
}

/** The index of the gear nearest the reference ratio: where a ride starts. */
export function startGear(ratios: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < ratios.length; i++) {
    if (Math.abs(Math.log(ratios[i] / REFERENCE_RATIO)) < Math.abs(Math.log(ratios[best] / REFERENCE_RATIO))) best = i;
  }
  return best;
}

export const GEAR_RATIOS: readonly number[] = buildGears();

/** The gear in which the trainer is told the true gradient (ratio 2.40) in the default table. */
export const REFERENCE_GEAR = startGear(GEAR_RATIOS);

export const WHEEL_CIRCUMFERENCE = 2.105; // m

export function clampGear(index: number): number {
  return Math.min(GEAR_COUNT - 1, Math.max(0, Math.round(index)));
}

/** Ratio of the selected gear to the reference gear. */
export function gearFactor(index: number, reference = REFERENCE_GEAR): number {
  return GEAR_RATIOS[clampGear(index)] / GEAR_RATIOS[clampGear(reference)];
}

/** Cadence (rpm) that would give this road speed in this gear. */
export function cadenceFor(speed: number, index: number, ratios: readonly number[] = GEAR_RATIOS): number {
  return (speed / (ratios[clampGear(index)] * WHEEL_CIRCUMFERENCE)) * 60;
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

/** Wheel speed the trainer sees at this cadence in a given physical ratio (default: the reference gear). */
export function trainerSpeedFor(cadence: number, ratio = GEAR_RATIOS[REFERENCE_GEAR]): number {
  return (Math.max(0, cadence) / 60) * ratio * WHEEL_CIRCUMFERENCE;
}

/** The physical gear the bike is in, from the trainer's wheel speed and the cadence; null when either is missing. */
export function physicalRatio(wheelSpeed: number, cadence: number): number | null {
  if (!(wheelSpeed > 1) || !(cadence > 30)) return null;
  const ratio = wheelSpeed / ((cadence / 60) * WHEEL_CIRCUMFERENCE);
  return ratio >= 0.8 && ratio <= 7 ? ratio : null;
}

/** Keeps a smoothed estimate of the physical ratio, starting from the reference gear. */
export class RatioEstimator {
  ratio = GEAR_RATIOS[REFERENCE_GEAR];
  private samples = 0;
  /** Feed a reading; returns the current estimate. */
  update(wheelSpeed: number, cadence: number): number {
    const r = physicalRatio(wheelSpeed, cadence);
    if (r !== null) {
      // the first readings replace the assumption quickly, later ones nudge it
      const weight = this.samples < 5 ? 0.5 : 0.08;
      this.ratio += (r - this.ratio) * weight;
      this.samples++;
    }
    return this.ratio;
  }
}

export interface GearedInput {
  /** True course gradient, fraction. */
  courseGrade: number;
  /** Selected ratio / the physical ratio the bike is in. */
  k: number;
  /** Wheel speed the trainer is measuring (or, failing that, cadence x physical ratio), m/s. */
  trainerSpeed: number;
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
 * Model-based rule. The bike is in physical ratio r, so the trainer's wheel speed is
 * v_t = cadence x r. In virtual gear with ratio k r the same cadence would move a real bike
 * at k v_t, against k times the force at the pedals (gearing). So the trainer must produce
 *   F = k (m g (G + crr) + cw (k v_t)^2)
 * All of it goes through the gradient field: trainers honour the gradient but not reliably
 * the wind resistance coefficient (a JetBlack Victory applied 13 % of it), so the aero part
 * is computed here from the measured wheel speed and sent as gradient, with the wind
 * resistance field set to zero and the rolling resistance field left at the default.
 */
export function gearedSimGrade(i: GearedInput): SimControl {
  const k = Math.max(0.05, i.k);
  const G = i.courseGrade * i.difficulty;
  const aero = (k * k * k * i.cw * i.trainerSpeed * i.trainerSpeed) / (i.mass * G0);
  const grade = clampGrade(k * (G + i.crr) - i.crr + aero, i.minGrade, i.maxGrade);
  return { ...grade, crr: i.crr, cw: 0 };
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
