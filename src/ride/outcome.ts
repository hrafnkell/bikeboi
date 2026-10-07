// What a ride hands to the summary screen.

import type { SegmentEffort } from './segments.ts';
import type { PacerGap } from './pacer.ts';
import type { FinishedRide } from './recorder.ts';
import type { LapResult } from './sim.ts';
import type { Circuit } from './circuit.ts';

export interface RideOutcome {
  circuit: Circuit;
  laps: LapResult[];
  efforts: SegmentEffort[];
  finished: FinishedRide | null;
  /** Why there is no file, when there is none. */
  error: string | null;
  /** How the ride ended against the pacemaker, if there was one. */
  pacer: { power: number; gap: PacerGap } | null;
  /** The workout the pacemaker followed, and how much of it was ridden, in seconds. */
  workout: { name: string; ridden: number; duration: number } | null;
}
