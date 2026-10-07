// Register, log in, log out, who am I.

import type { Database } from 'bun:sqlite';
import {
  createSession, createUser, dummyHash, findUserByEmail, revokeSession, sessionUser, verifyPassword,
  SESSION_DAYS,
} from '../auth.ts';
import type { User } from '../auth.ts';
import { ApiError, SESSION_COOKIE, clientIp, json, parseCookies, readJson, sessionCookie } from '../http.ts';
import { RateLimiter } from '../ratelimit.ts';
import * as v from '../validate.ts';

export interface AuthContext {
  db: Database;
  cookieSecure: boolean;
  trustProxy: boolean;
  socketAddress: (req: Request) => string | null;
  /** For sealing third-party API keys at rest; null when SECRET_KEY is not configured. */
  secretKey: CryptoKey | null;
  /** Outbound HTTP, replaceable in tests. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const SESSION_SECONDS = SESSION_DAYS * 24 * 3600;

export function currentUser(ctx: AuthContext, req: Request): User | null {
  return sessionUser(ctx.db, parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
}

export function requireUser(ctx: AuthContext, req: Request): User {
  const user = currentUser(ctx, req);
  if (!user) throw new ApiError(401, 'not signed in');
  return user;
}

export function authRoutes(ctx: AuthContext) {
  const loginByKey = new RateLimiter(15 * 60 * 1000, 10);
  const loginByIp = new RateLimiter(15 * 60 * 1000, 30);
  const registerByIp = new RateLimiter(60 * 60 * 1000, 5);
  const ip = (req: Request) => clientIp(req, ctx.socketAddress(req), ctx.trustProxy);

  function signedIn(user: User, req: Request, status = 200): Response {
    const cookie = createSession(ctx.db, user.id, req.headers.get('user-agent') ?? '');
    return json({ user }, status, { 'set-cookie': sessionCookie(cookie, SESSION_SECONDS, ctx.cookieSecure) });
  }

  return {
    async register(req: Request): Promise<Response> {
      const body = v.object(await readJson(req));
      const email = v.email(body.email);
      const password = v.password(body.password);
      if (!registerByIp.hit(ip(req))) throw new ApiError(429, 'too many accounts created from here, try again later', registerByIp.retryAfter(ip(req)));
      if (findUserByEmail(ctx.db, email)) throw new ApiError(409, 'email already registered');
      const user = await createUser(ctx.db, email, password);
      return signedIn(user, req, 201);
    },

    async login(req: Request): Promise<Response> {
      const body = v.object(await readJson(req));
      const email = v.email(body.email);
      const password = v.password(body.password);
      const key = `${ip(req)}|${email}`;
      if (!loginByIp.hit(ip(req)) || !loginByKey.hit(key)) {
        throw new ApiError(429, 'too many attempts, try again later', Math.max(loginByKey.retryAfter(key), loginByIp.retryAfter(ip(req))));
      }
      const found = findUserByEmail(ctx.db, email);
      const ok = await verifyPassword(password, found?.passwordHash ?? (await dummyHash));
      if (!found || !ok) throw new ApiError(401, 'wrong email or password');
      ctx.db.query('UPDATE users SET last_login_at = $t WHERE id = $id').run({ t: Date.now(), id: found.id });
      loginByKey.reset(key);
      return signedIn({ id: found.id, email: found.email }, req);
    },

    logout(req: Request): Response {
      revokeSession(ctx.db, parseCookies(req.headers.get('cookie'))[SESSION_COOKIE]);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0, ctx.cookieSecure) });
    },

    /** Who the cookie belongs to; `null` when nobody, so an anonymous visit is not an error. */
    me(req: Request): Response {
      return json({ user: currentUser(ctx, req) });
    },
  };
}
