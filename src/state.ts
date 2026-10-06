// Small typed event emitter, live rider metrics and persisted settings.

export type Unsubscribe = () => void;

export interface Emitter<E> {
  on<K extends keyof E>(type: K, fn: (value: E[K]) => void): Unsubscribe;
  emit<K extends keyof E>(type: K, value: E[K]): void;
}

export function createEmitter<E>(): Emitter<E> {
  const listeners = new Map<keyof E, Set<(value: any) => void>>();
  return {
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(type, value) {
      listeners.get(type)?.forEach((fn) => fn(value));
    },
  };
}

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

export interface Settings {
  riderMass: number; // kg
  bikeMass: number; // kg
  ftp: number; // W
  gearMode: GearMode;
  /** Scales how hard gradients feel on the trainer, 0..1 (1 = true gradient). */
  difficulty: number;
  lastCircuitId: string;
  /** 'auto' uses each circuit's own scene. */
  scene: SceneId | 'auto';
  rider: RiderLook;
}

export const defaultSettings: Settings = {
  riderMass: 75,
  bikeMass: 9,
  ftp: 200,
  gearMode: 'model',
  difficulty: 1,
  lastCircuitId: 'rollers',
  scene: 'auto',
  rider: { ...defaultRiderLook },
};

const SETTINGS_KEY = 'bikeboi:settings';

function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultSettings, ...parsed, rider: sanitizeLook(parsed?.rider) };
    }
  } catch {
    // unreadable storage falls back to defaults
  }
  return { ...defaultSettings, rider: { ...defaultRiderLook } };
}

export const settings: Settings = loadSettings();

export function saveSettings(): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full or unavailable: settings stay in memory
  }
}

export function totalMass(): number {
  return settings.riderMass + settings.bikeMass;
}
