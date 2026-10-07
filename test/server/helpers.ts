// Shared helpers for server tests: an in-memory app on a random port, a client with cookies.

import { createApp } from '../../server/app.ts';
import { openDb } from '../../server/db.ts';

/** Smallest thing the server accepts as a FIT file: a 14-byte header with ".FIT" plus padding. */
export function fakeFit(size = 200): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes[0] = 14;
  bytes[1] = 0x10;
  bytes.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  for (let i = 14; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

export function startApp() {
  const db = openDb(':memory:');
  const app = createApp({ db, cookieSecure: false, trustProxy: false });
  const server = Bun.serve({ port: 0, routes: app.routes, fetch: app.notFound });
  app.attachServer(server);
  const origin = `http://127.0.0.1:${server.port}`;

  function client() {
    let cookie = '';
    async function call(method: string, path: string, body?: unknown, init: RequestInit & { raw?: boolean } = {}) {
      const headers = new Headers(init.headers);
      headers.set('origin', origin);
      if (cookie) headers.set('cookie', cookie);
      let payload: BodyInit | undefined;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) {
        headers.set('content-type', 'application/json');
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${origin}${path}`, { method, headers, body: payload });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    }
    return {
      call,
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value;
      },
      async json(method: string, path: string, body?: unknown) {
        const res = await call(method, path, body);
        return { status: res.status, body: (await res.json()) as any, res };
      },
    };
  }

  return {
    db,
    app,
    server,
    origin,
    client,
    close() {
      app.close();
      server.stop(true);
      db.close();
    },
  };
}

let counter = 0;
export function uniqueEmail(): string {
  counter += 1;
  return `user${counter}-${Date.now().toString(36)}@example.com`;
}
