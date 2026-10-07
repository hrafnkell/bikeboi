// Assembles the API routes. server.ts adds the static file fallback and starts the server.

import type { Database } from 'bun:sqlite';
import { pruneSessions } from './auth.ts';
import { ApiError, api, json } from './http.ts';
import { authRoutes } from './routes/auth.ts';
import type { AuthContext } from './routes/auth.ts';
import { settingsRoutes } from './routes/settings.ts';
import { extraRoutes } from './routes/index.ts';

export interface AppOptions {
  db: Database;
  cookieSecure: boolean;
  trustProxy: boolean;
}

export type RouteTable = Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', (req: Request) => Promise<Response> | Response>>>;

export const MAX_BODY_BYTES = 3 * 1024 * 1024;

export function createApp(opts: AppOptions) {
  let socketLookup: (req: Request) => string | null = () => null;
  const ctx: AuthContext = {
    db: opts.db,
    cookieSecure: opts.cookieSecure,
    trustProxy: opts.trustProxy,
    socketAddress: (req) => socketLookup(req),
  };
  const auth = authRoutes(ctx);
  const settings = settingsRoutes(ctx);

  const routes: RouteTable = {
    '/api/health': {
      GET: api(() => {
        opts.db.query('SELECT 1').get();
        return json({ ok: true, db: true });
      }),
    },
    '/api/auth/register': { POST: api(auth.register) },
    '/api/auth/login': { POST: api(auth.login) },
    '/api/auth/logout': { POST: api(auth.logout) },
    '/api/auth/me': { GET: api(auth.me) },
    '/api/settings': { GET: api(settings.get), PUT: api(settings.put) },
    ...extraRoutes(ctx),
  };

  /** Unknown /api paths and methods end here. */
  const notFound = api((req) => {
    throw new ApiError(new URL(req.url).pathname.startsWith('/api/') ? 404 : 405, 'not found');
  });

  const pruner = setInterval(() => pruneSessions(opts.db), 60 * 60 * 1000);
  pruner.unref?.();
  pruneSessions(opts.db);

  return {
    routes,
    notFound,
    /** Give the app a way to learn the socket address (Bun's server.requestIP). */
    attachServer(server: { requestIP(req: Request): { address: string } | null }) {
      socketLookup = (req) => server.requestIP(req)?.address ?? null;
    },
    close() {
      clearInterval(pruner);
    },
  };
}
