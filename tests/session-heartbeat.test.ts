import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('heartbeat de sesión global', () => {
  it('no depende del acceso a FRONTI', () => {
    const route = readFileSync('src/app/api/session/heartbeat/route.ts', 'utf8');
    expect(route).toContain('refreshSession(user.id, user.sessionId)');
    expect(route).not.toContain('canUseFronti');
    expect(route).not.toContain('getFrontiConfig');
  });

  it('la campana usa el heartbeat genérico y no el alias de FRONTI', () => {
    const source = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    expect(source).toContain("fetch('/api/session/heartbeat'");
    expect(source).not.toContain("fetch('/api/asistente?heartbeat=1&active=1'");
  });
});
