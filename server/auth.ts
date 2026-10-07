// Passwords and sessions.

import type { Database } from 'bun:sqlite';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

export interface User {
  id: number;
  email: string;
}

export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/** Verified against when an email is unknown, so a login attempt takes the same time either way. */
export const dummyHash: Promise<string> = hashPassword('not-a-real-password');

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(new Bun.CryptoHasher('sha256').update(bytes).digest());
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

/** Opens a session and returns the cookie value. Only a hash of it is stored. */
export function createSession(db: Database, userId: number, userAgent: string, now = Date.now()): string {
  const token = crypto.getRandomValues(new Uint8Array(32));
  db.query(
    'INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES ($u, $h, $t, $t, $e, $ua)',
  ).run({ u: userId, h: sha256(token), t: now, e: now + SESSION_MS, ua: userAgent.slice(0, 200) });
  return toBase64Url(token);
}

/** The user behind a cookie value, or null. Slides the expiry at most once a day. */
export function sessionUser(db: Database, cookieValue: string | undefined, now = Date.now()): User | null {
  if (!cookieValue) return null;
  const token = fromBase64Url(cookieValue);
  if (!token) return null;
  const row = db.query(
    `SELECT s.id AS sid, s.last_seen_at AS seen, u.id AS id, u.email AS email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $h AND s.expires_at > $now`,
  ).get({ h: sha256(token), now }) as { sid: number; seen: number; id: number; email: string } | null;
  if (!row) return null;
  if (now - row.seen >= REFRESH_AFTER_MS) {
    db.query('UPDATE sessions SET last_seen_at = $now, expires_at = $e WHERE id = $id').run({ now, e: now + SESSION_MS, id: row.sid });
  }
  return { id: row.id, email: row.email };
}

export function revokeSession(db: Database, cookieValue: string | undefined): void {
  const token = cookieValue ? fromBase64Url(cookieValue) : null;
  if (token) db.query('DELETE FROM sessions WHERE token_hash = $h').run({ h: sha256(token) });
}

export function revokeAll(db: Database, userId: number): void {
  db.query('DELETE FROM sessions WHERE user_id = $u').run({ u: userId });
}

export function pruneSessions(db: Database, now = Date.now()): number {
  return db.query('DELETE FROM sessions WHERE expires_at <= $now').run({ now }).changes;
}

export function findUserByEmail(db: Database, email: string): (User & { passwordHash: string }) | null {
  const row = db.query('SELECT id, email, password_hash AS passwordHash FROM users WHERE email = $e').get({ e: email }) as
    | (User & { passwordHash: string })
    | null;
  return row;
}

export async function createUser(db: Database, email: string, password: string, now = Date.now()): Promise<User> {
  const hash = await hashPassword(password);
  const result = db.query('INSERT INTO users (email, password_hash, created_at) VALUES ($e, $h, $t)').run({ e: email, h: hash, t: now });
  return { id: Number(result.lastInsertRowid), email };
}
