// Metric or imperial for everything shown; the ride itself is always in metres and m/s.
// Reads the reactive settings so Vue templates follow a change at once.

import { settingsR } from './store.ts';

export type UnitSystem = 'metric' | 'imperial';

const MILE = 1609.344;
const FOOT = 0.3048;
const POUND = 0.45359237;

export function imperial(): boolean {
  return settingsR.units === 'imperial';
}

/** Unit labels for the current system. */
export function unitLabels() {
  return imperial()
    ? { dist: 'mi', short: 'ft', alt: 'ft', speed: 'mph', mass: 'lb' }
    : { dist: 'km', short: 'm', alt: 'm', speed: 'km/h', mass: 'kg' };
}

/** Long distances as a number in km or miles. */
export function distValue(metres: number): number {
  return imperial() ? metres / MILE : metres / 1000;
}
export function altValue(metres: number): number {
  return imperial() ? metres / FOOT : metres;
}
export function speedValue(mps: number): number {
  return imperial() ? (mps / MILE) * 3600 : mps * 3.6;
}
export function massValue(kg: number): number {
  return imperial() ? kg / POUND : kg;
}
export function massToKg(value: number): number {
  return imperial() ? value * POUND : value;
}

/** "4.99 km" / "3.10 mi" */
export function fmtDist(metres: number, digits = 2): string {
  return `${distValue(metres).toFixed(digits)} ${unitLabels().dist}`;
}
/** "73 m" / "240 ft" */
export function fmtAlt(metres: number): string {
  return `${Math.round(altValue(metres))} ${unitLabels().alt}`;
}
/** "32.5 km/h" / "20.2 mph" */
export function fmtSpeed(mps: number, digits = 1): string {
  return `${speedValue(mps).toFixed(digits)} ${unitLabels().speed}`;
}
/**
 * A distance that may be short: metres / feet below a kilometre or a quarter mile,
 * the long unit above. `step` rounds the short form (5 → to the nearest 5 m or ft).
 */
export function fmtShort(metres: number, step = 1): string {
  if (imperial()) {
    if (metres >= MILE / 4) return `${(metres / MILE).toFixed(2)} mi`;
    const ft = metres / FOOT;
    return `${Math.max(0, Math.round(ft / step) * step)} ft`;
  }
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.max(0, Math.round(metres / step) * step)} m`;
}
