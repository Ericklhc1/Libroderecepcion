import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';
import packageLock from '../package-lock.json';

describe('versionado de Production', () => {
  it('usa SemVer estable y mantiene sincronizado el lockfile', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages['']?.version).toBe(packageJson.version);
  });

  it('expone la versión desde package.json en el health check', () => {
    const source = readFileSync('src/app/api/health/version/route.ts', 'utf-8');
    expect(source).toContain('packageJson.version');
    expect(source).toContain("provider: process.env.VERCEL ? 'vercel' : 'unknown'");
  });

  it('Vercel sólo despliega main', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf-8')) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
    };
    expect(config.git?.deploymentEnabled).toEqual({ '**': false, main: true });
  });

  it('Vercel Pro mantiene rescates frecuentes sin depender de actividad del mesón', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf-8')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(
      config.crons?.find((cron) => cron.path === '/api/cron/operational-mail')?.schedule,
    ).toBe('5,20,35,50 * * * *');
    expect(
      config.crons?.find((cron) => cron.path === '/api/cron/fronti-proactive')?.schedule,
    ).toBe('2,17,32,47 * * * *');
  });
});
