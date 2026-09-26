import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getR2AccountIdDiagnostics,
  probeR2Connectivity,
  probeR2EndpointCandidates,
} from '@/server/storage/r2';

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

  it('diagnostica la forma esperada del Account ID sin devolver su valor', () => {
    const before = process.env.R2_ACCOUNT_ID;
    process.env.R2_ACCOUNT_ID = 'a'.repeat(32);
    try {
      expect(getR2AccountIdDiagnostics()).toEqual({
        present: true,
        length: 32,
        expectedShape: true,
      });
    } finally {
      if (before === undefined) delete process.env.R2_ACCOUNT_ID;
      else process.env.R2_ACCOUNT_ID = before;
    }
  });

  it('distingue jurisdicción autenticada, rechazo HTTP y fallo TLS sin exponer hosts', async () => {
    const previous = {
      account: process.env.R2_ACCOUNT_ID,
      access: process.env.R2_ACCESS_KEY_ID,
      secret: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET,
    };
    process.env.R2_ACCOUNT_ID = 'b'.repeat(32);
    process.env.R2_ACCESS_KEY_ID = 'test-access';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET = 'test-bucket';

    try {
      const rows = await probeR2EndpointCandidates(async (jurisdiction, host) => {
        expect(host).toContain('.r2.cloudflarestorage.com');
        if (jurisdiction === 'default') {
          const error = new TypeError('fetch failed', {
            cause: { code: 'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE' },
          });
          throw error;
        }
        if (jurisdiction === 'us') return new Response(null, { status: 404 });
        if (jurisdiction === 'eu') return new Response(null, { status: 403 });
        return new Response(null, { status: 500 });
      });

      expect(rows).toEqual([
        {
          jurisdiction: 'default',
          reachable: false,
          authenticated: false,
          httpStatus: null,
          failureType: 'TypeError',
          failureCode: 'ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE',
        },
        {
          jurisdiction: 'us',
          reachable: true,
          authenticated: true,
          httpStatus: 404,
          failureType: null,
          failureCode: null,
        },
        {
          jurisdiction: 'eu',
          reachable: true,
          authenticated: false,
          httpStatus: 403,
          failureType: null,
          failureCode: null,
        },
        {
          jurisdiction: 'fedramp',
          reachable: true,
          authenticated: false,
          httpStatus: 500,
          failureType: null,
          failureCode: null,
        },
      ]);
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('R2_ACCOUNT_ID', previous.account);
      restore('R2_ACCESS_KEY_ID', previous.access);
      restore('R2_SECRET_ACCESS_KEY', previous.secret);
      restore('R2_BUCKET', previous.bucket);
    }
  });

  it('el endpoint combina configuración y conectividad sin mostrar credenciales', () => {
    const source = readFileSync('src/app/api/health/storage/route.ts', 'utf8');
    expect(source).toContain('probeR2Connectivity');
    expect(source).toContain('probeR2EndpointCandidates');
    expect(source).toContain('getR2AccountIdDiagnostics');
    expect(source).toContain('status.configured && connectivity.reachable');
    expect(source).toContain('configurationWarnings');
    expect(source).not.toContain('secretAccessKey');
    expect(source).not.toContain('R2_SECRET_ACCESS_KEY: process.env');
  });
});
