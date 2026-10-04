import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('experiencia de notificaciones', () => {
  it('detecta nuevos mensajes aunque el chat reutilice la misma notificación', () => {
    const source = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    expect(source).toContain('knownVersions.current.get(item.id) !== item.createdAt');
    expect(source).toContain('knownVersions.current.set(item.id, item.createdAt)');
  });

  it('mantiene avisos del dispositivo y añade Web Push real con AROH cerrado', () => {
    const source = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    const helper = readFileSync('src/components/layout/device-notifications.ts', 'utf8');
    const worker = readFileSync('public/central-notifications-sw.js', 'utf8');
    const push = readFileSync('src/server/services/web-push.ts', 'utf8');
    const manifest = readFileSync('src/app/manifest.ts', 'utf8');

    expect(source).toContain('/api/notifications/stream?mode=background');
    expect(source).toContain('showDeviceNotification(item)');
    expect(source).toContain('reconcileDeviceNotifications()');
    expect(source).toContain('syncAppBadge(unread)');
    expect(helper).toContain('Notification.requestPermission()');
    expect(helper).toContain('setAppBadge');
    expect(helper).toContain('clearAppBadge');
    expect(helper).toContain("type: 'aroh:sync-badge'");
    expect(helper).toContain("serviceWorker.register('/central-notifications-sw.js'");
    expect(helper).toContain('worker.pushManager.subscribe');
    expect(helper).toContain('/api/push/subscriptions');
    expect(worker).toContain("self.addEventListener('push'");
    expect(worker).toContain("self.addEventListener('notificationclick'");
    expect(worker).toContain("self.addEventListener('message'");
    expect(worker).toContain("data.type !== 'aroh:sync-badge'");
    expect(worker).toContain('/api/push/payload');
    expect(push).toContain("setProtectedHeader({ alg: 'ES256', typ: 'JWT' })");
    expect(push).toContain("Authorization: await vapidAuthorization");
    expect(push).toContain("SELECT 1::int AS locked FROM pg_advisory_xact_lock");
    expect(push).not.toContain("SELECT pg_advisory_xact_lock(hashtext('aroh-web-push-vapid'))");
    expect(manifest).toContain("display: 'standalone'");
  });

  it('resuelve tareas simples sin obligar a tomar y validar antes', () => {
    const list = readFileSync('src/app/(app)/tareas/page.tsx', 'utf8');
    const detail = readFileSync('src/app/(app)/tareas/[id]/page.tsx', 'utf8');

    expect(list).toContain('status={TaskStatus.COMPLETADA}');
    expect(detail).toContain("statusAction(TaskStatus.COMPLETADA, 'Resolver')");
    expect(list).toContain('Boolean(task.evidenceRequired)');
    expect(detail).toContain('task.evidenceRequired || task.requiresIndependentValidation');
  });
});
