import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The proxy rewrites Host to the target; the API's same-origin check needs the browser's.
const keepHost = (proxy: { on(event: 'proxyReq', fn: (proxyReq: { setHeader(name: string, value: string): void }, req: { headers: Record<string, string | string[] | undefined> }) => void): void }) => {
  proxy.on('proxyReq', (proxyReq, req) => {
    const host = req.headers.host;
    if (typeof host === 'string') proxyReq.setHeader('host', host);
  });
};

export default defineConfig({
  plugins: [vue()],
  // listen on all interfaces so a phone can reach the dev server through a tunnel
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    // the API runs in server.ts (bun run dev:api); no changeOrigin, so the Origin check sees our own host
    proxy: {
      '/api': { target: 'http://127.0.0.1:3071', configure: keepHost },
      '/healthz': { target: 'http://127.0.0.1:3071', configure: keepHost },
    },
  },
  // keep icons and screenshots as hashed files rather than inlined data: URLs
  build: { assetsInlineLimit: 0 },
});
