import { describe, expect, test } from 'bun:test';
import { settingsR } from '../src/ui/store.ts';
import { altValue, fmtAlt, fmtDist, fmtShort, fmtSpeed, massToKg, massValue, unitLabels } from '../src/ui/units.ts';

describe('units', () => {
  test('metric is the plain numbers', () => {
    settingsR.units = 'metric';
    expect(fmtDist(4990)).toBe('4.99 km');
    expect(fmtAlt(73.4)).toBe('73 m');
    expect(fmtSpeed(10)).toBe('36.0 km/h');
    expect(fmtShort(300)).toBe('300 m');
    expect(fmtShort(1234)).toBe('1.23 km');
    expect(fmtShort(123, 5)).toBe('125 m');
    expect(massValue(75)).toBe(75);
    expect(unitLabels().mass).toBe('kg');
  });

  test('imperial converts and rounds the same way', () => {
    settingsR.units = 'imperial';
    expect(fmtDist(1609.344)).toBe('1.00 mi');
    expect(fmtAlt(100)).toBe('328 ft');
    expect(altValue(0.3048)).toBeCloseTo(1, 9);
    expect(fmtSpeed(10)).toBe('22.4 mph');
    expect(fmtShort(100)).toBe('328 ft');
    expect(fmtShort(100, 5)).toBe('330 ft');
    expect(fmtShort(800)).toBe('0.50 mi');
    expect(Math.round(massValue(75))).toBe(165);
    expect(massToKg(165)).toBeCloseTo(74.84, 2);
    expect(unitLabels()).toEqual({ dist: 'mi', short: 'ft', alt: 'ft', speed: 'mph', mass: 'lb' });
    settingsR.units = 'metric';
  });
});
