import { afterAll, describe, expect, test } from 'bun:test';
import { startApp, uniqueEmail } from './helpers.ts';

// one app per group: registrations are rate-limited per address, and every test here is 127.0.0.1
function fresh() {
  const app = startApp();
  afterAll(() => app.close());
  return app;
}

describe('auth flow', () => {
  const app = fresh();

  test('register, me, logout', async () => {
    const c = app.client();
    const email = uniqueEmail();
    const reg = await c.call('POST', '/api/auth/register', { email, password: 'password1' });
    expect(reg.status).toBe(201);
    const cookie = reg.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^bb_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    expect(cookie).not.toContain('Secure');
    expect((await c.json('GET', '/api/auth/me')).body.user.email).toBe(email);
    expect((await c.json('POST', '/api/auth/register', { email, password: 'password1' })).status).toBe(409);
    expect((await c.json('POST', '/api/auth/login', { email, password: 'wrong-one' })).status).toBe(401);
    expect((await c.json('POST', '/api/auth/login', { email, password: 'password1' })).status).toBe(200);
    const out = await c.call('POST', '/api/auth/logout');
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await c.json('GET', '/api/auth/me')).body.user).toBeNull();
  });

  test('headers and refusals', async () => {
    const c = app.client();
    await c.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' });
    const me = await c.call('GET', '/api/auth/me');
    expect(me.headers.get('cache-control')).toBe('no-store');
    expect(me.headers.get('x-content-type-options')).toBe('nosniff');
    const foreign = await fetch(`${app.origin}/api/settings`, {
      method: 'PUT', headers: { origin: 'https://evil.example', cookie: c.cookie, 'content-type': 'application/json' }, body: '{}',
    });
    expect(foreign.status).toBe(403);
    const form = await fetch(`${app.origin}/api/settings`, { method: 'PUT', headers: { origin: app.origin, cookie: c.cookie }, body: 'doc=1' });
    expect(form.status).toBe(415);
    const huge = await c.call('PUT', '/api/settings', { doc: {}, updatedAt: 1, pad: 'x'.repeat(100_000) });
    expect(huge.status).toBe(413);
    const missing = await c.json('GET', '/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'not found' });
    expect(missing.res.headers.get('cache-control')).toBe('no-store');
    expect((await c.call('DELETE', '/api/auth/me')).status).toBe(404);
  });
});

describe('settings', () => {
  const app = fresh();
  test('newer timestamp wins', async () => {
    const c = app.client();
    await c.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' });
    expect((await c.json('GET', '/api/settings')).body).toEqual({ doc: null, updatedAt: 0 });
    let r = await c.json('PUT', '/api/settings', { doc: { ftp: 300, scene: 'tron', junk: 1 }, updatedAt: 2000 });
    expect(r.body.applied).toBe(true);
    expect(r.body.doc.ftp).toBe(300);
    expect(r.body.doc.junk).toBeUndefined();
    r = await c.json('PUT', '/api/settings', { doc: { ftp: 100 }, updatedAt: 1000 });
    expect(r.body.applied).toBe(false);
    expect(r.body.doc.ftp).toBe(300);
    expect(r.body.updatedAt).toBe(2000);
  });
});

describe('workouts', () => {
  const app = fresh();
  test('create, update by timestamp, list, delete, limits', async () => {
    const c = app.client();
    await c.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' });
    let r = await c.json('PUT', '/api/workouts/custom:abcd', { name: ' Hills ', text: '- 10m 75%', updatedAt: 100 });
    expect(r.status).toBe(201);
    expect(r.body.workout).toMatchObject({ id: 'custom:abcd', name: 'Hills', updatedAt: 100 });
    r = await c.json('PUT', '/api/workouts/custom:abcd', { name: 'Old', text: '- 5m 50%', updatedAt: 50 });
    expect(r.body.applied).toBe(false);
    expect(r.body.workout.name).toBe('Hills');
    r = await c.json('PUT', '/api/workouts/custom:abcd', { name: 'New', text: '- 5m 50%', updatedAt: 200 });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(true);
    expect((await c.json('GET', '/api/workouts')).body.workouts.map((w: any) => w.name)).toEqual(['New']);
    r = await c.json('PUT', '/api/workouts/custom:bad1', { name: 'x', text: '- 2km 50%', updatedAt: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^Line 1: /);
    expect((await c.json('PUT', '/api/workouts/builtin:x', { name: 'x', text: '- 5m 50%', updatedAt: 1 })).status).toBe(400);
    expect((await c.json('DELETE', '/api/workouts/custom:abcd')).status).toBe(200);
    expect((await c.json('DELETE', '/api/workouts/custom:abcd')).status).toBe(200);
    expect((await c.json('GET', '/api/workouts')).body.workouts).toEqual([]);
  });
});

describe('account', () => {
  const app = fresh();
  test('deleting needs the password and removes everything', async () => {
    const c = app.client();
    const email = uniqueEmail();
    await c.json('POST', '/api/auth/register', { email, password: 'password1' });
    await c.json('PUT', '/api/settings', { doc: { ftp: 222 }, updatedAt: 5 });
    expect((await c.json('DELETE', '/api/account', { password: 'nope-nope' })).status).toBe(401);
    const del = await c.call('DELETE', '/api/account', { password: 'password1' });
    expect(del.status).toBe(200);
    expect(del.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await c.json('GET', '/api/auth/me')).body.user).toBeNull();
    expect((await c.json('POST', '/api/auth/login', { email, password: 'password1' })).status).toBe(401);
    expect((app.db.query('SELECT count(*) AS n FROM settings').get() as { n: number }).n).toBe(0);
  });
});
