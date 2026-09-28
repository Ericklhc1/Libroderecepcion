import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('notificaciones realtime resistentes a deployments', () => {
  const center = readFileSync('src/components/layout/notification-center.tsx', 'utf-8');
  const stream = readFileSync('src/app/api/notifications/stream/route.ts', 'utf-8');
  const readRoute = readFileSync('src/app/api/notifications/read/route.ts', 'utf-8');
  const feed = readFileSync('src/server/services/notification-feed.ts', 'utf-8');

  it('monta toast y panel en document.body para no quedar recortados por el header sticky', () => {
    expect(center).toContain("import { createPortal } from 'react-dom'");
    expect(center.match(/createPortal\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(center.match(/document\.body/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('el cliente mantiene un EventSource y no hace polling HTTP de no leídos', () => {
    expect(center).toContain("new EventSource('/api/notifications/stream')");
    expect(center).not.toContain("fetch('/api/notifications/unread'");
    expect(center).not.toContain("@/server/actions/notifications");
  });

  it('limita el costo del tiempo real y suspende el stream cuando la pestaña está oculta', () => {
    expect(stream).toContain('const CHECK_MS = 15_000;');
    expect(stream).not.toContain('const CHECK_MS = 2_000;');
    expect(center).toContain("document.visibilityState !== 'visible'");
    expect(center).toContain("document.addEventListener('visibilitychange'");
    expect(center).toContain('disconnect();');
  });

  it('mantiene alarmas con un pulso oculto de bajo costo', () => {
    const pulse = readFileSync('src/app/api/alarms/pulse/route.ts', 'utf-8');
    expect(center).toContain('const HIDDEN_ALARM_PULSE_MS = 30_000;');
    expect(center).toContain("fetch('/api/alarms/pulse'");
    expect(center).toContain('startHiddenAlarmPulse();');
    expect(pulse).toContain('dispatchDueAlarmsForUser(user.id');
    expect(pulse).toContain('if (dispatched === 0)');
    expect(pulse).toContain('getNotificationFeedForUser(user.id)');
  });

  it('el stream es dinámico, SSE, no-cache y exige sesión válida', () => {
    expect(stream).toContain("export const dynamic = 'force-dynamic'");
    expect(stream).toContain("'Content-Type': 'text/event-stream; charset=utf-8'");
    expect(stream).toContain("'Cache-Control': 'no-cache, no-store, no-transform'");
    expect(stream).toContain('getCurrentUser()');
    expect(stream).toContain('hasAcceptedCurrentTerms(user.id)');
    expect(stream).toContain(': keepalive');
  });

  it('render inicial y stream comparten un único snapshot serializable', () => {
    expect(feed).toContain('export async function getNotificationFeedForUser');
    expect(feed).toContain('prisma.notification.findMany');
    expect(feed).toContain('prisma.notification.count');
    expect(stream).toContain('getNotificationFeedForUser(user.id)');
    expect(readRoute).toContain('getNotificationFeedForUser(user.id)');
  });

  it('marcar lectura queda protegido por usuario y se reconcilia con el feed', () => {
    expect(readRoute).toContain('userId: user.id');
    expect(readRoute).toContain('readAt: null');
    expect(readRoute).toContain('data: { readAt: new Date() }');
  });
});
