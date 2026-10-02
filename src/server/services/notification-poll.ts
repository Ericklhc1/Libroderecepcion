import { followUpNotificationVisibility, type FollowUpReader } from './followup-access';
import 'server-only';

import { prisma } from '@/lib/prisma';
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

export async function getUnreadCountsForUser(user: FollowUpReader): Promise<{
  notifications: number;
  alerts: number;
}> {
  const userId = user.id;
  const visibility = await followUpNotificationVisibility(user);
  refreshFrontiIfDue();

  const [notifications, alerts] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null, AND: [visibility] } }),
    countMyActiveOperationalAlarms(user),
  ]);

  return { notifications, alerts };
}
