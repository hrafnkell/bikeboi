// Live rider metrics and persisted settings.

import { changes } from './changes.ts';
import { createEmitter } from './emitter.ts';
export type { Emitter, Unsubscribe } from './emitter.ts';

export interface AppEvents {
  /** +1 = harder gear, -1 = easier gear. Emitted by keyboard, on-screen buttons and the Click. */
  shift: 1 | -1;
}

export const bus = createEmitter<AppEvents>();

/** Latest rider metrics. Written by the device layer or the simulated rider, read by the ride loop. */
export interface LiveMetrics {
  power: number; // W
  cadence: number; // rpm
  heartRate: number; // bpm, 0 when unknown
}

export const live: LiveMetrics = { power: 0, cadence: 0, heartRate: 0 };

import { defaultRiderLook, sanitizeLook } from './game/rider.ts';
import type { RiderLook } from './game/rider.ts';
import type { SceneId } from './game/scenes.ts';

export type GearMode = 'model' | 'offset';
export type PacerMode = 'off' | 'steady' | 'workout';

export interface Settings {
  riderMass: number; // kg
  bikeMass: number; // kg
  ftp: number; // W
  gearMode: GearMode;
  /** Spin on a flat road first, and start the circuit on a button press. */
  warmup: boolean;
  /** Scales how hard gradients feel on the trainer, 0..1 (1 = true gradient). */
  difficulty: number;
  lastCircuitId: string;
  /** 'auto' uses each circuit's own scene. */
  scene: SceneId | 'auto';
  rider: RiderLook;
  /** A virtual rider holding steady watts to chase. */
  /** hard: the trainer holds the pacemaker's power (ERG) instead of simulating the road. */
  pacer: { mode: PacerMode; power: number; workoutId: string; hard: boolean };
  /** When these settings were last changed by the rider, ms since epoch; 0 for never saved. */
  updatedAt: number;
}

export const defaultSettings: Settings = {
  riderMass: 75,
  bikeMass: 9,
  ftp: 200,
  gearMode: 'model',
  warmup: false,
  difficulty: 1,
  lastCircuitId: 'rollers',
  scene: 'auto',
  rider: { ...defaultRiderLook },
  pacer: { mode: 'off', power: 200, workoutId: 'builtin:threshold-3x10', hard: false },
  updatedAt: 0,
};

const SETTINGS_KEY = 'bikeboi:settings';

const SCENES = ['auto', 'day', 'sunset', 'alpine', 'rain', 'midnight', 'tron'] as const;

function num(value: unknown, fallback: number, min: number, max: number, round = true): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  const c = Math.min(max, Math.max(min, v));
  return round ? Math.round(c) : c;
}

/**
 * A complete, valid Settings object from anything: storage, an older version's shape, or
 * a document sent to the server. Unknown keys are dropped, bad values fall back.
 */
export function normalizeSettings(input: unknown): Settings {
  const p = (typeof input === 'object' && input !== null ? input : {}) as Record<string, any>;
  const d = defaultSettings;
  const power = Number(p.pacer?.power);
  return {
    riderMass: num(p.riderMass, d.riderMass, 30, 200),
    bikeMass: num(p.bikeMass, d.bikeMass, 4, 30),
    ftp: num(p.ftp, d.ftp, 50, 600),
    gearMode: p.gearMode === 'offset' ? 'offset' : 'model',
    warmup: p.warmup === true,
    difficulty: num(p.difficulty, d.difficulty, 0, 1, false),
    lastCircuitId: typeof p.lastCircuitId === 'string' && /^[a-z0-9-]{1,40}$/.test(p.lastCircuitId) ? p.lastCircuitId : d.lastCircuitId,
    scene: (SCENES as readonly string[]).includes(p.scene) ? p.scene : 'auto',
    rider: sanitizeLook(p.rider),
    pacer: {
      // "enabled" is how an earlier version stored a steady pacemaker
      mode: ['off', 'steady', 'workout'].includes(p.pacer?.mode)
        ? p.pacer.mode
        : p.pacer?.enabled === true ? 'steady' : 'off',
      power: Number.isFinite(power) ? Math.min(600, Math.max(50, Math.round(power))) : 200,
      workoutId: typeof p.pacer?.workoutId === 'string' && p.pacer.workoutId.length <= 60 ? p.pacer.workoutId : d.pacer.workoutId,
      hard: p.pacer?.hard === true,
    },
    updatedAt: num(p.updatedAt, 0, 0, 2 ** 46),
  };
}

function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {
    // unreadable storage falls back to defaults
  }
  return normalizeSettings({});
}

export const settings: Settings = loadSettings();

/** The settings as last written, without the timestamp, to tell real changes from no-op saves. */
const fingerprint = (s: Settings) => JSON.stringify({ ...s, updatedAt: 0 });
let lastWritten = fingerprint(settings);

function writeSettings(): void {
  lastWritten = fingerprint(settings);
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full or unavailable: settings stay in memory
  }
}

/** Save after the rider changed something: stamps the change and lets the sync layer know. */
export function saveSettings(): void {
  // screens call this on load too; a save that changes nothing must not look like a new edit
  if (fingerprint(settings) === lastWritten) return;
  settings.updatedAt = Date.now();
  writeSettings();
  changes.emit('settings', undefined);
}

/**
 * Adopt settings that arrived from the account, in place (engine code holds the same
 * object), keeping their own timestamp and without announcing a change.
 */
export function applySettings(doc: unknown, target: Settings = settings): void {
  // `target` may be a reactive proxy over `settings`, so that templates notice the change
  Object.assign(target, normalizeSettings(doc));
  writeSettings();
}

export function totalMass(): number {
  return settings.riderMass + settings.bikeMass;
}
