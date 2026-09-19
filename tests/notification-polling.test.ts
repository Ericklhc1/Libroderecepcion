import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sondeo de notificaciones resistente a deployments', () => {
  const chime = readFileSync('src/components/layout/notification-chime.tsx', 'utf-8');
  const route = readFileSync('src/app/api/notifications/unread/route.ts', 'utf-8');
  const service = readFileSync('src/server/services/notification-poll.ts', 'utf-8');
  const actions = readFileSync('src/server/actions/notifications.ts', 'utf-8');

  it('el cliente no invoca una Server Action periódicamente', () => {
    expect(chime).not.toContain("@/server/actions/notifications");
    expect(chime).not.toContain('getUnreadCounts()');
    expect(chime).toContain("fetch('/api/notifications/unread'");
  });

  it('el endpoint es dinámico, no-cache y exige sesión válida', () => {
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain('getCurrentUser()');
    expect(route).toContain('hasAcceptedCurrentTerms(user.id)');
  });

  it('acción y endpoint comparten una única implementación de conteo', () => {
    expect(service).toContain('export async function getUnreadCountsForUser');
    expect(service).toContain('runAlertEngine');
    expect(service).toContain('countLiveAlerts');
    expect(actions).toContain('getUnreadCountsForUser(user.id)');
    expect(route).toContain('getUnreadCountsForUser(user.id)');
  });
});
