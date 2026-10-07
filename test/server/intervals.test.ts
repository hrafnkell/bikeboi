import { describe, expect, test } from 'bun:test';
import { loadSecretKey, open, seal } from '../../server/crypto.ts';
import { IntervalsError, uploadActivity, whoAmI } from '../../server/intervals.ts';
import { createApp } from '../../server/app.ts';
import { openDb } from '../../server/db.ts';

const SECRET = 'a'.repeat(64);

describe('sealing', () => {
  test('round-trips and refuses tampering', async () => {
    const key = (await loadSecretKey(SECRET))!;
    const box = await seal(key, 'my-api-key');
    expect(box.length).toBe(12 + 'my-api-key'.length + 16);
    expect(await open(key, box)).toBe('my-api-key');
    box[20] ^= 1;
    await expect(open(key, box)).rejects.toBeDefined();
    expect(await loadSecretKey(undefined)).toBeNull();
    await expect(loadSecretKey('too-short')).rejects.toThrow(/32 bytes/);
  });
});

/** A fake intervals.icu that records what it was asked. */
function fakeIntervals(opts: { valid?: string; fail?: number } = {}) {
  const calls: Array<{ url: string; auth: string | null; method: string; form?: FormData }> = [];
  const valid = opts.valid ?? 'goodkey123';
  const mode = { fail: opts.fail ?? 0 };
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    const auth = headers.get('authorization');
    const form = init.body instanceof FormData ? init.body : undefined;
    calls.push({ url, auth, method: init.method ?? 'GET', form });
    if (mode.fail) return new Response('nope', { status: mode.fail });
    if (auth !== `Basic ${Buffer.from(`API_KEY:${valid}`).toString('base64')}`) return new Response('{}', { status: 403 });
    if (url.endsWith('/api/v1/athlete/0')) return Response.json({ id: 'i12345', name: 'Test Rider' });
    if (url.includes('/api/v1/athlete/0/activities')) {
      const file = form?.get('file');
      const size = file instanceof Blob ? file.size : 0;
      const dup = calls.filter((c) => c.method === 'POST').length > 1;
      return Response.json({ icu_athlete_id: 'i12345', activities: [{ id: `i${size}` }] }, { status: dup ? 200 : 201 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls, mode };
}

describe('intervals client', () => {
  test('identifies the key owner and reports a bad key', async () => {
    const icu = fakeIntervals();
    expect(await whoAmI(icu.fetchImpl, 'goodkey123')).toEqual({ id: 'i12345', name: 'Test Rider' });
    await expect(whoAmI(icu.fetchImpl, 'wrong')).rejects.toBeInstanceOf(IntervalsError);
    await expect(whoAmI(fakeIntervals({ fail: 500 }).fetchImpl, 'goodkey123')).rejects.toMatchObject({ status: 502 });
    await expect(whoAmI(fakeIntervals({ fail: 429 }).fetchImpl, 'goodkey123')).rejects.toMatchObject({ status: 429 });
  });

  test('uploads the file with name, description and external id, and sees duplicates', async () => {
    const icu = fakeIntervals();
    const fit = new Uint8Array(300);
    const first = await uploadActivity(icu.fetchImpl, 'goodkey123', { fit, filename: 'r.fit', name: 'bikeboi: Rollers', description: 'd', externalId: 'bikeboi:x' });
    expect(first).toEqual({ activityId: 'i300', duplicate: false });
    const url = new URL(icu.calls[0].url);
    expect(url.pathname).toBe('/api/v1/athlete/0/activities');
    expect(url.searchParams.get('name')).toBe('bikeboi: Rollers');
    expect(url.searchParams.get('external_id')).toBe('bikeboi:x');
    expect(url.searchParams.get('device_name')).toBe('bikeboi');
    expect((icu.calls[0].form?.get('file') as File).name).toBe('r.fit');
    const again = await uploadActivity(icu.fetchImpl, 'goodkey123', { fit, filename: 'r.fit', name: 'n', description: 'd', externalId: 'bikeboi:x' });
    expect(again.duplicate).toBe(true);
  });
});

describe('intervals routes', () => {
  async function boot(icu = fakeIntervals()) {
    const db = openDb(':memory:');
    const app = createApp({ db, cookieSecure: false, trustProxy: false, secretKey: await loadSecretKey(SECRET), fetch: icu.fetchImpl });
    const server = Bun.serve({ port: 0, routes: app.routes, fetch: app.notFound });
    const origin = server.url.origin;
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown, raw?: BodyInit) => {
      const res = await fetch(`${origin}${path}`, {
        method, headers: { origin, cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    };
    await call('POST', '/api/auth/register', { email: `i${Date.now()}@example.com`, password: 'password1' });
    return { db, app, server, call, icu, close: () => { server.stop(true); app.close(); } };
  }

  function fakeFit(): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(new ArrayBuffer(400));
    b.set([0x0e, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54]);
    return b;
  }
  function rideForm(startedAt: number): FormData {
    const f = new FormData();
    f.append('meta', JSON.stringify({ startedAt, circuitId: 'rollers', circuitName: 'Rolling Hills', filename: 'ride.fit', summary: { durationS: 600, distanceM: 5000, avgPower: 200, maxPower: 300, avgHeartRate: 0, avgCadence: 90, avgSpeed: 8.3, ascentM: 73, calories: 120, laps: 1 }, meta: { pacer: 200 } }));
    f.append('fit', new Blob([fakeFit()]), 'ride.fit');
    return f;
  }

  test('connect checks the key, stores it sealed, and can be toggled and removed', async () => {
    const t = await boot();
    expect((await (await t.call('GET', '/api/intervals')).json())).toMatchObject({ connected: false, available: true });
    const bad = await t.call('PUT', '/api/intervals', { apiKey: 'wrongkey1' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/rejected/);
    const ok = await t.call('PUT', '/api/intervals', { apiKey: 'goodkey123', auto: true });
    expect(await ok.json()).toMatchObject({ connected: true, athleteId: 'i12345', athleteName: 'Test Rider', auto: true });
    const stored = t.db.query('SELECT api_key FROM intervals').get() as { api_key: Uint8Array };
    expect(Buffer.from(stored.api_key).toString()).not.toContain('goodkey123');
    expect((await (await t.call('PUT', '/api/intervals', { auto: false })).json()).auto).toBe(false);
    expect((await t.call('DELETE', '/api/intervals')).status).toBe(200);
    expect((await (await t.call('GET', '/api/intervals')).json()).connected).toBe(false);
    expect((await t.call('PUT', '/api/intervals', { auto: true })).status).toBe(409);
    t.close();
  });

  test('a saved ride goes to intervals.icu automatically, or on request', async () => {
    const t = await boot();
    const first = await (await t.call('POST', '/api/rides', undefined, rideForm(1_700_000_000_000))).json();
    expect(first.ride.intervalsId).toBeNull();
    await t.call('PUT', '/api/intervals', { apiKey: 'goodkey123', auto: true });
    const auto = await (await t.call('POST', '/api/rides', undefined, rideForm(1_700_000_100_000))).json();
    expect(auto.ride.intervalsId).toBe('i400');
    expect(auto.ride.intervalsError).toBeNull();
    const posted = t.icu.calls.filter((c) => c.method === 'POST');
    expect(posted.length).toBe(1);
    expect(new URL(posted[0].url).searchParams.get('external_id')).toBe(`bikeboi:${auto.ride.id}`);
    expect(new URL(posted[0].url).searchParams.get('description')).toMatch(/5\.0 km · 10 min · 200 W avg · 1 lap · pacemaker 200 W/);
    const manual = await (await t.call('POST', `/api/rides/${first.ride.id}/intervals`)).json();
    expect(manual.ride.intervalsId).toBe('i400');
    expect(manual.duplicate).toBe(true);
    expect((await t.call('POST', '/api/rides/nope/intervals')).status).toBe(404);
    t.close();
  });

  test('an upload failure is recorded on the ride and does not lose the ride', async () => {
    const icu = fakeIntervals();
    const t = await boot(icu);
    await t.call('PUT', '/api/intervals', { apiKey: 'goodkey123', auto: true });
    icu.mode.fail = 500;
    const saved = await (await t.call('POST', '/api/rides', undefined, rideForm(1_700_000_300_000))).json();
    expect(saved.ride.id).toBeDefined();
    expect(saved.ride.intervalsId).toBeNull();
    expect(saved.ride.intervalsError).toMatch(/answered 500/);
    const retry = await t.call('POST', `/api/rides/${saved.ride.id}/intervals`);
    expect(retry.status).toBe(502);
    icu.mode.fail = 0;
    const ok = await (await t.call('POST', `/api/rides/${saved.ride.id}/intervals`)).json();
    expect(ok.ride.intervalsId).toBe('i400');
    expect(ok.ride.intervalsError).toBeNull();
    t.close();
  });
});
