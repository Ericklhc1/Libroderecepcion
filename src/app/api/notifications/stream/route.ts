import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import type { NotificationFeedSnapshot } from '@/domain/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Near-realtime sin una plataforma adicional:
 *
 * el navegador mantiene un único EventSource abierto y el servidor transmite
 * sólo cuando cambia el snapshot. La consulta interna es corta y frecuente,
 * pero el cliente no recarga, no navega y no mantiene polling HTTP propio.
 *
 * El stream se recicla antes del límite de la función; EventSource reconecta
 * solo y conserva la experiencia continua.
 */
const CHECK_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const STREAM_LIFETIME_MS = 4 * 60_000;

function signature(snapshot: NotificationFeedSnapshot): string {
  return [
    snapshot.unread,
    ...snapshot.blockingAnnouncementIds.map((id) => `announcement:${id}`),
    ...snapshot.items.map(
      (item) => `${item.id}:${item.readAt ?? 'unread'}:${item.createdAt}`,
    ),
  ].join('|');
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return new Response('Sesión vencida.', { status: 401 });
  }

  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return new Response('Debes aceptar los términos vigentes.', { status: 403 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let checking = false;
  let lastSignature = '';
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (checkTimer) clearInterval(checkTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        if (abortHandler) request.signal.removeEventListener('abort', abortHandler);
      };

      const close = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          // El navegador puede haber cerrado primero. No hay nada que reparar.
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          close();
        }
      };

      const check = async () => {
        if (closed || checking) return;
        checking = true;
        try {
          const snapshot = await getNotificationFeedForUser(user.id);
          const nextSignature = signature(snapshot);
          if (nextSignature !== lastSignature) {
            lastSignature = nextSignature;
            send('notifications', snapshot);
          }
        } catch (error) {
          console.error('[notificaciones-stream] no se pudo actualizar el snapshot', error);
          send('stream-warning', { retrying: true });
        } finally {
          checking = false;
        }
      };

      abortHandler = close;
      request.signal.addEventListener('abort', abortHandler, { once: true });

      // Primer estado inmediatamente; después sólo se transmiten cambios.
      void check();

      checkTimer = setInterval(() => void check(), CHECK_MS);
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);

      // EventSource vuelve a conectar automáticamente.
      lifetimeTimer = setTimeout(close, STREAM_LIFETIME_MS);
    },
    cancel() {
      closed = true;
      if (checkTimer) clearInterval(checkTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      if (abortHandler) request.signal.removeEventListener('abort', abortHandler);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
