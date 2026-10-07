import { describe, expect, test } from 'bun:test';
import { ApiError } from '../src/api/client.ts';
import type { FinishedRide } from '../src/ride/recorder.ts';
import { createMemoryUploadStore, enqueue, flushUploads, uploads } from '../src/sync/upload-queue.ts';
import type { QueuedRide } from '../src/sync/upload-queue.ts';

function finished(startedAt: number): FinishedRide {
  return {
    fit: new Uint8Array([1, 2, 3]),
    filename: `bikeboi-${startedAt}.fit`,
    summary: { durationS: 60, distanceM: 500, avgPower: 200, maxPower: 250, avgHeartRate: 0, avgCadence: 90, avgSpeed: 8, ascentM: 3, calories: 12, laps: 0 },
    ride: { meta: { circuitId: 'rollers', circuitName: 'Rolling Hills', startedAt }, samples: [], laps: [], events: [] },
  };
}

const extras = { pacer: null, workout: null, laps: 0 };

describe('upload queue', () => {
  test('a successful upload removes the entry', async () => {
    const store = createMemoryUploadStore();
    await enqueue(finished(1000), extras, store);
    await enqueue(finished(2000), extras, store);
    expect((await store.all()).map((e) => e.startedAt)).toEqual([1000, 2000]);
    const sent: number[] = [];
    await flushUploads(store, async (e) => void sent.push(e.startedAt));
    expect(sent).toEqual([1000, 2000]);
    expect(await store.all()).toEqual([]);
    expect(uploads.pending).toBe(0);
    expect(uploads.last).toBe('saved');
  });

  test('a network failure keeps everything and stops the run', async () => {
    const store = createMemoryUploadStore();
    await enqueue(finished(1), extras, store);
    await enqueue(finished(2), extras, store);
    let calls = 0;
    await flushUploads(store, async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });
    expect(calls).toBe(1);
    const left = await store.all();
    expect(left.map((e) => e.startedAt)).toEqual([1, 2]);
    expect(left[0].attempts).toBe(1);
    expect(uploads.last).toBe('queued');
  });

  test('a rejection the server will never accept drops that entry and continues', async () => {
    const store = createMemoryUploadStore();
    await enqueue(finished(1), extras, store);
    await enqueue(finished(2), extras, store);
    const sent: number[] = [];
    await flushUploads(store, async (e: QueuedRide) => {
      if (e.startedAt === 1) throw new ApiError(413, 'too large');
      sent.push(e.startedAt);
    });
    expect(sent).toEqual([2]);
    expect(await store.all()).toEqual([]);
  });

  test('not signed in keeps the ride for later', async () => {
    const store = createMemoryUploadStore();
    await enqueue(finished(5), extras, store);
    await flushUploads(store, async () => {
      throw new ApiError(401, 'not signed in');
    });
    expect((await store.all()).length).toBe(1);
    expect(uploads.last).toBe('queued');
  });

  test('the queue keeps the newest twenty', async () => {
    const store = createMemoryUploadStore();
    for (let i = 1; i <= 23; i++) await enqueue(finished(i), extras, store);
    const all = await store.all();
    expect(all.length).toBe(20);
    expect(all[0].startedAt).toBe(4);
  });
});
