// The workout library: a few built-in sessions, plus the rider's own, kept in the browser.

import { changes } from '../changes.ts';
import { parseWorkout } from './workout.ts';

export interface WorkoutEntry {
  id: string;
  name: string;
  /** intervals.icu workout-builder text. */
  text: string;
  builtIn: boolean;
  /** Last change, ms since epoch; 0 for entries from before this was recorded. */
  updatedAt: number;
}

const builtIns: WorkoutEntry[] = ([
  {
    id: 'builtin:threshold-3x10', name: 'Threshold 3 x 10', builtIn: true,
    text: `Warmup
- 5m ramp 55-80%

Main Set 3x
- 10m 96%
- 2m 70%

Cooldown
- 8m 60%`,
  },
  {
    id: 'builtin:sweet-spot-2x20', name: 'Sweet spot 2 x 20', builtIn: true,
    text: `Warmup
- 10m ramp 50-75%

Main Set 2x
- 20m 88-93%
- 5m 55%

Cooldown
- 5m ramp 60-45%`,
  },
  {
    id: 'builtin:vo2-5x3', name: 'VO2 max 5 x 3', builtIn: true,
    text: `Warmup
- 10m ramp 50-75%
- 1m 100%
- 2m 55%

Main Set 5x
- 3m 115%
- 3m 50%

Cooldown
- 8m 50%`,
  },
  {
    id: 'builtin:over-unders', name: 'Over-unders 3 x 9', builtIn: true,
    text: `Warmup
- 10m ramp 50-80%

Set one 3x
- 2m 95%
- 1m 105%

- Recover 4m 55%

Set two 3x
- 2m 95%
- 1m 105%

- Recover 4m 55%

Set three 3x
- 2m 95%
- 1m 105%

Cooldown
- 6m 50%`,
  },
  {
    id: 'builtin:endurance-45', name: 'Endurance 45', builtIn: true,
    text: `- Settle in 5m ramp 50-65%
- Steady 35m 65-72%
- Ease off 5m ramp 65-50%`,
  },
  {
    id: 'builtin:openers-20', name: 'Openers 20', builtIn: true,
    text: `- Warmup 8m ramp 50-75%

Openers 4x
- 30s 120%
- 1m30s 55%

- Cooldown 4m 50%`,
  },
] as Array<Omit<WorkoutEntry, 'updatedAt'>>).map((w) => ({ ...w, updatedAt: 0 }));

const KEY = 'bikeboi:workouts';
const DELETED_KEY = 'bikeboi:workouts:deleted';

function readCustom(): WorkoutEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((w): w is { id: string; name: string; text: string; updatedAt?: unknown } =>
        !!w && typeof w.id === 'string' && typeof w.name === 'string' && typeof w.text === 'string')
      .map((w) => ({
        id: w.id, name: w.name.slice(0, 60), text: w.text.slice(0, 8000), builtIn: false,
        updatedAt: Number.isFinite(Number(w.updatedAt)) ? Number(w.updatedAt) : 0,
      }));
  } catch {
    return [];
  }
}

function writeCustom(list: WorkoutEntry[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list.map(({ id, name, text, updatedAt }) => ({ id, name, text, updatedAt }))));
  } catch {
    // storage unavailable: the workout lasts for this visit only
  }
}

/** Ids deleted here that the account may still hold. */
export function readTombstones(): string[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(DELETED_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeTombstones(ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(DELETED_KEY, JSON.stringify(ids.slice(-100)));
  } catch {
    // nothing to do
  }
}

export function clearTombstones(ids: string[]): void {
  writeTombstones(readTombstones().filter((id) => !ids.includes(id)));
}

/** The rider's own workouts, as stored (no built-ins). */
export function listCustomWorkouts(): WorkoutEntry[] {
  return readCustom();
}

/** Replace the rider's own workouts with what the account holds, without announcing it. */
export function replaceCustomWorkouts(list: Array<Pick<WorkoutEntry, 'id' | 'name' | 'text' | 'updatedAt'>>): void {
  writeCustom(list.map((w) => ({ ...w, builtIn: false })));
}

export function listWorkouts(): WorkoutEntry[] {
  return [...builtIns, ...readCustom()];
}

export function findWorkout(id: string): WorkoutEntry | null {
  return listWorkouts().find((w) => w.id === id) ?? null;
}

/** Save one of the rider's own workouts; a workout with the same name is replaced. */
export function saveWorkout(name: string, text: string): WorkoutEntry {
  const clean = name.trim().slice(0, 60) || 'My workout';
  const custom = readCustom();
  const existing = custom.find((w) => w.name.toLowerCase() === clean.toLowerCase());
  const entry: WorkoutEntry = {
    id: existing?.id ?? `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: clean, text: text.slice(0, 8000), builtIn: false, updatedAt: Date.now(),
  };
  writeCustom([...custom.filter((w) => w.id !== entry.id), entry]);
  changes.emit('workouts', undefined);
  return entry;
}

export function deleteWorkout(id: string): void {
  writeCustom(readCustom().filter((w) => w.id !== id));
  if (id.startsWith('custom:')) writeTombstones([...readTombstones().filter((x) => x !== id), id]);
  changes.emit('workouts', undefined);
}

/** Built-ins are written by hand; this is checked by the tests. */
export function builtInProblems(): string[] {
  return builtIns.flatMap((w) => parseWorkout(w.text).errors.map((e) => `${w.name} line ${e.line}: ${e.message}`));
}
