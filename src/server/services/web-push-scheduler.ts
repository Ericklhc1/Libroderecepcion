import 'server-only';

import { after } from 'next/server';
import { dispatchWebPushForUsers } from '@/server/services/web-push';

/** Request-owned callback: another request must never consume these recipients. */
export function scheduleWebPushForUsers(userIds: string[]): void {
  const users = [...new Set(userIds.filter(Boolean))];
  if (!users.length) return;
  try {
    after(async () => {
      try {
        await dispatchWebPushForUsers(users);
      } catch (error) {
        console.error('[web-push] despacho diferido falló', error);
      }
    });
  } catch {
    // Outside request scope the existing cron retries persisted notifications.
  }
}
