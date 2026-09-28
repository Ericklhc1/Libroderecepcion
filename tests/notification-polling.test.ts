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

  it('el cliente usa polling corto del snapshot y no abre un EventSource persistente', () => {
    expect(center).toContain("fetch('/api/notifications/stream'");
    expect(center).not.toContain("new EventSource('/api/notifications/stream')");
    expect(center).not.toContain("fetch('/api/notifications/unread'");
    expect(center).not.toContain("@/server/actions/notifications");
  });

  it('limita el costo y detiene la sincronización cuando la pestaña está oculta', () => {
    expect(center).toContain('const NOTIFICATION_POLL_MS = 20_000;');
    expect(center).toContain("document.visibilityState !== 'visible'");
    expect(center).toContain("document.addEventListener('visibilitychange'");
    expect(stream).not.toContain('ReadableStream');
    expect(stream).not.toContain('setInterval');
    expect(stream).not.toContain('maxDuration');
    expect(stream).not.toContain('text/event-stream');
    expect(stream).not.toContain(': keepalive');
  });

  it('la ruta es dinámica, no-cache, corta y exige sesión válida', () => {
    expect(stream).toContain("export const dynamic = 'force-dynamic'");
    expect(stream).toContain("'Cache-Control': 'no-store'");
    expect(stream).toContain('NextResponse.json');
    expect(stream).toContain('getCurrentUser()');
    expect(stream).toContain('hasAcceptedCurrentTerms(user.id)');
    expect(stream).toContain('dispatchDueAlarmsForUser(user.id');
  });

  it('render inicial y polling comparten un único snapshot serializable', () => {
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
