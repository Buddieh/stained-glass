import { defineConfig } from 'vite';

// Served from https://buddieh.com/stained-glass/ (GitHub Pages project site).
export default defineConfig({
  base: '/stained-glass/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
