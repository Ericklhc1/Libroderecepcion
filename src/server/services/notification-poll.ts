import 'server-only';

import { prisma } from '@/lib/prisma';
import { runFrontiProactiveSweep } from '@/server/ai/fronti-proactive';
import { countMyActiveOperationalAlarms } from '@/server/services/operational-alarms';

const FRONTI_PROACTIVE_REFRESH_MS = 5 * 60_000;
let lastFrontiProactiveRefresh = 0;

/**
 * El centro de notificaciones no ejecuta ni fabrica estados operativos.
 *
 * Sólo mantiene Fronti proactivo fresco con limitación temporal. Las alertas
 * programadas tienen su propio despachador y las notificaciones son avisos.
 */
async function refreshFrontiIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastFrontiProactiveRefresh < FRONTI_PROACTIVE_REFRESH_MS) return;

  lastFrontiProactiveRefresh = now;
  void runFrontiProactiveSweep({ trigger: 'notification-poll', now: new Date(now) }).catch(
    (error) => {
      lastFrontiProactiveRefresh = 0;
      console.error('[fronti-proactivo] fallo desde sondeo', error);
    },
  );
}

export async function getUnreadCountsForUser(userId: string): Promise<{
  notifications: number;
  alerts: number;
}> {
  await refreshFrontiIfDue();

  const [notifications, alerts] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    countMyActiveOperationalAlarms(userId),
  ]);

  return { notifications, alerts };
}
