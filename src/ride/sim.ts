// Fixed-step ride simulation: power in, speed / distance / laps out.

// @ts-ignore vendored JS without types
import { Model } from '../vendor/auuki/physics.js';
import { CDA, CRR, RHO } from '../types.ts';
import type { Circuit } from './circuit.ts';

/** Physics step in seconds. The borrowed model stalls at very small steps, so keep this coarse. */
export const STEP = 0.2;

export interface LapResult {
  /** 1-based lap number. */
  number: number;
  /** Lap time in seconds of ride time. */
  time: number;
  /** Ride time at which the lap ended. */
  endTime: number;
}

interface PhysicsModel {
  virtualSpeedCF(args: { power: number; slope: number; mass: number; dt: number; speed: number }): { speed: number };
}

const model: PhysicsModel = (Model as (args: object) => PhysicsModel)({
  CdA: CDA, rho: RHO, crr: CRR, drivetrainLoss: 0.02,
});

export class RideSim {
  /** Ride time in seconds; only advances while moving. */
  time = 0;
  distance = 0;
  speed = 0;
  ascent = 0;
  /** Pedalling work in joules. */
  work = 0;
  lapIndex = 0;
  lapStartTime = 0;
  laps: LapResult[] = [];
  /** True while the rider is pedalling or still rolling. */
  moving = false;

  private prevDistance = 0;
  private acc = 0;

  constructor(
    readonly circuit: Circuit,
    public mass: number,
    private onLap?: (lap: LapResult) => void,
  ) {}

  /** Advance by real elapsed seconds using the latest power. Returns the number of steps taken. */
  advance(dt: number, power: number): number {
    this.acc += Math.min(dt, 1);
    let steps = 0;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(power);
      steps++;
    }
    return steps;
  }

  step(power: number): void {
    const p = Number.isFinite(power) ? Math.max(0, power) : 0;
    const grade = this.circuit.gradeAt(this.distance);
    const out = model.virtualSpeedCF({
      power: p,
      slope: grade,
      mass: this.mass,
      dt: STEP,
      speed: this.speed,
    });
    const speed = Number.isFinite(out.speed) ? Math.max(0, out.speed) : 0;

    this.prevDistance = this.distance;
    this.speed = speed;
    this.moving = speed > 0 || p > 0;
    if (!this.moving) return;

    const dx = speed * STEP;
    const before = this.circuit.altitudeAt(this.distance);
    this.distance += dx;
    this.time += STEP;
    this.work += p * STEP;
    this.ascent += Math.max(0, this.circuit.altitudeAt(this.distance) - before);

    const length = this.circuit.length;
    while (this.distance >= (this.lapIndex + 1) * length) {
      const boundary = (this.lapIndex + 1) * length;
      const overshoot = dx > 0 ? (this.distance - boundary) / dx : 0;
      const endTime = this.time - overshoot * STEP;
      const lap: LapResult = {
        number: this.lapIndex + 1,
        time: endTime - this.lapStartTime,
        endTime,
      };
      this.laps.push(lap);
      this.lapIndex++;
      this.lapStartTime = endTime;
      this.onLap?.(lap);
    }
  }

  get lapTime(): number {
    return this.time - this.lapStartTime;
  }

  get lapDistance(): number {
    return this.distance - this.lapIndex * this.circuit.length;
  }

  /** Distance interpolated between physics steps, for smooth rendering. */
  get renderDistance(): number {
    if (!this.moving) return this.distance;
    return this.prevDistance + (this.distance - this.prevDistance) * (this.acc / STEP);
  }

  /** Lap time matching renderDistance, for placing the ghost without jitter. */
  get renderLapTime(): number {
    if (!this.moving) return this.lapTime;
    return Math.max(0, this.lapTime - (STEP - this.acc));
  }

  get grade(): number {
    return this.circuit.gradeAt(this.distance);
  }

  get altitude(): number {
    return this.circuit.altitudeAt(this.distance);
  }

  get bestLap(): LapResult | null {
    let best: LapResult | null = null;
    for (const lap of this.laps) if (!best || lap.time < best.time) best = lap;
    return best;
  }
}
