import { requireUser } from '@/server/auth/guard';
import {
  getChatGlobalVersion,
  touchChatPresence,
} from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHECK_MS = 1_500;
const HEARTBEAT_MS = 15_000;
const PRESENCE_TOUCH_MS = 45_000;
const STREAM_LIFETIME_MS = 4 * 60_000;

/**
 * Stream global del IM.
 *
 * Un único EventSource por usuario mantiene conversaciones, no leídos y
 * presencia sincronizados. El navegador sólo vuelve a pedir el contenido
 * completo cuando esta firma cambia; el stream no transporta historiales.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
    await touchChatPresence(user);
  } catch {
    return new Response('Sesión no disponible.', { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let checking = false;
  let lastVersion = '';
  let checkTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (checkTimer) clearInterval(checkTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (presenceTimer) clearInterval(presenceTimer);
        if (lifetimeTimer) clearTimeout(lifetimeTimer);
        if (abortHandler) request.signal.removeEventListener('abort', abortHandler);
      };

      const close = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          // El navegador pudo cerrar antes.
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
          const version = await getChatGlobalVersion(user);
          if (version !== lastVersion) {
            lastVersion = version;
            send('chat-change', { version, at: new Date().toISOString() });
          }
        } catch {
          send('stream-warning', { retrying: true });
        } finally {
          checking = false;
        }
      };

      abortHandler = close;
      request.signal.addEventListener('abort', abortHandler, { once: true });

      void check();

      checkTimer = setInterval(() => void check(), CHECK_MS);
      presenceTimer = setInterval(() => void touchChatPresence(user), PRESENCE_TOUCH_MS);
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          close();
        }
      }, HEARTBEAT_MS);
      lifetimeTimer = setTimeout(close, STREAM_LIFETIME_MS);
    },
    cancel() {
      closed = true;
      if (checkTimer) clearInterval(checkTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (presenceTimer) clearInterval(presenceTimer);
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
