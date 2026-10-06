import index from './index.html';

const port = Number(process.env.PORT ?? 3000);
const publicDir = new URL('./public/', import.meta.url);

const server = Bun.serve({
  hostname: '0.0.0.0',
  port,
  routes: {
    '/': index,
    '/manifest.webmanifest': () =>
      new Response(Bun.file(new URL('manifest.webmanifest', publicDir)), {
        headers: { 'content-type': 'application/manifest+json' },
      }),
    '/icons/:name': (req) => {
      const name = req.params.name;
      if (!/^[a-z0-9-]+\.png$/.test(name)) return new Response('Not found', { status: 404 });
      return new Response(Bun.file(new URL(`icons/${name}`, publicDir)));
    },
  },
  development: process.env.NODE_ENV !== 'production',
});

console.log(`bikeboi on ${server.url}`);
