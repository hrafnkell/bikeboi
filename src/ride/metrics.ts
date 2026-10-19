// Training numbers for a finished ride: normalized power, intensity and stress against the
// rider's FTP, work, an FTP estimate from the best 20 minutes, and heart-rate drift.

export interface RideMetrics {
  /** Normalized power, W: the 4-norm of 30 s rolling means. */
  np: number;
  /** np / FTP; null without an FTP. */
  intensity: number | null;
  /** Training stress score, 100 = an hour at FTP; null without an FTP. */
  tss: number | null;
  /** kJ of pedalling work. */
  workKj: number;
  /** 95 % of the best 20 minutes; null when the ride was shorter. */
  ftpEstimate: number | null;
  /** Pw:Hr decoupling in percent: how much the power per heartbeat fell from the first half to the second. null without enough heart-rate data. */
  hrDrift: number | null;
  /** The FTP the numbers were measured against. */
  ftp: number;
}

export const NP_WINDOW = 30;
export const FTP_FROM_20_MIN = 0.95;
/** The shortest ride that gets a drift figure, seconds. */
export const DRIFT_MIN_SECONDS = 1200;

/** Normalized power from one-per-second samples; the plain mean for rides shorter than the window. */
export function normalizedPower(power: number[]): number {
  const n = power.length;
  if (n === 0) return 0;
  const clean = power.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  if (n < NP_WINDOW) return Math.round(clean.reduce((a, b) => a + b, 0) / n);
  let sum = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    sum += clean[i];
    if (i >= NP_WINDOW) sum -= clean[i - NP_WINDOW];
    if (i >= NP_WINDOW - 1) acc += Math.pow(sum / NP_WINDOW, 4);
  }
  return Math.round(Math.pow(acc / (n - NP_WINDOW + 1), 0.25));
}

/** The drop in power per heartbeat from the first half of the ride to the second, in percent (positive = drifting). */
export function heartRateDrift(samples: ReadonlyArray<{ power: number; heartRate: number }>): number | null {
  if (samples.length < DRIFT_MIN_SECONDS) return null;
  const withHr = samples.filter((s) => s.heartRate > 0);
  if (withHr.length < samples.length * 0.9) return null;
  const half = Math.floor(withHr.length / 2);
  const ratio = (part: typeof withHr) => {
    const p = part.reduce((a, s) => a + Math.max(0, s.power), 0) / part.length;
    const h = part.reduce((a, s) => a + s.heartRate, 0) / part.length;
    return p > 50 && h > 80 ? p / h : null;
  };
  const first = ratio(withHr.slice(0, half));
  const second = ratio(withHr.slice(half));
  if (first === null || second === null) return null;
  return Math.round(((first - second) / first) * 1000) / 10;
}

export function rideMetrics(
  samples: ReadonlyArray<{ power: number; heartRate: number }>,
  ftp: number,
  peaks: Record<string, number | undefined> = {},
): RideMetrics {
  const power = samples.map((s) => s.power);
  const np = normalizedPower(power);
  const seconds = samples.length;
  const hasFtp = Number.isFinite(ftp) && ftp > 0;
  const intensity = hasFtp ? Math.round((np / ftp) * 100) / 100 : null;
  const tss = hasFtp ? Math.round(((seconds * np * (np / ftp)) / (ftp * 3600)) * 100) : null;
  const best20 = peaks['1200'];
  return {
    np,
    intensity,
    tss,
    workKj: Math.round(power.reduce((a, p) => a + (Number.isFinite(p) && p > 0 ? p : 0), 0) / 1000),
    ftpEstimate: best20 !== undefined && best20 > 0 ? Math.round(best20 * FTP_FROM_20_MIN) : null,
    hrDrift: heartRateDrift(samples),
    ftp: hasFtp ? ftp : 0,
  };
}
