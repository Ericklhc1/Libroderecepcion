import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('notificaciones con sincronización eficiente', () => {
  const center = readFileSync('src/components/layout/notification-center.tsx', 'utf-8');
  const stream = readFileSync('src/app/api/notifications/stream/route.ts', 'utf-8');
  const readRoute = readFileSync('src/app/api/notifications/read/route.ts', 'utf-8');
  const feed = readFileSync('src/server/services/notification-feed.ts', 'utf-8');

  it('monta toast y panel en document.body para no quedar recortados por el header sticky', () => {
    expect(center).toContain("import { createPortal } from 'react-dom'");
    expect(center.match(/createPortal\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(center.match(/document\.body/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('usa peticiones cortas y no mantiene un EventSource persistente', () => {
    expect(center).toContain("'/api/notifications/stream'");
    expect(center).not.toContain("new EventSource('/api/notifications/stream')");
    expect(center).not.toContain("fetch('/api/notifications/unread'");
    expect(center).not.toContain("@/server/actions/notifications");
    expect(stream).not.toContain('ReadableStream');
    expect(stream).not.toContain('setInterval');
    expect(stream).not.toContain('maxDuration');
    expect(stream).not.toContain('text/event-stream');
  });

  it('sincroniza el feed visible cada 20 s y conserva alarmas ocultas cada 30 s', () => {
    expect(center).toContain('const NOTIFICATION_POLL_MS = 20_000;');
    expect(center).toContain('const HIDDEN_ALARM_PULSE_MS = 30_000;');
    expect(center).toContain("'/api/notifications/stream?mode=alarm'");
    expect(center).toContain("document.addEventListener('visibilitychange'");
    expect(stream).toContain("searchParams.get('mode') === 'alarm'");
    expect(stream).toContain('if (alarmOnly && dispatched === 0)');
    expect(stream).toContain('dispatchDueAlarmsForUser(user.id');
  });

  it('la ruta es dinámica, no-cache, corta y exige sesión válida', () => {
    expect(stream).toContain("export const dynamic = 'force-dynamic'");
    expect(stream).toContain("'Cache-Control': 'no-store'");
    expect(stream).toContain('NextResponse.json');
    expect(stream).toContain('getCurrentUser()');
    expect(stream).toContain('hasAcceptedCurrentTerms(user.id)');
  });

  it('render inicial y polling comparten un único snapshot serializable', () => {
    expect(feed).toContain('export async function getNotificationFeedForUser');
    expect(feed).toContain('prisma.notification.findMany');
    expect(feed).toContain('prisma.notification.count');
    expect(stream).toContain('getNotificationFeedForUser(user.id)');
    expect(readRoute).toContain('getNotificationFeedForUser(user.id)');
  });

  it('marcar lectura queda protegido por usuario y se reconcilia con el feed', () => {
    expect(readRoute).toContain('markReadableNotifications(user.id, parsed.id)');
    const access=readFileSync('src/server/services/notification-access.ts','utf-8');
    expect(access).toContain('notificationWhereForUser(userId)');
    expect(access).toContain('userId,deletedAt:null,...notificationReadWhere');
    expect(access).toContain('readAt:null');
  });
});
