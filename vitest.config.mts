import path from 'node:path';
import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config();

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/libro_recepcion_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    globalSetup: ['./tests/global-setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Las pruebas de integración comparten una única base: sin paralelismo.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
      AUTH_SECRET: 'secreto-de-pruebas-suficientemente-largo-para-hs256-0001',
      SESSION_TTL_HOURS: '12',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // `server-only` y `next/headers` sólo existen dentro del runtime de
      // Next.js; en pruebas se sustituyen por stubs equivalentes.
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
      'next/headers': path.resolve(import.meta.dirname, 'tests/stubs/next-headers.ts'),
    },
  },
});
