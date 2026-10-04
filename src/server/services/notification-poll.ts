import 'server-only';

import { prisma } from '@/lib/prisma';
import { notificationWhereForUser } from './notification-access';
import { scheduleFrontiProactiveSweep } from '@/server/ai/fronti-proactive-scheduler';
import { countMyActiveOperationalAlarms } from '@/server/services/operational-alarms';

const FRONTI_PROACTIVE_REFRESH_MS = 5 * 60_000;
let lastFrontiProactiveRefresh = 0;

/**
 * El centro de notificaciones no ejecuta ni fabrica estados operativos.
 *
 * Sólo mantiene Fronti proactivo fresco con limitación temporal. Las alertas
 * programadas tienen su propio despachador y las notificaciones son avisos.
 */
function refreshFrontiIfDue(): void {
  const now = Date.now();
  if (now - lastFrontiProactiveRefresh < FRONTI_PROACTIVE_REFRESH_MS) return;

  lastFrontiProactiveRefresh = now;
  scheduleFrontiProactiveSweep('notification-poll');
}

export async function getUnreadCountsForUser(userId: string): Promise<{
  notifications: number;
  alerts: number;
}> {
  refreshFrontiIfDue();
  const visible = await notificationWhereForUser(userId);

  const [notifications, alerts] = await Promise.all([
    prisma.notification.count({ where: { ...visible, readAt: null } }),
    countMyActiveOperationalAlarms(userId),
  ]);

  return { notifications, alerts };
}
