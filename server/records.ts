// Personal records across a rider's saved rides, from the summaries and peak powers the
// client sent with each ride. Pure: the route feeds it rows, tests feed it objects.

export const RECORD_KEYS = ['distance', 'duration', 'ascent', 'work', 'avgPower', 'avgSpeed'] as const;
export type RecordKey = (typeof RECORD_KEYS)[number];
export const PEAK_KEYS = ['5', '10', '20', '30', '60', '300', '1200'] as const;

/** Rides shorter than this do not set average-power or average-speed records. */
export const MIN_AVERAGE_SECONDS = 600;

export interface RecordRide {
  id: string;
  startedAt: number;
  circuitName: string;
  summary: { durationS: number; distanceM: number; ascentM: number; avgPower: number; avgSpeed: number };
  peaks: Record<string, number> | null;
}

export interface RecordEntry {
  value: number;
  rideId: string;
  startedAt: number;
  circuitName: string;
}

export interface Records {
  rides: number;
  records: Partial<Record<RecordKey, RecordEntry>>;
  peaks: Partial<Record<(typeof PEAK_KEYS)[number], RecordEntry>>;
}

/** The candidate values one ride offers for each record; missing where the ride does not qualify. */
export function candidates(r: RecordRide): Partial<Record<RecordKey, number>> {
  const s = r.summary;
  const out: Partial<Record<RecordKey, number>> = {
    distance: s.distanceM,
    duration: s.durationS,
    ascent: s.ascentM,
    work: s.durationS * s.avgPower,
  };
  if (s.durationS >= MIN_AVERAGE_SECONDS) {
    out.avgPower = s.avgPower;
    out.avgSpeed = s.avgSpeed;
  }
  return out;
}

export function collectRecords(rides: RecordRide[]): Records {
  const out: Records = { rides: rides.length, records: {}, peaks: {} };
  const entry = (r: RecordRide, value: number): RecordEntry => ({ value, rideId: r.id, startedAt: r.startedAt, circuitName: r.circuitName });
  for (const r of rides) {
    const c = candidates(r);
    for (const k of RECORD_KEYS) {
      const v = c[k];
      if (v === undefined || !(v > 0)) continue;
      const cur = out.records[k];
      if (!cur || v > cur.value) out.records[k] = entry(r, v);
    }
    for (const w of PEAK_KEYS) {
      const v = Number(r.peaks?.[w]);
      if (!(v > 0)) continue;
      const cur = out.peaks[w];
      if (!cur || v > cur.value) out.peaks[w] = entry(r, v);
    }
  }
  return out;
}

/** Which records a new ride beats, against the records before it. */
export function brokenRecords(before: Records, ride: RecordRide): string[] {
  const broken: string[] = [];
  const c = candidates(ride);
  for (const k of RECORD_KEYS) {
    const v = c[k];
    if (v === undefined || !(v > 0)) continue;
    const cur = before.records[k];
    if (!cur || v > cur.value) broken.push(k);
  }
  for (const w of PEAK_KEYS) {
    const v = Number(ride.peaks?.[w]);
    if (!(v > 0)) continue;
    const cur = before.peaks[w];
    if (!cur || v > cur.value) broken.push(`peak${w}`);
  }
  return broken;
}
