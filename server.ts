// Serves the prebuilt dist/ folder (Vite is the dev server). The backend (accounts,
// uploads) will grow here.

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0');
if (!production) console.warn('bikeboi: serving dist/; for development run `bun run dev` (Vite)');
const root = new URL('./', import.meta.url);

/**
 * The build names scripts, styles and images after their content (assets/index-Ab12cd_4.js),
 * so a release that changes them changes their URLs. Those can be cached forever; the HTML
 * that points at them must always be revalidated, or a CDN would keep serving an old release.
 */
const HASHED = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const FOREVER = 'public, max-age=31536000, immutable';

async function serveDist() {
  const dist = new URL('dist/', root);
  // Only files found at startup are ever served, so a request path can't reach outside dist/.
  const files = new Map<string, { file: ReturnType<typeof Bun.file>; cache: string }>();
  for await (const name of new Bun.Glob('**/*').scan({ cwd: dist.pathname, onlyFiles: true })) {
    const cache = name.endsWith('.html')
      ? 'no-cache'
      : name.startsWith('assets/') || HASHED.test(name) ? FOREVER : 'public, max-age=3600';
    files.set(`/${name}`, { file: Bun.file(new URL(name, dist)), cache });
  }
  if (!files.has('/index.html')) throw new Error('dist/index.html is missing: run "bun run build" first');

  return Bun.serve({
    hostname,
    port,
    fetch(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      const { pathname } = new URL(req.url);
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
}

const server = await serveDist();
console.log(`bikeboi on ${server.url}`);
