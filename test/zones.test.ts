import { describe, expect, test } from 'bun:test';
import { POWER_ZONES, powerZone, timeInZones, zoneColor } from '../src/ride/zones.ts';

describe('power zones', () => {
  test('bounds follow the FTP fractions', () => {
    expect(powerZone(0, 250)).toBe(0);
    expect(powerZone(100, 0)).toBe(0);
    expect(powerZone(100, 250)).toBe(1);
    expect(powerZone(137.5, 250)).toBe(2);
    expect(powerZone(190, 250)).toBe(3);
    expect(powerZone(250, 250)).toBe(4);
    expect(powerZone(270, 250)).toBe(5);
    expect(powerZone(310, 250)).toBe(6);
    expect(powerZone(900, 250)).toBe(7);
  });
  test('colours are distinct and the count matches', () => {
    expect(new Set(POWER_ZONES.map((z) => z.color)).size).toBe(7);
    expect(zoneColor(7)).toBe(POWER_ZONES[6].color);
    expect(zoneColor(0)).toBe(POWER_ZONES[0].color);
  });
  test('time in zones counts one second per sample', () => {
    const t = timeInZones([null, 0, 100, 100, 260, 400], 250);
    expect(t).toEqual([2, 2, 0, 0, 1, 0, 0, 1]);
    expect(t.reduce((a, b) => a + b)).toBe(6);
  });
});
