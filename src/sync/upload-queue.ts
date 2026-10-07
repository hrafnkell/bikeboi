// Finished rides wait here until they have reached the account; a failed upload is retried.

import { reactive } from 'vue';
import { ApiError, apiForm, isNetworkError } from '../api/client.ts';
import type { FinishedRide, RideSummary } from '../ride/recorder.ts';

/** What goes into a ride's meta on the account, beyond the summary. */
export interface RideExtras {
  pacer: number | null;
  workout: string | null;
  laps: number;
  /** The trainer's name, '' when unknown. */
  trainer: string;
  /** Best average power over 5 s, 20 s, 1, 5 and 20 minutes, where the ride was long enough. */
  peaks: Record<string, number>;
}

export interface QueuedRide {
  startedAt: number;
  circuitId: string;
  circuitName: string;
  filename: string;
  summary: RideSummary;
  meta: RideExtras;
  fit: Uint8Array;
  attempts: number;
}

export interface UploadStore {
  put(entry: QueuedRide): Promise<void>;
  remove(startedAt: number): Promise<void>;
  /** Oldest first. */
  all(): Promise<QueuedRide[]>;
}

export const uploads = reactive({
  pending: 0,
  last: 'idle' as 'idle' | 'uploading' | 'saved' | 'queued' | 'failed',
  /** What happened on intervals.icu for the last saved ride: '' when not connected. */
  intervals: '' as '' | 'sent' | 'duplicate' | 'failed',
});

const MAX_QUEUE = 20;

export function createMemoryUploadStore(): UploadStore {
  const items = new Map<number, QueuedRide>();
  return {
    async put(entry) {
      items.set(entry.startedAt, { ...entry });
    },
    async remove(startedAt) {
      items.delete(startedAt);
    },
    async all() {
      return [...items.values()].sort((a, b) => a.startedAt - b.startedAt);
    },
  };
}

const DB_NAME = 'bikeboi-uploads';
const STORE = 'queue';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createIdbUploadStore(): UploadStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  function db(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'startedAt' });
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      dbPromise.catch(() => (dbPromise = null));
    }
    return dbPromise;
  }
  return {
    async put(entry) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      await done(tx);
    },
    async remove(startedAt) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(startedAt);
      await done(tx);
    },
    async all() {
      const tx = (await db()).transaction(STORE, 'readonly');
      const items = await request<QueuedRide[]>(tx.objectStore(STORE).getAll());
      return items.sort((a, b) => a.startedAt - b.startedAt);
    },
  };
}

let defaultStore: UploadStore | null = null;
function store(): UploadStore {
  if (!defaultStore) defaultStore = typeof indexedDB !== 'undefined' ? createIdbUploadStore() : createMemoryUploadStore();
  return defaultStore;
}

export type PostRide = (entry: QueuedRide) => Promise<unknown>;

/** The real upload: multipart with the meta as JSON and the FIT as a file. */
export async function postRide(entry: QueuedRide): Promise<unknown> {
  const form = new FormData();
  const { fit, attempts: _attempts, ...meta } = entry;
  form.append('meta', JSON.stringify(meta));
  form.append('fit', new Blob([fit as BlobPart], { type: 'application/octet-stream' }), entry.filename);
  return apiForm('/api/rides', form);
}

/** Queue a finished ride for the account. Oldest entries go when the queue is full. */
export async function enqueue(
  finished: FinishedRide,
  extras: RideExtras,
  s: UploadStore = store(),
): Promise<void> {
  const entry: QueuedRide = {
    startedAt: finished.ride.meta.startedAt,
    circuitId: finished.ride.meta.circuitId,
    circuitName: finished.ride.meta.circuitName,
    filename: finished.filename,
    summary: finished.summary,
    meta: extras,
    fit: finished.fit,
    attempts: 0,
  };
  try {
    await s.put(entry);
    const all = await s.all();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_QUEUE))) await s.remove(old.startedAt);
    uploads.pending = Math.min(all.length, MAX_QUEUE);
    uploads.last = 'queued';
  } catch (e) {
    console.warn('bikeboi: could not queue the ride for upload', e);
  }
}

let flushing: Promise<void> | null = null;

/**
 * Upload everything waiting, in order. A network failure stops the run and keeps the
 * rest for next time; a rejection the server will never accept drops that entry.
 */
export function flushUploads(s: UploadStore = store(), post: PostRide = postRide): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    let entries: QueuedRide[];
    try {
      entries = await s.all();
    } catch {
      return;
    }
    uploads.pending = entries.length;
    if (entries.length === 0) return;
    uploads.last = 'uploading';
    for (const entry of entries) {
      try {
        const result = (await post(entry)) as { ride?: { intervalsId?: string | null; intervalsError?: string | null } } | undefined;
        await s.remove(entry.startedAt);
        uploads.pending -= 1;
        uploads.last = 'saved';
        const r = result?.ride;
        uploads.intervals = r?.intervalsId ? 'sent' : r?.intervalsError ? 'failed' : '';
      } catch (e) {
        if (e instanceof ApiError && e.status !== 401 && e.status !== 429 && e.status < 500) {
          console.warn(`bikeboi: ride upload rejected (${e.status} ${e.message}); dropping it`);
          await s.remove(entry.startedAt).catch(() => {});
          uploads.pending -= 1;
          uploads.last = 'failed';
          continue;
        }
        // offline, not signed in, throttled or a server fault: keep it for later
        await s.put({ ...entry, attempts: entry.attempts + 1 }).catch(() => {});
        uploads.last = isNetworkError(e) || (e instanceof ApiError && e.status === 401) ? 'queued' : 'failed';
        return;
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Count what is waiting, without sending. */
export async function countPending(s: UploadStore = store()): Promise<number> {
  try {
    const n = (await s.all()).length;
    uploads.pending = n;
    return n;
  } catch {
    return 0;
  }
}
