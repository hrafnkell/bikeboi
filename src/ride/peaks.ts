// Best average power over fixed windows, from one-per-second samples.

export const PEAK_WINDOWS = [5, 20, 60, 300, 1200] as const;

export type PeakPowers = Partial<Record<(typeof PEAK_WINDOWS)[number], number>>;

/** Highest mean of each window in whole watts; windows longer than the ride are left out. */
export function peakPowers(power: number[], windows: readonly number[] = PEAK_WINDOWS): PeakPowers {
  const out: PeakPowers = {};
  const n = power.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + Math.max(0, Number.isFinite(power[i]) ? power[i] : 0);
  for (const w of windows) {
    if (w > n) continue;
    let best = 0;
    for (let i = w; i <= n; i++) best = Math.max(best, prefix[i] - prefix[i - w]);
    out[w as (typeof PEAK_WINDOWS)[number]] = Math.round(best / w);
  }
  return out;
}

export function peakLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}
