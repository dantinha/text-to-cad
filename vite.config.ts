import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { createGeminiDevPlugin } from './server/dev-proxy';

export default defineConfig({
  plugins: [react(), tailwindcss(), createGeminiDevPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: [
        'src/core/**',
        'src/kernel/**',
        'src/export/**',
        'src/presets/**',
        'src/ai/**',
        'src/app/**',
        'src/i18n/**',
        'server/**',
      ],
      exclude: ['src/**/*.d.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
