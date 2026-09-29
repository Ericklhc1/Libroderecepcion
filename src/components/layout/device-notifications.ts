'use client';

import type { NotificationFeedItem } from '@/domain/notifications';

export const DEVICE_NOTIFICATIONS_KEY = 'central.deviceNotifications.enabled';

export type DeviceNotificationState = 'unsupported' | NotificationPermission;

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return await navigator.serviceWorker.register('/central-notifications-sw.js', {
      scope: '/',
    });
  } catch {
    return null;
  }
}

export function getDeviceNotificationState(): {
  supported: boolean;
  permission: DeviceNotificationState;
  enabled: boolean;
} {
  if (!supported()) {
    return { supported: false, permission: 'unsupported', enabled: false };
  }
  let enabled = false;
  try {
    enabled = window.localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) === '1';
  } catch {
    enabled = false;
  }
  return {
    supported: true,
    permission: Notification.permission,
    enabled: enabled && Notification.permission === 'granted',
  };
}

export async function enableDeviceNotifications(): Promise<DeviceNotificationState> {
  if (!supported()) return 'unsupported';
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    try {
      window.localStorage.removeItem(DEVICE_NOTIFICATIONS_KEY);
    } catch {
      // Sin almacenamiento, el permiso del navegador sigue siendo la fuente.
    }
    return permission;
  }

  const worker = await registration();
  if (!worker) return 'unsupported';

  try {
    window.localStorage.setItem(DEVICE_NOTIFICATIONS_KEY, '1');
  } catch {
    // La sesión actual puede seguir mostrando avisos aunque storage esté bloqueado.
  }
  return 'granted';
}

export function disableDeviceNotifications(): void {
  try {
    window.localStorage.removeItem(DEVICE_NOTIFICATIONS_KEY);
  } catch {
    // No hace falta revocar el permiso del navegador para desactivar este canal.
  }
}

export async function showDeviceNotification(item: NotificationFeedItem): Promise<void> {
  const state = getDeviceNotificationState();
  if (!state.enabled || state.permission !== 'granted') return;

  const worker = await registration();
  if (!worker) return;

  try {
    await worker.showNotification(item.title, {
      body: item.body ?? undefined,
      tag: `central-${item.id}`,
      data: {
        url: item.link ?? '/notificaciones',
        notificationId: item.id,
      },
    });
  } catch {
    // Toast + sonido siguen siendo el fallback si el SO rechaza el aviso.
  }
}
