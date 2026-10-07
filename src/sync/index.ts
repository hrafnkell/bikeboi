// Keeps this browser and the account in step: pulls on sign-in, pushes on change.

import { reactive } from 'vue';
import { account, lastUserId, rememberUser, signedOut } from '../account/session.ts';
import { ApiError, api, isNetworkError } from '../api/client.ts';
import { changes } from '../changes.ts';
import { listGhosts, loadGhost, mergeGhost } from '../ride/ghost.ts';
import type { GhostTrace } from '../ride/ghost.ts';
import { clearTombstones, listCustomWorkouts, readTombstones, replaceCustomWorkouts } from '../ride/workouts.ts';
import { applySettings as applyRaw, saveSettings, settings } from '../state.ts';
import { settingsR } from '../ui/store.ts';

// apply through the reactive proxy so the start screen's fields update
const applySettings = (doc: unknown) => applyRaw(doc, settingsR);
import { mergeBests, mergeSettings, mergeWorkouts } from './merge.ts';
import type { Best, ServerSettings, WorkoutRecord } from './merge.ts';
import { flushUploads } from './upload-queue.ts';

export const sync = reactive({
  state: 'idle' as 'idle' | 'syncing' | 'synced' | 'offline' | 'error',
  lastAt: 0,
  /** Set when this browser holds another user's data; syncAll waits for a decision. */
  needsDecision: false,
});

/** How to treat this browser's bests and workouts when a different user signs in here. */
export type MergeMode = 'merge' | 'replace';

let pendingMode: MergeMode = 'merge';

function ghostKey(b: { circuitId: string; segmentId: string }): string {
  return b.segmentId ? `${b.circuitId}:${b.segmentId}` : b.circuitId;
}

function handleFailure(e: unknown): void {
  if (e instanceof ApiError && e.status === 401) {
    signedOut();
    sync.state = 'idle';
    return;
  }
  sync.state = isNetworkError(e) ? 'offline' : 'error';
  if (!isNetworkError(e)) console.warn('bikeboi: sync failed', e instanceof Error ? e.message : e);
}

async function pullSettings(): Promise<void> {
  const server = await api<ServerSettings>('GET', '/api/settings');
  const decision = mergeSettings(settings, server);
  if (decision.use === 'server') applySettings(decision.doc);
  else if (settings.updatedAt > server.updatedAt) await pushSettings();
}

async function pushSettings(): Promise<void> {
  const { doc } = await api<ServerSettings & { applied: boolean }>('PUT', '/api/settings', {
    doc: settings,
    updatedAt: settings.updatedAt,
  });
  // the server may have had something newer meanwhile
  if (doc && (doc as { updatedAt?: number }).updatedAt !== undefined && (doc as { updatedAt: number }).updatedAt > settings.updatedAt) {
    applySettings(doc);
  }
}

async function syncBests(mode: MergeMode): Promise<void> {
  const { bests: server } = await api<{ bests: Best[] }>('GET', '/api/bests');
  const local: Best[] = mode === 'replace' ? [] : listGhosts();
  const { toLocal, toServer } = mergeBests(local, server);
  if (mode === 'replace') {
    for (const b of server) {
      try {
        localStorage.setItem(`bikeboi:ghost:${ghostKey(b)}`, JSON.stringify(b.trace));
      } catch {
        // storage unavailable
      }
    }
  } else {
    for (const b of toLocal) mergeGhost(ghostKey(b), b.trace);
  }
  if (toServer.length > 0) {
    for (let i = 0; i < toServer.length; i += 200) {
      const { bests } = await api<{ bests: Best[] }>('PUT', '/api/bests', { bests: toServer.slice(i, i + 200) });
      for (const b of bests) mergeGhost(ghostKey(b), b.trace);
    }
  }
}

async function pushBest(key: string): Promise<void> {
  const trace = loadGhost(key);
  if (!trace) return;
  const colon = key.indexOf(':');
  const entry: Best = {
    circuitId: colon < 0 ? key : key.slice(0, colon),
    segmentId: colon < 0 ? '' : key.slice(colon + 1),
    trace,
  };
  const { bests } = await api<{ bests: Best[] }>('PUT', '/api/bests', { bests: [entry] });
  const theirs = bests.find((b) => ghostKey(b) === key);
  if (theirs) mergeGhost(key, theirs.trace as GhostTrace);
}

async function syncWorkouts(mode: MergeMode): Promise<void> {
  const { workouts: server } = await api<{ workouts: WorkoutRecord[] }>('GET', '/api/workouts');
  const local: WorkoutRecord[] = mode === 'replace' ? [] : listCustomWorkouts();
  const tombstones = mode === 'replace' ? [] : readTombstones();
  const { toLocal, toServer, toDelete, renamedIds } = mergeWorkouts(local, server, tombstones);
  replaceCustomWorkouts(toLocal);
  const kept = renamedIds.get(settings.pacer.workoutId);
  if (kept) {
    settings.pacer.workoutId = kept;
    saveSettings();
  }
  for (const w of toServer) await api('PUT', `/api/workouts/${encodeURIComponent(w.id)}`, { name: w.name, text: w.text, updatedAt: w.updatedAt });
  for (const id of toDelete) await api('DELETE', `/api/workouts/${encodeURIComponent(id)}`);
  clearTombstones([...tombstones, ...toDelete]);
  changes.emit('workouts', undefined);
}

async function pushWorkouts(): Promise<void> {
  const { workouts: server } = await api<{ workouts: WorkoutRecord[] }>('GET', '/api/workouts');
  const serverBy = new Map(server.map((w) => [w.id, w]));
  for (const w of listCustomWorkouts()) {
    const theirs = serverBy.get(w.id);
    if (!theirs || theirs.updatedAt < w.updatedAt || theirs.text !== w.text || theirs.name !== w.name) {
      await api('PUT', `/api/workouts/${encodeURIComponent(w.id)}`, { name: w.name, text: w.text, updatedAt: w.updatedAt || Date.now() });
    }
  }
  const tombstones = readTombstones();
  for (const id of tombstones) await api('DELETE', `/api/workouts/${encodeURIComponent(id)}`);
  clearTombstones(tombstones);
}

/** Pull everything, merge, push what the account lacks. Safe to call any time. */
export async function syncAll(mode?: MergeMode): Promise<void> {
  if (account.status !== 'in' || !account.user) return;
  const previous = lastUserId();
  if (mode === undefined && previous !== null && previous !== account.user.id) {
    // another rider's data is in this browser: the account panel asks what to do first
    sync.needsDecision = true;
    return;
  }
  const how = mode ?? pendingMode;
  sync.needsDecision = false;
  sync.state = 'syncing';
  try {
    if (how === 'replace') {
      const server = await api<ServerSettings>('GET', '/api/settings');
      if (server.doc !== null) applySettings(server.doc);
      else await pushSettings();
    } else {
      await pullSettings();
    }
    await syncBests(how);
    await syncWorkouts(how);
    rememberUser(account.user.id);
    pendingMode = 'merge';
    sync.state = 'synced';
    sync.lastAt = Date.now();
    void flushUploads();
  } catch (e) {
    handleFailure(e);
  }
}

/** The answer to the "merge or replace" question; runs the sync. */
export function decideAndSync(mode: MergeMode): Promise<void> {
  pendingMode = mode;
  return syncAll(mode);
}

const timers: Partial<Record<'settings' | 'workouts', ReturnType<typeof setTimeout>>> = {};
const bestTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 1500;

function later(kind: 'settings' | 'workouts', fn: () => Promise<void>): void {
  if (account.status !== 'in') return;
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => {
    timers[kind] = undefined;
    fn().then(
      () => {
        sync.state = 'synced';
        sync.lastAt = Date.now();
      },
      handleFailure,
    );
  }, DEBOUNCE_MS);
}

let started = false;

/** Wire local changes and connectivity to the account. Call once after account.refresh(). */
export function startSync(): void {
  if (started) return;
  started = true;
  changes.on('settings', () => later('settings', pushSettings));
  changes.on('workouts', () => later('workouts', pushWorkouts));
  changes.on('best', ({ key }) => {
    if (account.status !== 'in') return;
    clearTimeout(bestTimers.get(key));
    bestTimers.set(
      key,
      setTimeout(() => {
        bestTimers.delete(key);
        pushBest(key).then(
          () => {
            sync.state = 'synced';
            sync.lastAt = Date.now();
          },
          handleFailure,
        );
      }, DEBOUNCE_MS),
    );
  });
  window.addEventListener('online', () => {
    void syncAll();
    void flushUploads();
  });
  void syncAll();
  void flushUploads();
}
