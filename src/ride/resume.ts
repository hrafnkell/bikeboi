// Rebuilds the state of an interrupted ride from its autosaved samples.

import type { Circuit } from './circuit.ts';
import type { SavedRide } from './ride-store.ts';
import type { LapResult } from './sim.ts';

export interface ResumeState {
  /** Ride time in seconds: one sample was recorded per second of riding. */
  time: number;
  distance: number;
  ascent: number;
  /** Pedalling work in joules. */
  work: number;
  laps: LapResult[];
  lapStartTime: number;
  peak: { power: number; cadence: number; heartRate: number };
  /** The unfinished lap so far, as [lap time, lap distance] points, for the ghost trace. */
  lapTrace: Array<[number, number]>;
  /** Every recorded second as [ride time, distance], for replaying segments. */
  track: Array<[number, number]>;
  lastSampleTs: number;
  /** Wall-clock start of the unfinished lap, for the ride file. */
  lapStartWall: number;
}

export function resumeState(ride: SavedRide, circuit: Circuit): ResumeState {
  const length = circuit.length;
  const laps: LapResult[] = [];
  const track: Array<[number, number]> = [];
  const peak = { power: 0, cadence: 0, heartRate: 0 };
  let lapStartTime = 0;
  let ascent = 0;
  let work = 0;
  let prevD = 0;
  let prevAlt: number | null = null;

  ride.samples.forEach((s, i) => {
    const t = i + 1;
    const d = Math.max(prevD, s.distance);
    while (d >= (laps.length + 1) * length) {
      const boundary = (laps.length + 1) * length;
      const cross = d > prevD ? t - 1 + (boundary - prevD) / (d - prevD) : t;
      laps.push({ number: laps.length + 1, time: cross - lapStartTime, endTime: cross });
      lapStartTime = cross;
    }
    if (prevAlt !== null && s.altitude > prevAlt) ascent += s.altitude - prevAlt;
    prevAlt = s.altitude;
    work += Math.max(0, s.power);
    peak.power = Math.max(peak.power, s.power);
    peak.cadence = Math.max(peak.cadence, s.cadence);
    peak.heartRate = Math.max(peak.heartRate, s.heartRate);
    track.push([t, d]);
    prevD = d;
  });

  const lapBase = laps.length * length;
  const lapTrace = track
    .filter(([t]) => t > lapStartTime)
    .map(([t, d]): [number, number] => [t - lapStartTime, d - lapBase]);
  const last = ride.samples[ride.samples.length - 1];

  return {
    time: ride.samples.length,
    distance: prevD,
    ascent,
    work,
    laps,
    lapStartTime,
    peak,
    lapTrace,
    track,
    lastSampleTs: last?.timestamp ?? ride.meta.startedAt,
    lapStartWall: ride.laps[ride.laps.length - 1]?.endTime ?? ride.meta.startedAt,
  };
}
