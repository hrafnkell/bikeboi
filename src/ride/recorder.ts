// Records a ride at 1 Hz, autosaves it as it goes and turns it into a FIT activity file.

import type { RideLap, RideMeta, RideSample } from '../types.ts';
import { kcalFromJoules } from './energy.ts';
import { defaultRideStore } from './ride-store.ts';
import type { RideEvent, RideStore, SavedRide } from './ride-store.ts';

export interface RideSummary {
  durationS: number; // timer time, pauses excluded
  distanceM: number;
  avgPower: number; // W, zeros included
  maxPower: number;
  avgHeartRate: number; // bpm over samples with a reading, 0 when none
  avgCadence: number; // rpm over samples while pedalling
  avgSpeed: number; // m/s
  ascentM: number;
  calories: number; // kcal, estimated from pedalling work
  laps: number; // completed circuit laps
}

export interface FinishedRide {
  fit: Uint8Array;
  filename: string;
  summary: RideSummary;
  ride: SavedRide;
}

const FIT_INVALID_UINT8 = 0xff;

function lastOf<T>(xs: T[]): T | undefined {
  return xs[xs.length - 1];
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Strict start/stop pairs ending in a stop. Duplicate consecutive events are dropped, a
 * missing leading start and a missing final stop (e.g. a ride recovered after the tab
 * was killed) are filled in from the samples.
 */
export function repairEvents(ride: SavedRide): RideEvent[] {
  const firstTs = ride.samples[0]?.timestamp ?? ride.meta.startedAt;
  const lastTs = lastOf(ride.samples)?.timestamp ?? firstTs;
  const out: RideEvent[] = [];
  for (const e of ride.events) {
    if (e.type !== 'start' && e.type !== 'stop') continue;
    const prev = lastOf(out);
    if (!prev) {
      if (e.type === 'stop') out.push({ timestamp: Math.min(firstTs, e.timestamp), type: 'start' });
    } else if (prev.type === e.type) {
      continue;
    }
    out.push({ timestamp: Math.max(e.timestamp, lastOf(out)?.timestamp ?? e.timestamp), type: e.type });
  }
  if (out.length === 0) out.push({ timestamp: Math.min(ride.meta.startedAt, firstTs), type: 'start' });
  const tail = lastOf(out)!;
  if (tail.type === 'start') out.push({ timestamp: Math.max(lastTs, tail.timestamp), type: 'stop' });
  return out;
}

function timerMs(events: RideEvent[]): number {
  let total = 0;
  for (let i = 1; i < events.length; i += 2) total += events[i].timestamp - events[i - 1].timestamp;
  return total;
}

export function summarize(ride: SavedRide): RideSummary {
  const { samples } = ride;
  const durationS = samples.length === 0 ? 0 : timerMs(repairEvents(ride)) / 1000;
  const distanceM = lastOf(samples)?.distance ?? 0;
  let ascentM = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const rise = samples[i].altitude - samples[i - 1].altitude;
    if (rise > 0) ascentM += rise;
  }
  return {
    durationS,
    distanceM,
    avgPower: Math.round(mean(samples.map((s) => s.power))),
    maxPower: samples.reduce((m, s) => Math.max(m, s.power), 0),
    avgHeartRate: Math.round(mean(samples.filter((s) => s.heartRate > 0).map((s) => s.heartRate))),
    avgCadence: Math.round(mean(samples.filter((s) => s.cadence > 0).map((s) => s.cadence))),
    avgSpeed: durationS > 0 ? distanceM / durationS : mean(samples.map((s) => s.speed)),
    ascentM,
    // one sample per second, so the sum of watts is the work in joules
    calories: Math.round(kcalFromJoules(samples.reduce((j, s) => j + Math.max(0, s.power), 0))),
    laps: ride.laps.length,
  };
}

function num(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

/** The ride's laps plus the unfinished one, so the file always has at least one lap. */
function fitLaps(ride: SavedRide, startTs: number, endTs: number): RideLap[] {
  const laps = ride.laps
    .filter((l) => Number.isFinite(l.startTime) && Number.isFinite(l.endTime) && l.endTime >= l.startTime)
    .map((l) => ({ ...l }));
  const lastEnd = lastOf(laps)?.endTime;
  if (lastEnd === undefined) {
    laps.push({ startTime: startTs, endTime: endTs });
  } else if (ride.samples.some((s) => s.timestamp > lastEnd) && endTs > lastEnd) {
    laps.push({ startTime: lastEnd, endTime: endTs });
  }
  return laps;
}

export async function encodeFit(ride: SavedRide, ftp?: number): Promise<Uint8Array> {
  if (ride.samples.length === 0) throw new Error('Cannot export a ride with no recorded samples.');

  // @ts-ignore vendored JS without types
  const { localActivity } = await import('../vendor/auuki/fit/local-activity.js');
  // @ts-ignore vendored JS without types
  const { FITjs } = await import('../vendor/auuki/fit/fitjs.js');

  const events = repairEvents(ride);
  const startTs = events[0].timestamp;
  const endTs = Math.max(lastOf(events)!.timestamp, lastOf(ride.samples)!.timestamp);

  // FIT timestamps are whole seconds: keep one record per second
  const records: Record<string, number>[] = [];
  let prevSecond = -Infinity;
  for (const s of ride.samples) {
    const second = Math.round(s.timestamp / 1000);
    if (second <= prevSecond) continue;
    prevSecond = second;
    records.push({
      timestamp: s.timestamp,
      power: Math.max(0, Math.round(num(s.power))),
      cadence: Math.max(0, Math.round(num(s.cadence))),
      speed: Math.max(0, num(s.speed)),
      // no reading is written as FIT's "invalid" marker instead of 0 bpm
      heart_rate: s.heartRate > 0 ? Math.min(254, Math.round(s.heartRate)) : FIT_INVALID_UINT8,
      distance: Math.max(0, num(s.distance)),
      altitude: num(s.altitude),
      grade: num(s.grade),
      device_index: 0,
    });
  }

  const laps = fitLaps(ride, startTs, endTs).map((l) => ({ timestamp: l.endTime, start_time: l.startTime }));
  // the encoder takes the session start from `start_time` of the first event
  const fitEvents = events.map((e, i) => (i === 0 ? { ...e, start_time: e.timestamp } : { ...e }));

  const structure = localActivity.toFITjs({ records, laps, events: fitEvents, ftp: ftp ?? 200 });

  // The encoder's own averages drift (it sums value / n and floors) and count records
  // without a heart-rate reading, so the session stats are computed here.
  const session = structure.find((r: any) => r.type === 'data' && r.name === 'session');
  if (session) {
    const hr = records.map((r) => r.heart_rate).filter((v) => v !== FIT_INVALID_UINT8);
    const avgPower = mean(records.map((r) => r.power));
    Object.assign(session.fields, {
      avg_power: Math.round(avgPower),
      avg_cadence: Math.round(mean(records.map((r) => r.cadence))),
      avg_speed: mean(records.map((r) => r.speed)),
      avg_heart_rate: hr.length > 0 ? Math.round(mean(hr)) : FIT_INVALID_UINT8,
      max_heart_rate: hr.length > 0 ? hr.reduce((m, v) => Math.max(m, v), 0) : FIT_INVALID_UINT8,
      total_calories: Math.round(kcalFromJoules((avgPower * timerMs(events)) / 1000)),
    });
  }

  const view: DataView = FITjs.encode(structure);
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export function fitFilename(meta: RideMeta): string {
  const d = new Date(meta.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const slug = meta.circuitId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ride';
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `bikeboi-${slug}-${date}-${p(d.getHours())}${p(d.getMinutes())}.fit`;
}

/** Browser only. */
export function downloadFit(fit: Uint8Array, filename: string): void {
  const blob = new Blob([fit as BlobPart], { type: 'application/vnd.ant.fit' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Unfinished ride from a previous page load, with its events closed. */
export async function recoverRide(store: RideStore = defaultRideStore()): Promise<SavedRide | null> {
  try {
    const ride = await store.load();
    if (!ride || ride.samples.length === 0) return null;
    return { ...ride, events: repairEvents(ride) };
  } catch (e) {
    console.warn('bikeboi: could not read the saved ride', e);
    return null;
  }
}

/** Forget the unfinished ride kept for recovery. */
export async function discardSavedRide(store: RideStore = defaultRideStore()): Promise<void> {
  try {
    await store.clear();
  } catch (e) {
    console.warn('bikeboi: could not clear the saved ride', e);
  }
}

export class Recorder {
  private readonly store: RideStore;
  private ride: SavedRide | null = null;
  private paused = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(store: RideStore = defaultRideStore()) {
    this.store = store;
  }

  get active(): boolean {
    return this.ride !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Store writes run in order and never throw into the ride loop. */
  private persist(op: () => Promise<void>): void {
    this.writes = this.writes.then(op).catch((e) => console.warn('bikeboi: ride autosave failed', e));
  }

  private addEvent(e: RideEvent): void {
    this.ride!.events.push(e);
    this.persist(() => this.store.appendEvent(e));
  }

  begin(meta: RideMeta): void {
    this.ride = { meta: { ...meta }, samples: [], laps: [], events: [] };
    this.paused = false;
    this.persist(() => this.store.begin(meta));
    this.addEvent({ timestamp: meta.startedAt, type: 'start' });
  }

  addSample(s: RideSample): void {
    if (!this.ride || this.paused) return;
    const sample = { ...s };
    this.ride.samples.push(sample);
    this.persist(() => this.store.appendSample(sample));
  }

  addLap(l: RideLap): void {
    if (!this.ride) return;
    const lap = { ...l };
    this.ride.laps.push(lap);
    this.persist(() => this.store.appendLap(lap));
  }

  pause(ts: number): void {
    if (!this.ride || this.paused) return;
    this.paused = true;
    this.addEvent({ timestamp: ts, type: 'stop' });
  }

  resume(ts: number): void {
    if (!this.ride || !this.paused) return;
    this.paused = false;
    this.addEvent({ timestamp: ts, type: 'start' });
  }

  /**
   * Ends the ride and encodes it. If this throws (nothing recorded, encoder failure) the
   * ride stays active and the autosaved copy is kept.
   */
  async finish(ts: number, ftp?: number): Promise<FinishedRide> {
    const current = this.ride;
    if (!current) throw new Error('No ride in progress.');
    if (current.samples.length === 0) throw new Error('Nothing has been recorded yet.');

    const closing: RideEvent[] = this.paused ? [] : [{ timestamp: ts, type: 'stop' }];
    const ride: SavedRide = {
      meta: { ...current.meta },
      samples: current.samples.slice(),
      laps: current.laps.slice(),
      events: [...current.events, ...closing],
    };
    ride.events = repairEvents(ride);

    const fit = await encodeFit(ride, ftp);

    this.ride = null;
    this.paused = false;
    this.persist(() => this.store.clear());
    await this.writes;

    return { fit, filename: fitFilename(ride.meta), summary: summarize(ride), ride };
  }

  /** Resolves once every autosave write queued so far has settled. */
  flush(): Promise<void> {
    return this.writes;
  }

  async discard(): Promise<void> {
    this.ride = null;
    this.paused = false;
    this.persist(() => this.store.clear());
    await this.writes;
  }
}
