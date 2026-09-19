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
});
