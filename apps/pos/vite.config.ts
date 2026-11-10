import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));
const SERVER = `http://127.0.0.1:${process.env.POS_PORT ?? 4100}`;

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@pos/shared-types': pkg('shared-types'),
      '@pos/feature-entitlements': pkg('feature-entitlements'),
    },
  },
  // Production: the local server serves this folder. Dev: Vite on 5174 proxies /rpc to it.
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: { port: 5174, proxy: { '/rpc': SERVER } },
});
