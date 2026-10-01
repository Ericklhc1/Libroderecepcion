import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('push del chat en el dispositivo', () => {
  it('vuelve a avisar ante dos mensajes con la misma notificación y conserva el enlace', async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const show = vi.fn();
    const payload = { unread: 2, items: [{ id: 'same-conversation', type: 'CHAT_MENSAJE', title: 'Erick', body: 'Mensaje nuevo', link: '/?chat=conversation' }] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const self = {
      addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; },
      registration: { pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) }, showNotification: show },
      navigator: { setAppBadge: vi.fn() },
    };
    runInNewContext(readFileSync('public/central-notifications-sw.js', 'utf8'), { self, fetch, URL });
    for (let index = 0; index < 2; index++) {
      let pending: Promise<void> | undefined;
      handlers.push!({ waitUntil: (promise: Promise<void>) => { pending = promise; } });
      await pending;
    }
    expect(show).toHaveBeenCalledTimes(2);
    expect(show.mock.calls[1]?.[1]).toMatchObject({ renotify: true, data: { url: '/?chat=conversation' } });
  });
});
