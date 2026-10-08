// Elevation profiles for the start screen, all on one vertical scale so a flat circuit
// looks flat next to a mountainous one.

import type { Circuit } from '../ride/circuit.ts';
import { circuits } from '../ride/circuits/index.ts';

/** The biggest altitude range among the built-in circuits: the full height of a profile. */
export const REFERENCE_RANGE = Math.max(...circuits.map((c) => c.maxAltitude - c.minAltitude));

export interface ProfileShape {
  /** SVG polygon points, closed along the bottom. */
  points: string;
  /** Where the lap line / leg joins fall, as x positions. */
  joins: number[];
  /** Lowest/highest y the line reaches. */
  top: number;
  bottom: number;
  /** The y of REFERENCE_RANGE above the bottom: the fill gradient runs from bottom to here. */
  scaleTop: number;
}

/**
 * A polygon of the circuit's profile in a W x H box. Heights are relative to REFERENCE_RANGE
 * (or the circuit's own range when it is taller), with a small minimum so a flat road still
 * shows as a strip.
 */
export function profileShape(c: Circuit, W: number, H: number, samples = 100): ProfileShape {
  const range = Math.max(REFERENCE_RANGE, c.maxAltitude - c.minAltitude, 1);
  const floor = H - 3;
  const usable = H - 8;
  const minRise = 2;
  const pts: string[] = [`0,${H}`];
  let top = floor;
  for (let i = 0; i <= samples; i++) {
    const a = (c.altitudeAt((i / samples) * c.length) - c.minAltitude) / range;
    const y = floor - minRise - a * usable;
    top = Math.min(top, y);
    pts.push(`${((i / samples) * W).toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  const joins = (c.legs ?? []).slice(1).map((l) => (l.start / c.length) * W);
  return { points: pts.join(' '), joins, top, bottom: floor - minRise, scaleTop: floor - minRise - usable };
}
