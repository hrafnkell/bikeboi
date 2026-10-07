import { describe, expect, test } from 'bun:test';
import {
  createSession, createUser, hashPassword, pruneSessions, revokeAll, revokeSession, sessionUser, verifyPassword,
} from '../../server/auth.ts';
import { openDb } from '../../server/db.ts';

const DAY = 24 * 3600 * 1000;

describe('passwords', () => {
  test('hash verifies the right password only', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });
});

describe('sessions', () => {
  test('a cookie value finds its user, expires, and slides once a day', async () => {
    const db = openDb(':memory:');
    const user = await createUser(db, 'a@b.c', 'password1');
    const t0 = 1_000_000;
    const cookie = createSession(db, user.id, 'ua', t0);
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionUser(db, cookie, t0 + 1000)).toEqual({ id: user.id, email: 'a@b.c' });
    expect(sessionUser(db, 'nonsense', t0)).toBeNull();
    expect(sessionUser(db, undefined, t0)).toBeNull();
    const expiry = () => (db.query('SELECT expires_at AS e FROM sessions').get() as { e: number }).e;
    const first = expiry();
    sessionUser(db, cookie, t0 + 12 * 3600 * 1000);
    expect(expiry()).toBe(first); // same day: untouched
    sessionUser(db, cookie, t0 + 2 * DAY);
    expect(expiry()).toBe(t0 + 2 * DAY + 30 * DAY); // refreshed
    expect(sessionUser(db, cookie, t0 + 40 * DAY)).toBeNull(); // long gone
  });

  test('revoking and pruning', async () => {
    const db = openDb(':memory:');
    const user = await createUser(db, 'a@b.c', 'password1');
    const a = createSession(db, user.id, '', 0);
    const b = createSession(db, user.id, '', 0);
    revokeSession(db, a);
    expect(sessionUser(db, a, 1)).toBeNull();
    expect(sessionUser(db, b, 1)).not.toBeNull();
    revokeAll(db, user.id);
    expect(sessionUser(db, b, 1)).toBeNull();
    createSession(db, user.id, '', 0);
    expect(pruneSessions(db, 31 * DAY)).toBe(1);
  });
});
