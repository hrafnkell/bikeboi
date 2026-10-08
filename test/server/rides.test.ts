import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { quotas } from '../../server/routes/rides.ts';
import { fakeFit, startApp, uniqueEmail } from './helpers.ts';

const app = startApp();
afterAll(() => app.close());

const summary = { durationS: 600, distanceM: 5000, avgPower: 200, maxPower: 400, avgHeartRate: 0, avgCadence: 90, avgSpeed: 8.3, ascentM: 50, calories: 120, laps: 2 };

function upload(c: ReturnType<typeof app.client>, startedAt: number, extra: Record<string, unknown> = {}, fit = fakeFit()) {
  const form = new FormData();
  form.set('meta', JSON.stringify({ startedAt, circuitId: 'rollers', circuitName: 'Rolling Hills', filename: 'bikeboi-rollers.fit', summary, meta: { laps: 2 }, ...extra }));
  form.set('fit', new Blob([fit as Uint8Array<ArrayBuffer>]), 'ride.fit');
  return c.json('POST', '/api/rides', form);
}

describe('rides', () => {
  const c = app.client();
  beforeAll(async () => {
    expect((await c.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' })).status).toBe(201);
  });

  test('upload, list newest first with keyset paging, fetch, download, delete', async () => {
    for (const t of [1000, 3000, 2000]) expect((await upload(c, t)).status).toBe(201);
    let r = await c.json('GET', '/api/rides?limit=2');
    expect(r.body.rides.map((x: any) => x.startedAt)).toEqual([3000, 2000]);
    expect(r.body.nextBefore).toBe(2000);
    expect(r.body.rides[0].fit).toBeUndefined();
    expect(r.body.rides[0].summary.avgPower).toBe(200);
    r = await c.json('GET', `/api/rides?limit=2&before=${r.body.nextBefore}`);
    expect(r.body.rides.map((x: any) => x.startedAt)).toEqual([1000]);
    expect(r.body.nextBefore).toBeNull();
    const id = r.body.rides[0].id;
    r = await c.json('GET', `/api/rides/${id}`);
    expect(r.body.fitUrl).toBe(`/api/rides/${id}/fit`);
    expect(r.body.ride.meta).toEqual({ laps: 2 });
    const res = await c.call('GET', `/api/rides/${id}/fit`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="bikeboi-rollers.fit"');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(fakeFit()));
    expect((await c.json('DELETE', `/api/rides/${id}`)).status).toBe(200);
    expect((await c.json('DELETE', `/api/rides/${id}`)).status).toBe(404);
  });

  test('a retried upload returns the existing ride', async () => {
    const first = await upload(c, 5000);
    const again = await upload(c, 5000);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body.ride.id).toBe(first.body.ride.id);
  });

  test('bad uploads are refused', async () => {
    expect((await upload(c, 6000, { filename: 'bad.txt' })).status).toBe(400);
    expect((await upload(c, 6000, {}, new Uint8Array(300))).status).toBe(400);
    expect((await upload(c, 6000, { summary: { ...summary, laps: 'two' } })).status).toBe(400);
    expect((await c.json('POST', '/api/rides', { nope: true })).status).toBe(400);
  });

  test('quota', async () => {
    const saved = { ...quotas };
    quotas.maxBytes = 450;
    try {
      const d = app.client();
      await d.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' });
      expect((await upload(d, 1)).status).toBe(201);
      expect((await upload(d, 2)).status).toBe(201);
      const r = await upload(d, 3);
      expect(r.status).toBe(413);
      expect(r.body.error).toBe('storage quota reached');
    } finally {
      Object.assign(quotas, saved);
    }
  });

  test("another user's rides are not visible", async () => {
    const other = app.client();
    await other.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' });
    const mine = (await c.json('GET', '/api/rides')).body.rides[0];
    expect((await other.json('GET', `/api/rides/${mine.id}`)).status).toBe(404);
    expect((await other.call('GET', `/api/rides/${mine.id}/fit`)).status).toBe(404);
    expect((await other.json('DELETE', `/api/rides/${mine.id}`)).status).toBe(404);
    expect((await other.json('GET', '/api/rides')).body.rides).toEqual([]);
  });

  test('stats total the last week, the week before and all time', async () => {
    const d = app.client();
    expect((await d.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' })).status).toBe(201);
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    for (const t of [now - 1 * day, now - 2 * day, now - 9 * day, now - 30 * day]) expect((await upload(d, t)).status).toBe(201);
    const r = await d.json('GET', '/api/rides/stats');
    expect(r.status).toBe(200);
    expect(r.body.week).toMatchObject({ rides: 2, durationS: 1200, distanceM: 10000, ascentM: 100, calories: 240, work: 240000 });
    expect(r.body.previous).toMatchObject({ rides: 1, durationS: 600 });
    expect(r.body.total).toMatchObject({ rides: 4, distanceM: 20000 });
    expect((await app.client().json('GET', '/api/rides/stats')).status).toBe(401);
  });
});
