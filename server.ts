// Dev: bundles index.html on the fly. Production: serves the prebuilt dist/ folder.
// The backend (accounts, uploads) will grow here.

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? (production ? '127.0.0.1' : '0.0.0.0');
const root = new URL('./', import.meta.url);

/** Manifest and icons live outside the bundle, at fixed paths. */
function publicFile(dir: URL, pathname: string): Response | null {
  if (pathname === '/manifest.webmanifest') {
    return new Response(Bun.file(new URL('manifest.webmanifest', dir)), {
      headers: { 'content-type': 'application/manifest+json' },
    });
  }
  const icon = /^\/icons\/([a-z0-9-]+\.png)$/.exec(pathname);
  if (icon) return new Response(Bun.file(new URL(`icons/${icon[1]}`, dir)));
  return null;
}

async function serveDev() {
  const index = (await import('./index.html')).default;
  const publicDir = new URL('public/', root);
  return Bun.serve({
    hostname,
    port,
    development: true,
    routes: {
      '/': index,
      '/manifest.webmanifest': (req) => publicFile(publicDir, new URL(req.url).pathname)!,
      '/icons/:name': (req) =>
        publicFile(publicDir, new URL(req.url).pathname) ?? new Response('Not found', { status: 404 }),
    },
  });
}

/**
 * The build names scripts, styles and images after their content (index-ab12cd34.js), so a
 * release that changes them changes their URLs. Those can be cached forever; the HTML that
 * points at them must always be revalidated, or a CDN would keep serving an old release.
 */
const HASHED = /-[a-z0-9]{8}\.[a-z0-9]+$/;
const FOREVER = 'public, max-age=31536000, immutable';

async function serveDist() {
  const dist = new URL('dist/', root);
  // Only files found at startup are ever served, so a request path can't reach outside dist/.
  const files = new Map<string, { file: ReturnType<typeof Bun.file>; cache: string }>();
  for await (const name of new Bun.Glob('**/*').scan({ cwd: dist.pathname, onlyFiles: true })) {
    const cache = name.endsWith('.html') ? 'no-cache' : HASHED.test(name) ? FOREVER : 'public, max-age=3600';
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

const server = production ? await serveDist() : await serveDev();
console.log(`bikeboi (${production ? 'production' : 'dev'}) on ${server.url}`);
