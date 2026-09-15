import { describe, expect, it } from 'vitest';
import { normalizeDatabaseEnv, resolveDatabaseUrls, type EnvLike } from '@/lib/database-url';

/**
 * Resolución de las variables de conexión.
 *
 * Cada proveedor publica la misma información con nombres distintos. Estas
 * pruebas fijan los tres casos que importan, para que conectar la base desde
 * el panel del proveedor no obligue a copiar cadenas a mano.
 */
const POOLED = 'postgresql://u:p@ep-x-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';
const DIRECT = 'postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/neondb?sslmode=require';

/** Un entorno de mentira, con sólo las variables que interesan a la prueba. */
const envWith = (values: Record<string, string>): EnvLike => ({ ...values });

describe('variables de conexión', () => {
  it('usa los nombres propios cuando se configuran a mano', () => {
    const env = envWith({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT });
    const resolved = resolveDatabaseUrls(env);
    expect(resolved.pooled).toBe(POOLED);
    expect(resolved.direct).toBe(DIRECT);
  });

  it('acepta los nombres que publica la integración de Neon en Vercel', () => {
    const env = envWith({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
    const result = normalizeDatabaseEnv(env);
    expect(result.ok).toBe(true);
    expect(env.DIRECT_DATABASE_URL).toBe(DIRECT);
    expect(result.detail).toContain('DATABASE_URL_UNPOOLED');
  });

  it('acepta los nombres que publica la integración de Postgres en Vercel', () => {
    const env = envWith({ POSTGRES_PRISMA_URL: POOLED, POSTGRES_URL_NON_POOLING: DIRECT });
    const result = normalizeDatabaseEnv(env);
    expect(result.ok).toBe(true);
    expect(env.DATABASE_URL).toBe(POOLED);
    expect(env.DIRECT_DATABASE_URL).toBe(DIRECT);
  });

  it('si sólo hay una conexión, la usa también para migrar', () => {
    const env = envWith({ DATABASE_URL: POOLED });
    const result = normalizeDatabaseEnv(env);
    expect(result.ok).toBe(true);
    expect(env.DIRECT_DATABASE_URL).toBe(POOLED);
    expect(result.detail).toContain('la misma');
  });

  it('avisa con claridad cuando no hay ninguna conexión', () => {
    const result = normalizeDatabaseEnv({});
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('DATABASE_URL');
  });

  it('ignora valores vacíos en lugar de tomarlos como válidos', () => {
    const env = envWith({ DATABASE_URL: '   ', POSTGRES_URL: POOLED });
    const resolved = resolveDatabaseUrls(env);
    expect(resolved.pooled).toBe(POOLED);
  });
});
