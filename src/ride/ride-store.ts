// Persistence for the ride in progress, so a killed tab does not lose it.

import type { RideLap, RideMeta, RideSample } from '../types.ts';

export interface RideEvent {
  timestamp: number; // ms since epoch
  type: 'start' | 'stop';
}

export interface SavedRide {
  meta: RideMeta;
  samples: RideSample[];
  laps: RideLap[];
  events: RideEvent[];
}

export interface RideStore {
  /** Clears any previous unfinished ride. */
  begin(meta: RideMeta): Promise<void>;
  appendSample(s: RideSample): Promise<void>;
  appendLap(l: RideLap): Promise<void>;
  appendEvent(e: RideEvent): Promise<void>;
  /** null when nothing (or nothing with samples) is stored. */
  load(): Promise<SavedRide | null>;
  clear(): Promise<void>;
}

export function createMemoryRideStore(): RideStore {
  let ride: SavedRide | null = null;
  return {
    async begin(meta) {
      ride = { meta: { ...meta }, samples: [], laps: [], events: [] };
    },
    async appendSample(s) {
      ride?.samples.push({ ...s });
    },
    async appendLap(l) {
      ride?.laps.push({ ...l });
    },
    async appendEvent(e) {
      ride?.events.push({ ...e });
    },
    async load() {
      if (!ride || ride.samples.length === 0) return null;
      return structuredClone(ride);
    },
    async clear() {
      ride = null;
    },
  };
}

const DB_NAME = 'bikeboi-ride';
const DB_VERSION = 1;
const META = 'meta';
const ITEMS = 'items';
const META_KEY = 'current';

type Item =
  | { kind: 'sample'; data: RideSample }
  | { kind: 'lap'; data: RideLap }
  | { kind: 'event'; data: RideEvent };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('ride database is blocked by another tab'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('ride database transaction aborted'));
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** One small append per sample; the ride is never rewritten as a whole. */
export function createIdbRideStore(): RideStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = openDb();
      // a failed open is retried on the next call
      dbPromise.catch(() => (dbPromise = null));
    }
    return dbPromise;
  }

  async function append(item: Item): Promise<void> {
    const tx = (await db()).transaction(ITEMS, 'readwrite');
    tx.objectStore(ITEMS).add(item);
    await done(tx);
  }

  return {
    async begin(meta) {
      const tx = (await db()).transaction([META, ITEMS], 'readwrite');
      tx.objectStore(ITEMS).clear();
      tx.objectStore(META).put(meta, META_KEY);
      await done(tx);
    },
    appendSample: (data) => append({ kind: 'sample', data }),
    appendLap: (data) => append({ kind: 'lap', data }),
    appendEvent: (data) => append({ kind: 'event', data }),
    async load() {
      const tx = (await db()).transaction([META, ITEMS], 'readonly');
      const metaReq = result<RideMeta | undefined>(tx.objectStore(META).get(META_KEY));
      const itemsReq = result<Item[]>(tx.objectStore(ITEMS).getAll());
      const [meta, items] = await Promise.all([metaReq, itemsReq]);
      if (!meta) return null;
      const ride: SavedRide = { meta, samples: [], laps: [], events: [] };
      for (const item of items) {
        if (item.kind === 'sample') ride.samples.push(item.data);
        else if (item.kind === 'lap') ride.laps.push(item.data);
        else if (item.kind === 'event') ride.events.push(item.data);
      }
      return ride.samples.length === 0 ? null : ride;
    },
    async clear() {
      const tx = (await db()).transaction([META, ITEMS], 'readwrite');
      tx.objectStore(ITEMS).clear();
      tx.objectStore(META).clear();
      await done(tx);
    },
  };
}

let defaultStore: RideStore | null = null;

/** IndexedDB when the browser has it, otherwise an in-memory store. Shared per page. */
export function defaultRideStore(): RideStore {
  if (!defaultStore) {
    defaultStore = typeof indexedDB !== 'undefined' ? createIdbRideStore() : createMemoryRideStore();
  }
  return defaultStore;
}
