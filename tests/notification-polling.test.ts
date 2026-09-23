import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('notificaciones realtime resistentes a deployments', () => {
  const center = readFileSync('src/components/layout/notification-center.tsx', 'utf-8');
  const stream = readFileSync('src/app/api/notifications/stream/route.ts', 'utf-8');
  const readRoute = readFileSync('src/app/api/notifications/read/route.ts', 'utf-8');
  const feed = readFileSync('src/server/services/notification-feed.ts', 'utf-8');

  it('el cliente mantiene un EventSource y no hace polling HTTP de no leídos', () => {
    expect(center).toContain("new EventSource('/api/notifications/stream')");
    expect(center).not.toContain("fetch('/api/notifications/unread'");
    expect(center).not.toContain("@/server/actions/notifications");
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
