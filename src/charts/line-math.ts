// Pure chart maths for the line chart: downsampling, axis ticks and the peak.

export interface ChartPoint {
  /** Seconds of ride time. */
  t: number;
  /** null where there was no reading. */
  v: number | null;
}

/** Bucket-average a one-per-second series down to at most maxPoints, keeping gaps as null. */
export function downsample(values: Array<number | null>, maxPoints: number): ChartPoint[] {
  const n = values.length;
  const size = Math.max(1, Math.ceil(n / Math.max(1, maxPoints)));
  const out: ChartPoint[] = [];
  for (let start = 0; start < n; start += size) {
    const end = Math.min(n, start + size);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (v !== null && Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    out.push({ t: (start + end - 1) / 2, v: count > 0 ? sum / count : null });
  }
  return out;
}

/**
 * Averaging flattens the single highest reading, so put it back: the bucket holding the
 * series maximum takes that reading's exact time and value. Returns its index, or -1.
 */
export function restorePeak(points: ChartPoint[], values: Array<number | null>): number {
  let at = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v) && (at < 0 || v > (values[at] as number))) at = i;
  }
  if (at < 0 || points.length === 0) return -1;
  const size = Math.ceil(values.length / points.length);
  const bucket = Math.min(points.length - 1, Math.floor(at / size));
  points[bucket] = { t: at, v: values[at] };
  return bucket;
}

/** Round axis values covering [min, max] with roughly `count` steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max <= min) max = min + 1;
  const span = max - min;
  const mag = 10 ** Math.floor(Math.log10(span / Math.max(1, count)));
  // the round step whose interval count lands closest to the one asked for
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * mag)
    .reduce((a, b) => (Math.abs(span / b - count) < Math.abs(span / a - count) ? b : a));
  const first = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const TIME_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** Clock-friendly tick positions in seconds for a ride of the given length. */
export function timeTicks(durationS: number, maxTicks = 6): number[] {
  const step = TIME_STEPS.find((s) => durationS / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = 0; t <= durationS + 1e-6; t += step) ticks.push(t);
  return ticks;
}

// --- geometry for one line chart --------------------------------------------------------

export const CHART_HEIGHT = 170;
export const CHART_MARGIN = { left: 38, right: 14, top: 16, bottom: 22 };

export interface LinePoint {
  t: number;
  v: number;
  x: number;
  y: number;
}

export interface LineLayout {
  /** Plot area, px. */
  plotX: number;
  plotY: number;
  plotWidth: number;
  plotHeight: number;
  /** Value axis: lines and labels. */
  valueTicks: Array<{ value: number; y: number; axis: boolean }>;
  /** Time axis labels (seconds and their x), with the first anchored at its start. */
  timeTicks: Array<{ t: number; x: number; anchor: 'start' | 'middle' }>;
  /** SVG path data for the line (broken at gaps) and the area under it down to the baseline. */
  linePath: string;
  areaPath: string;
  /** The highest reading, kept exact through the downsampling. */
  peak: LinePoint;
  peakLabel: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; text: string };
  /** Every drawn point with its screen position, for hover. */
  points: LinePoint[];
}

/**
 * Everything the chart template needs for a series of one reading per second, at a
 * given width. Returns null when there is nothing to draw. Two series share a chart by
 * being laid out with the same `duration` and `rightAxis`, so their time axes coincide.
 */
export function layoutLine(
  values: Array<number | null>, width: number, zeroBased: boolean, opts: { rightAxis?: boolean; duration?: number } = {},
): LineLayout | null {
  // a right-hand value axis (a second series) needs room for its labels
  const M = opts.rightAxis ? { ...CHART_MARGIN, right: 40 } : CHART_MARGIN;
  const duration = Math.max(1, opts.duration ?? values.length - 1);
  const pw = Math.max(10, width - M.left - M.right);
  const ph = CHART_HEIGHT - M.top - M.bottom;
  const sampled = downsample(values, Math.max(40, Math.floor(pw / 2)));
  const peakAt = restorePeak(sampled, values);
  const present = sampled.filter((p): p is { t: number; v: number } => p.v !== null);
  if (present.length === 0 || peakAt < 0) return null;

  const lo = zeroBased ? 0 : Math.min(...present.map((p) => p.v));
  const hi = Math.max(...present.map((p) => p.v));
  const ticks = niceTicks(zeroBased ? 0 : lo - (hi - lo) * 0.1 - 1, hi + (hi - lo) * 0.05 + 1, 4);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (t: number) => M.left + (t / duration) * pw;
  const y = (v: number) => M.top + ph - ((v - y0) / (y1 - y0)) * ph;

  // line (broken at gaps) and area wash
  let linePath = '';
  let areaPath = '';
  let run: Array<{ t: number; v: number }> = [];
  const flush = () => {
    if (run.length === 0) return;
    const d = run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    linePath += d;
    areaPath += `${d}L${x(run[run.length - 1].t).toFixed(1)},${y(y0).toFixed(1)}L${x(run[0].t).toFixed(1)},${y(y0).toFixed(1)}Z`;
    run = [];
  };
  for (const p of sampled) {
    if (p.v === null) flush();
    else run.push({ t: p.t, v: p.v });
  }
  flush();

  const peakRaw = sampled[peakAt] as { t: number; v: number };
  const peakX = x(peakRaw.t);
  const peak: LinePoint = { t: peakRaw.t, v: peakRaw.v, x: peakX, y: y(peakRaw.v) };

  return {
    plotX: M.left,
    plotY: M.top,
    plotWidth: pw,
    plotHeight: ph,
    valueTicks: ticks.map((value) => ({ value, y: y(value), axis: value === y0 })),
    timeTicks: timeTicks(duration, Math.max(2, Math.floor(pw / 70))).map((t) => ({
      t, x: x(t), anchor: t === 0 ? 'start' : 'middle',
    })),
    linePath,
    areaPath,
    peak,
    peakLabel: {
      x: Math.min(M.left + pw - 4, Math.max(M.left + 4, peakX)),
      y: Math.max(11, peak.y - 8),
      anchor: peakX > M.left + pw - 30 ? 'end' : peakX < M.left + 30 ? 'start' : 'middle',
      text: `${Math.round(peak.v)}`,
    },
    points: present.map((p) => ({ t: p.t, v: p.v, x: x(p.t), y: y(p.v) })),
  };
}
