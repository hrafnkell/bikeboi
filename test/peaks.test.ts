import { describe, expect, test } from 'bun:test';
import { peakLabel, peakPowers } from '../src/ride/peaks.ts';

describe('peak powers', () => {
  test('finds the best window averages and skips windows longer than the ride', () => {
    const power = Array.from({ length: 90 }, (_, i) => (i >= 30 && i < 50 ? 400 : 200));
    const p = peakPowers(power);
    expect(p[5]).toBe(400);
    expect(p[20]).toBe(400);
    expect(p[60]).toBe(Math.round((20 * 400 + 40 * 200) / 60));
    expect(p[300]).toBeUndefined();
    expect(p[1200]).toBeUndefined();
  });

  test('handles short, empty and odd input', () => {
    expect(peakPowers([])).toEqual({});
    expect(peakPowers([100, 200, 300])).toEqual({});
    expect(peakPowers([100, NaN, -50, 300, 400], [5])).toEqual({ 5: 160 });
  });

  test('labels', () => {
    expect(peakLabel(5)).toBe('5 s');
    expect(peakLabel(60)).toBe('1 min');
    expect(peakLabel(1200)).toBe('20 min');
  });
});
