// Estimated energy burned, from mechanical work at the pedals.

/** Fraction of metabolic energy that reaches the pedals; 0.20-0.25 is typical for cycling. */
export const GROSS_EFFICIENCY = 0.24;

const JOULES_PER_KCAL = 4184;

/** Estimated kilocalories burned for a given amount of pedalling work in joules. */
export function kcalFromJoules(joules: number): number {
  if (!Number.isFinite(joules) || joules <= 0) return 0;
  return joules / JOULES_PER_KCAL / GROSS_EFFICIENCY;
}
