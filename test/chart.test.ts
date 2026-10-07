import { describe, expect, test } from 'bun:test';
import { CHART_HEIGHT, CHART_MARGIN, downsample, layoutLine, niceTicks, restorePeak, timeTicks } from '../src/charts/line-math.ts';

describe('chart helpers', () => {
  test('downsample keeps short series as they are', () => {
    const pts = downsample([10, 20, 30], 100);
    expect(pts).toEqual([{ t: 0, v: 10 }, { t: 1, v: 20 }, { t: 2, v: 30 }]);
  });

  test('downsample averages buckets and centres their time', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const pts = downsample(values, 10);
    expect(pts.length).toBe(10);
    expect(pts[0]).toEqual({ t: 4.5, v: 4.5 });
    expect(pts[9]).toEqual({ t: 94.5, v: 94.5 });
  });

  test('downsample ignores gaps inside a bucket and keeps empty buckets as gaps', () => {
    const pts = downsample([100, null, null, null, 140, 160], 3);
    expect(pts.map((p) => p.v)).toEqual([100, null, 150]);
    expect(downsample([], 10)).toEqual([]);
  });

  test('the true peak survives averaging', () => {
    const values: Array<number | null> = Array.from({ length: 100 }, () => 200);
    values[37] = 900;
    const pts = downsample(values, 10);
    expect(pts[3].v).toBe(270); // flattened by the bucket mean
    const bucket = restorePeak(pts, values);
    expect(bucket).toBe(3);
    expect(pts[3]).toEqual({ t: 37, v: 900 });
    expect(pts[2].v).toBe(200);
    expect(restorePeak([], [])).toBe(-1);
    expect(restorePeak(downsample([null, null], 5), [null, null])).toBe(-1);
  });

  test('nice ticks are round and cover the range', () => {
    expect(niceTicks(0, 412, 4)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(niceTicks(0, 180, 4)).toEqual([0, 50, 100, 150, 200]);
    const hr = niceTicks(118, 171, 4);
    expect(hr[0]).toBeLessThanOrEqual(118);
    expect(hr[hr.length - 1]).toBeGreaterThanOrEqual(171);
    expect(new Set(hr.slice(1).map((v, i) => v - hr[i])).size).toBe(1);
  });

  test('nice ticks survive flat or bad ranges', () => {
    expect(niceTicks(150, 150).length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(NaN, 5)).toEqual([0, 1]);
  });

  test('time ticks use clock-friendly steps', () => {
    expect(timeTicks(38, 6)).toEqual([0, 10, 20, 30]);
    expect(timeTicks(3600, 6)).toEqual([0, 600, 1200, 1800, 2400, 3000, 3600]);
    expect(timeTicks(463, 4)).toEqual([0, 120, 240, 360]);
    expect(timeTicks(5, 6)).toEqual([0, 5]);
  });
});

describe('layoutLine', () => {
  test('lays out a zero-based series with ticks, paths and the exact peak', () => {
    const values = Array.from({ length: 600 }, (_, i) => 200 + (i % 50));
    values[333] = 412;
    const l = layoutLine(values, 600, true)!;
    expect(l).not.toBeNull();
    expect(l.plotX).toBe(CHART_MARGIN.left);
    expect(l.plotWidth).toBe(600 - CHART_MARGIN.left - CHART_MARGIN.right);
    expect(l.plotHeight).toBe(CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom);
    expect(l.valueTicks[0]).toMatchObject({ value: 0, axis: true, y: CHART_MARGIN.top + l.plotHeight });
    expect(l.valueTicks.filter((t) => t.axis).length).toBe(1);
    expect(l.timeTicks[0]).toMatchObject({ t: 0, anchor: 'start', x: CHART_MARGIN.left });
    expect(l.linePath.startsWith('M')).toBe(true);
    expect(l.linePath.split('M').length - 1).toBe(1); // one unbroken run
    expect(l.areaPath.endsWith('Z')).toBe(true);
    expect(l.peak).toMatchObject({ t: 333, v: 412 });
    expect(l.peakLabel.text).toBe('412');
    expect(l.peakLabel.y).toBeLessThan(l.peak.y);
    expect(l.points.every((p) => p.x >= l.plotX && p.x <= l.plotX + l.plotWidth)).toBe(true);
  });

  test('breaks the line at gaps and skips the area when not zero-based', () => {
    const values: Array<number | null> = Array.from({ length: 300 }, (_, i) => 120 + (i % 20));
    for (let i = 100; i < 140; i++) values[i] = null;
    const l = layoutLine(values, 400, false)!;
    expect(l.linePath.split('M').length - 1).toBe(2); // two runs either side of the gap
    expect(l.valueTicks[0].value).toBeGreaterThan(0); // axis starts near the data, not at zero
    expect(l.points.every((p) => p.v !== null)).toBe(true);
  });

  test('peak label stays inside the plot at the edges', () => {
    const values = Array.from({ length: 100 }, () => 100);
    values[99] = 300;
    const l = layoutLine(values, 500, true)!;
    expect(l.peakLabel.anchor).toBe('end');
    expect(l.peakLabel.x).toBeLessThanOrEqual(l.plotX + l.plotWidth);
    values[99] = 100;
    values[0] = 300;
    expect(layoutLine(values, 500, true)!.peakLabel.anchor).toBe('start');
  });

  test('returns null with nothing to draw', () => {
    expect(layoutLine([], 500, true)).toBeNull();
    expect(layoutLine([null, null], 500, false)).toBeNull();
  });
});
