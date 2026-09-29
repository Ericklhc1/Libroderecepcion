import 'server-only';

import { after } from 'next/server';
import { dispatchWebPushForUsers } from '@/server/services/web-push';

let pendingUsers = new Set<string>();
let scheduled = false;

/**
 * Agrupa destinatarios del mismo request y despacha el push después de cerrar
 * la respuesta. Así una transacción nunca queda esperando a FCM/APNs/Mozilla.
 *
 * El cron /api/cron/web-push sigue siendo red de seguridad si el runtime no
 * permite programar el callback.
 */
export function scheduleWebPushForUsers(userIds: string[]): void {
  for (const userId of userIds) {
    if (userId) pendingUsers.add(userId);
  }
  if (pendingUsers.size === 0 || scheduled) return;
  scheduled = true;

  const run = async () => {
    const users = [...pendingUsers];
    pendingUsers = new Set<string>();
    scheduled = false;
    if (users.length === 0) return;
    try {
      await dispatchWebPushForUsers(users);
    } catch (error) {
      console.error('[web-push] despacho diferido falló', error);
    }
  };

  try {
    after(run);
  } catch {
    /*
     * Algunos contextos de servidor no tienen request scope. El cron rescatará
     * esas notificaciones; no se sacrifica la operación principal por el push.
     */
    scheduled = false;
  }
}
