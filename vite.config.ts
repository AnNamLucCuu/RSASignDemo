import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.BASE_PATH || './',
  worker: { format: 'es' },
  test: { testTimeout: 30000, include: ['tests/**/*.test.{ts,tsx}'] },
} as Parameters<typeof defineConfig>[0]);
