import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // listen on all interfaces so a phone can reach the dev server through a tunnel
  server: { host: true, port: 3000, strictPort: true },
  // keep icons and screenshots as hashed files rather than inlined data: URLs
  build: { assetsInlineLimit: 0 },
});
