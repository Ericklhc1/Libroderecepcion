import path from 'node:path';
import { defineConfig } from 'vitest/config';

// No cargar .env antes de validar; URL deliberada y base exclusivamente sintética.
const raw = process.env.TEST_DATABASE_URL;
if (!raw || process.env.AUDIT_LOCAL_DB_CONFIRM !== 'synthetic-only') throw new Error('Se requiere PostgreSQL sintético explícito y AUDIT_LOCAL_DB_CONFIRM=synthetic-only.');
const url = new URL(raw);
if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/aroh_audit_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Reproducción bloqueada: sólo loopback y base aroh_audit_* desechable.');
// El setup existente prohíbe igualdad textual. Todas las conexiones siguen en la misma BD local.
process.env.DATABASE_URL = `${raw}${url.search ? '&' : '?'}application_name=audit_reproduction`;
process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
process.env.AUTH_SECRET = 'secreto-sintetico-auditoria-local-no-produccion-0001';
export default defineConfig({
  test: {
    include: ['audit-reproduction/database.test.ts'], environment: 'node',
    globalSetup: ['./tests/global-setup.ts'], fileParallelism: false,
    testTimeout: 30_000, hookTimeout: 120_000,
    env: { DATABASE_URL: raw, DIRECT_DATABASE_URL: raw, AUTH_SECRET: process.env.AUTH_SECRET, NODE_ENV: 'test' },
  },
  resolve: { alias: { '@': path.resolve('src'), 'server-only': path.resolve('tests/stubs/server-only.ts'), 'next/headers': path.resolve('tests/stubs/next-headers.ts') } },
});
