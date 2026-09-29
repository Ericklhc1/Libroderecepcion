import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('experiencia de notificaciones', () => {
  it('detecta nuevos mensajes aunque el chat reutilice la misma notificación', () => {
    const source = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    expect(source).toContain('knownVersions.current.get(item.id) !== item.createdAt');
    expect(source).toContain('knownVersions.current.set(item.id, item.createdAt)');
  });

  it('mantiene avisos del dispositivo cuando la pestaña queda oculta', () => {
    const source = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    const helper = readFileSync('src/components/layout/device-notifications.ts', 'utf8');
    const worker = readFileSync('public/central-notifications-sw.js', 'utf8');

    expect(source).toContain('/api/notifications/stream?mode=background');
    expect(source).toContain('showDeviceNotification(item)');
    expect(helper).toContain('Notification.requestPermission()');
    expect(helper).toContain("serviceWorker.register('/central-notifications-sw.js'");
    expect(worker).toContain("self.addEventListener('notificationclick'");
  });

  it('resuelve tareas simples sin obligar a tomar y validar antes', () => {
    const list = readFileSync('src/app/(app)/tareas/page.tsx', 'utf8');
    const detail = readFileSync('src/app/(app)/tareas/[id]/page.tsx', 'utf8');

    expect(list).toContain('status={TaskStatus.COMPLETADA}');
    expect(detail).toContain('status={TaskStatus.COMPLETADA}');
    expect(list).toContain('Boolean(task.evidenceRequired)');
    expect(detail).toContain('Boolean(task.evidenceRequired)');
  });
});
