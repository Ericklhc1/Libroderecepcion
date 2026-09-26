import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { probeR2Connectivity } from '@/server/storage/r2';

describe('salud real de almacenamiento R2', () => {
  it('considera 404 una conexión válida a una clave de salud inexistente', async () => {
    const result = await probeR2Connectivity(async () => new Response(null, { status: 404 }));
    expect(result).toEqual({
      reachable: true,
      httpStatus: 404,
      failureType: null,
    });
  });

  it('distingue rechazo HTTP de un endpoint alcanzable pero no utilizable', async () => {
    const result = await probeR2Connectivity(async () => new Response(null, { status: 403 }));
    expect(result).toEqual({
      reachable: false,
      httpStatus: 403,
      failureType: null,
    });
  });

  it('captura fallos de red/TLS sin propagar secretos ni excepciones', async () => {
    const result = await probeR2Connectivity(async () => {
      throw new TypeError('fetch failed');
    });
    expect(result).toEqual({
      reachable: false,
      httpStatus: null,
      failureType: 'TypeError',
    });
  });

  it('el endpoint combina configuración y conectividad sin mostrar credenciales', () => {
    const source = readFileSync('src/app/api/health/storage/route.ts', 'utf8');
    expect(source).toContain('probeR2Connectivity');
    expect(source).toContain('status.configured && connectivity.reachable');
    expect(source).toContain('configurationWarnings');
    expect(source).not.toContain('secretAccessKey');
    expect(source).not.toContain('R2_SECRET_ACCESS_KEY: process.env');
  });
});
