// Serves the prebuilt dist/ folder and the JSON API. Vite is the dev server for the UI.

import { createApp, MAX_BODY_BYTES } from './server/app.ts';
import { openDb } from './server/db.ts';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0');
const root = new URL('./', import.meta.url);

const db = openDb(process.env.DB_PATH ?? (production ? undefined : ':memory:'));
if (!process.env.DB_PATH) console.warn('bikeboi: DB_PATH is not set; using an in-memory database');

const app = createApp({
  db,
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== '0' : production,
  trustProxy: process.env.TRUST_PROXY === '1',
});

/**
 * The build names scripts, styles and images after their content (assets/index-Ab12cd_4.js),
 * so a release that changes them changes their URLs. Those can be cached forever; the HTML
 * that points at them must always be revalidated, or a CDN would keep serving an old release.
 */
const HASHED = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const FOREVER = 'public, max-age=31536000, immutable';

async function loadDist(): Promise<Map<string, { file: ReturnType<typeof Bun.file>; cache: string }>> {
  const dist = new URL('dist/', root);
  // Only files found at startup are ever served, so a request path can't reach outside dist/.
  const files = new Map<string, { file: ReturnType<typeof Bun.file>; cache: string }>();
  for await (const name of new Bun.Glob('**/*').scan({ cwd: dist.pathname, onlyFiles: true })) {
    const cache = name.endsWith('.html')
      ? 'no-cache'
      : name.startsWith('assets/') || HASHED.test(name) ? FOREVER : 'public, max-age=3600';
    files.set(`/${name}`, { file: Bun.file(new URL(name, dist)), cache });
  }
  if (!files.has('/index.html')) {
    if (production) throw new Error('dist/index.html is missing: run "bun run build" first');
    console.warn('bikeboi: no dist/ build found; serving the API only (run `bun run dev` for the UI)');
  }
  return files;
}

const files = await loadDist();

const server = Bun.serve({
  hostname,
  port,
  maxRequestBodySize: MAX_BODY_BYTES,
  routes: app.routes,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/')) return app.notFound(req);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    if (pathname === '/healthz') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
    const entry = files.get(pathname === '/' ? '/index.html' : pathname);
    if (!entry) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(entry.file, {
      headers: {
        'cache-control': entry.cache,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  },
});
app.attachServer(server);

console.log(`bikeboi on ${server.url}`);
