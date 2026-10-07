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
