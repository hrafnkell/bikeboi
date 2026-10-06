// A pacemaker: a virtual rider holding steady watts on the same road, on the ride's clock.

import type { Circuit } from './circuit.ts';
import { RideSim } from './sim.ts';

/** Distance against ride time, one point a second, for "when was a rider at this point?". */
export class Track {
  private t: number[] = [0];
  private d: number[] = [0];

  add(time: number, distance: number): void {
    const last = this.t.length - 1;
    if (time - this.t[last] < 1) return;
    this.t.push(time);
    this.d.push(Math.max(distance, this.d[last]));
  }

  /** Ride time at which this track reached a distance; null if it has not got there yet. */
  timeAt(distance: number): number | null {
    const n = this.d.length;
    if (distance > this.d[n - 1]) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.d[mid] < distance) lo = mid;
      else hi = mid;
    }
    const span = this.d[hi] - this.d[lo];
    if (span <= 0) return this.t[lo];
    return this.t[lo] + ((this.t[hi] - this.t[lo]) * (distance - this.d[lo])) / span;
  }
}

export interface PacerGap {
  /** Seconds behind (+) or ahead (-) of the pacemaker. */
  seconds: number;
  /** Metres behind (+) or ahead (-). */
  metres: number;
}

export class Pacer {
  readonly sim: RideSim;
  private track = new Track();

  private powerAt: (rideTime: number) => number;

  /** `power` is steady watts, or watts as a function of ride time (a workout). */
  constructor(circuit: Circuit, mass: number, power: number | ((rideTime: number) => number)) {
    this.sim = new RideSim(circuit, mass);
    this.powerAt = typeof power === 'number' ? () => power : power;
  }

  /** What the pacemaker is putting out right now, watts. */
  get power(): number {
    return Math.round(this.powerAt(this.sim.time));
  }

  /** Advance one physics step. Call once for every step in which the rider's clock ran. */
  step(): void {
    this.sim.step(this.powerAt(this.sim.time));
    this.track.add(this.sim.time, this.sim.distance);
  }

  /** Catch up to a ride that has already run for some time (a resumed ride). */
  fastForward(rideTime: number): void {
    while (this.sim.time < rideTime - 1e-9) this.step();
  }

  get distance(): number {
    return this.sim.distance;
  }

  /** Position between physics steps; alpha is how far the rider is into the current step. */
  renderDistance(alpha: number): number {
    return this.sim.prevDistance + (this.sim.distance - this.sim.prevDistance) * Math.min(1, Math.max(0, alpha));
  }

  /**
   * Where the rider stands against the pacemaker. Behind: how long ago the pacemaker passed
   * the rider's spot. Ahead: how long ago the rider passed the pacemaker's spot.
   */
  gap(riderDistance: number, riderTrack: Track, now: number): PacerGap {
    const metres = this.sim.distance - riderDistance;
    if (metres >= 0) {
      const passed = this.track.timeAt(riderDistance);
      return { seconds: passed === null ? 0 : Math.max(0, now - passed), metres };
    }
    const passed = riderTrack.timeAt(this.sim.distance);
    return { seconds: passed === null ? 0 : -Math.max(0, now - passed), metres };
  }
}
