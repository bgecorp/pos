import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Consume shared packages from source so the website needs no package build step.
    alias: {
      '@pos/shared-types': pkg('shared-types'),
      '@pos/feature-entitlements': pkg('feature-entitlements'),
    },
  },
  server: { port: 5173 },
});
