'use client';

import type { NotificationFeedItem } from '@/domain/notifications';

export const DEVICE_NOTIFICATIONS_KEY = 'central.deviceNotifications.enabled';

export type DeviceNotificationState =
  | 'unsupported'
  | 'requires-install'
  | NotificationPermission;

function isIosFamily(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function capability(): 'supported' | 'requires-install' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIosFamily() && !isStandaloneDisplay()) return 'requires-install';
  return 'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
    ? 'supported'
    : 'unsupported';
}

function supported(): boolean {
  return capability() === 'supported';
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return buffer;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    await navigator.serviceWorker.register('/central-notifications-sw.js', {
      scope: '/',
    });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

async function registerServerSubscription(
  subscription: PushSubscription,
): Promise<boolean> {
  try {
    const response = await fetch('/api/push/subscriptions', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensurePushSubscription(
  worker: ServiceWorkerRegistration,
): Promise<boolean> {
  let subscription = await worker.pushManager.getSubscription();

  if (!subscription) {
    const keyResponse = await fetch('/api/push/public-key', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!keyResponse.ok) return false;

    const payload = (await keyResponse.json()) as { publicKey?: string };
    if (!payload.publicKey) return false;

    subscription = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(payload.publicKey),
    });
  }

  return registerServerSubscription(subscription);
}

export function getDeviceNotificationState(): {
  supported: boolean;
  permission: DeviceNotificationState;
  enabled: boolean;
} {
  const state = capability();
  if (state !== 'supported') {
    return { supported: false, permission: state, enabled: false };
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
  const state = capability();
  if (state !== 'supported') return state;
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    try {
      window.localStorage.removeItem(DEVICE_NOTIFICATIONS_KEY);
    } catch {
      // El permiso del navegador sigue siendo la fuente de verdad.
    }
    return permission;
  }

  const worker = await registration();
  if (!worker) return 'unsupported';

  try {
    const subscribed = await ensurePushSubscription(worker);
    if (!subscribed) return 'default';

    window.localStorage.setItem(DEVICE_NOTIFICATIONS_KEY, '1');
  } catch {
    return 'default';
  }
  return 'granted';
}

/**
 * Repara silenciosamente una suscripción ya autorizada. Es útil después de
 * actualizaciones del navegador o rotaciones internas del Push Service.
 */
export async function reconcileDeviceNotifications(): Promise<boolean> {
  const state = getDeviceNotificationState();
  if (!state.enabled || state.permission !== 'granted') return false;
  const worker = await registration();
  if (!worker) return false;
  try {
    return await ensurePushSubscription(worker);
  } catch {
    return false;
  }
}

export async function disableDeviceNotifications(): Promise<void> {
  try {
    const worker = await registration();
    const subscription = worker ? await worker.pushManager.getSubscription() : null;
    if (subscription) {
      await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
      await subscription.unsubscribe().catch(() => false);
    }
  } finally {
    try {
      window.localStorage.removeItem(DEVICE_NOTIFICATIONS_KEY);
    } catch {
      // La suscripción del navegador ya es la parte importante.
    }
  }
}

/**
 * Fallback mientras la pestaña todavía está viva. El canal principal es Web
 * Push servidor→Push Service→service worker, que también funciona con AROH
 * cerrado. Usar el mismo tag evita duplicar visualmente ambos caminos.
 */
export async function showDeviceNotification(item: NotificationFeedItem): Promise<void> {
  const state = getDeviceNotificationState();
  if (!state.enabled || state.permission !== 'granted') return;

  const worker = await registration();
  if (!worker) return;

  try {
    await worker.showNotification(item.title, {
      body: item.body ?? undefined,
      tag: `aroh-${item.id}`,
      data: {
        url: item.link ?? '/notificaciones',
        notificationId: item.id,
      },
    });
  } catch {
    // Toast + sonido siguen siendo el último fallback.
  }
}


export async function syncDeviceNotificationState(input: {
  unread: number;
  readIds?: string[];
  clearAll?: boolean;
}): Promise<void> {
  if (typeof navigator === 'undefined') return;

  const unread = Math.max(0, Number.isFinite(input.unread) ? Math.trunc(input.unread) : 0);

  try {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (value?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unread > 0 && typeof badgeNavigator.setAppBadge === 'function') {
      await badgeNavigator.setAppBadge(unread);
    } else if (unread === 0 && typeof badgeNavigator.clearAppBadge === 'function') {
      await badgeNavigator.clearAppBadge();
    }
  } catch {
    // El badge del launcher no es fuente de verdad.
  }

  if (!('serviceWorker' in navigator)) return;

  try {
    const worker = await navigator.serviceWorker.ready;
    const target =
      navigator.serviceWorker.controller ??
      worker.active ??
      worker.waiting ??
      worker.installing;
    target?.postMessage({
      type: 'AROH_NOTIFICATION_STATE',
      unread,
      readIds: input.readIds ?? [],
      clearAll: Boolean(input.clearAll),
    });
  } catch {
    // El próximo snapshot volverá a reconciliarlo.
  }
}

export async function testDevicePush(): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch('/api/push/test', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return {
      ok: response.ok,
      message: response.ok
        ? 'Prueba enviada. Debe aparecer como notificación del sistema.'
        : payload.error ?? 'No se pudo enviar la prueba push.',
    };
  } catch {
    return { ok: false, message: 'No se pudo contactar el servicio push.' };
  }
}
