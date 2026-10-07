// Pure rules for reconciling this browser's data with the account's.

import type { GhostTrace } from '../ride/ghost.ts';
import type { Settings } from '../state.ts';

export interface ServerSettings {
  doc: unknown | null;
  updatedAt: number;
}

export function mergeSettings(local: Settings, server: ServerSettings): { use: 'local' | 'server'; doc: unknown } {
  if (server.doc === null || server.doc === undefined) return { use: 'local', doc: local };
  // the newer change wins; a device that never saved anything (updatedAt 0) yields to the account
  return server.updatedAt > local.updatedAt ? { use: 'server', doc: server.doc } : { use: 'local', doc: local };
}

export interface Best {
  circuitId: string;
  /** '' for the lap ghost. */
  segmentId: string;
  trace: GhostTrace;
}

const bestKey = (b: Best) => `${b.circuitId}\u0000${b.segmentId}`;

/** Faster wins in both directions; equal times leave both sides alone. */
export function mergeBests(local: Best[], server: Best[]): { toLocal: Best[]; toServer: Best[] } {
  const serverBy = new Map(server.map((b) => [bestKey(b), b]));
  const localBy = new Map(local.map((b) => [bestKey(b), b]));
  const toLocal: Best[] = [];
  const toServer: Best[] = [];
  for (const [key, mine] of localBy) {
    const theirs = serverBy.get(key);
    if (!theirs || mine.trace.lapTime < theirs.trace.lapTime) toServer.push(mine);
  }
  for (const [key, theirs] of serverBy) {
    const mine = localBy.get(key);
    if (!mine || theirs.trace.lapTime < mine.trace.lapTime) toLocal.push(theirs);
  }
  return { toLocal, toServer };
}

export interface WorkoutRecord {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
}

export interface WorkoutMerge {
  /** The full list this browser should hold afterwards. */
  toLocal: WorkoutRecord[];
  /** Entries the account lacks or has an older copy of. */
  toServer: WorkoutRecord[];
  /** Ids to delete on the server (local tombstones that the server still has). */
  toDelete: string[];
  /** When two entries with the same name collapsed, the id that went away → the one kept. */
  renamedIds: Map<string, string>;
}

/**
 * Union by id. Two entries with different ids but the same name (case-insensitive) are
 * the same workout written on two devices: the newer one is kept. Local tombstones win
 * over the server's copy.
 */
export function mergeWorkouts(local: WorkoutRecord[], server: WorkoutRecord[], tombstones: string[]): WorkoutMerge {
  const dead = new Set(tombstones);
  const byId = new Map<string, { record: WorkoutRecord; fromLocal: boolean; fromServer: boolean }>();
  for (const w of local) byId.set(w.id, { record: w, fromLocal: true, fromServer: false });
  for (const w of server) {
    if (dead.has(w.id)) continue;
    const existing = byId.get(w.id);
    if (!existing) byId.set(w.id, { record: w, fromLocal: false, fromServer: true });
    else {
      existing.fromServer = true;
      if (w.updatedAt > existing.record.updatedAt) existing.record = w;
    }
  }

  const renamedIds = new Map<string, string>();
  const byName = new Map<string, string>(); // lower-case name → id kept
  for (const [id, entry] of [...byId].sort((a, b) => b[1].record.updatedAt - a[1].record.updatedAt)) {
    const name = entry.record.name.trim().toLowerCase();
    const kept = byName.get(name);
    if (kept === undefined) byName.set(name, id);
    else {
      renamedIds.set(id, kept);
      byId.delete(id);
    }
  }

  const toLocal: WorkoutRecord[] = [];
  const toServer: WorkoutRecord[] = [];
  for (const [id, entry] of byId) {
    toLocal.push(entry.record);
    const serverCopy = server.find((w) => w.id === id);
    if (!serverCopy || serverCopy.updatedAt < entry.record.updatedAt) toServer.push(entry.record);
  }
  // a collapsed id that the server still holds must go, as must tombstoned ones it holds
  const toDelete = [
    ...server.filter((w) => dead.has(w.id)).map((w) => w.id),
    ...server.filter((w) => renamedIds.has(w.id)).map((w) => w.id),
  ];
  return { toLocal, toServer, toDelete: [...new Set(toDelete)], renamedIds };
}
