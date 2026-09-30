const URGENT_TYPES = new Set([
  'INCIDENCIA_CRITICA',
  'TAREA_VENCIDA',
  'ACCION_REQUERIDA',
  'ALARMA',
]);

async function fetchPushPayload() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return null;

  const response = await fetch('/api/push/payload', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  if (!response.ok) return null;
  return response.json();
}

async function updateAppBadge(unread) {
  const count = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
  if (!self.navigator) return;

  try {
    if (count > 0 && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(count);
    } else if (count === 0 && typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge();
    } else if (count === 0 && typeof self.navigator.setAppBadge === 'function') {
      await self.navigator.setAppBadge(0);
    }
  } catch {
    // El badge es adicional; nunca bloquea la notificación.
  }
}

async function showPushPayload() {
  const payload = await fetchPushPayload();
  if (!payload) return;

  await updateAppBadge(payload.unread);

  if (!Array.isArray(payload.items) || payload.items.length === 0) return;

  for (const item of payload.items) {
    const urgent = URGENT_TYPES.has(item.type);
    await self.registration.showNotification(item.title, {
      body: item.body || undefined,
      tag: `aroh-${item.id}`,
      renotify: urgent,
      requireInteraction: urgent,
      data: {
        url: item.link || '/notificaciones',
        notificationId: item.id,
      },
    });
  }

}

async function renewSubscription() {
  try {
    const keyResponse = await fetch('/api/push/public-key', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!keyResponse.ok) return;
    const payload = await keyResponse.json();
    if (!payload.publicKey) return;

    const padding = '='.repeat((4 - (payload.publicKey.length % 4)) % 4);
    const base64 = (payload.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const key = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) key[index] = raw.charCodeAt(index);

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });

    await fetch('/api/push/subscriptions', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
      }),
    });
  } catch {
    // La app abierta reconciliará nuevamente la suscripción.
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'aroh:sync-badge') return;
  event.waitUntil(updateAppBadge(Number(data.unread)));
});

self.addEventListener('push', (event) => {
  event.waitUntil(showPushPayload());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renewSubscription());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target =
    event.notification && event.notification.data && event.notification.data.url
      ? String(event.notification.data.url)
      : '/notificaciones';

  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => client.url.startsWith(self.location.origin));
        if (existing) {
          if ('navigate' in existing) {
            return existing.navigate(absolute).then(() => existing.focus());
          }
          return existing.focus();
        }
        return self.clients.openWindow(absolute);
      }),
  );
});
