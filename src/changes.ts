// Announces local data changes so the sync layer can push them. Nothing else listens.

import { createEmitter } from './emitter.ts';

export interface ChangeEvents {
  settings: void;
  /** Storage key suffix: '<circuitId>' for a lap ghost, '<circuitId>:<segmentId>' for a segment. */
  best: { key: string };
  workouts: void;
}

export const changes = createEmitter<ChangeEvents>();
