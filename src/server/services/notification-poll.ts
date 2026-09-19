import 'server-only';

import { prisma } from '@/lib/prisma';
import { countLiveAlerts, runAlertEngine } from '@/server/services/alert-engine';

const ALERT_REFRESH_MS = 60_000;
let lastAlertRefresh = 0;

/**
 * Mantiene el motor de alertas fresco sin acoplar el cliente a una Server Action.
 *
 * El sondeo del navegador usa un endpoint HTTP estable. Así, una pestaña que
 * permanezca abierta durante un nuevo deployment no conserva un identificador
 * compilado de Server Action que el deployment siguiente ya no conoce.
 */
async function refreshAlertsIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastAlertRefresh < ALERT_REFRESH_MS) return;

  lastAlertRefresh = now;
  try {
    await runAlertEngine(new Date(now));
  } catch (error) {
    lastAlertRefresh = 0;
    console.error('[alertas] no se pudo refrescar el motor desde el sondeo', error);
  }
}

export async function getUnreadCountsForUser(userId: string): Promise<{
  notifications: number;
  alerts: number;
}> {
  await refreshAlertsIfDue();

  const [notifications, alerts] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    countLiveAlerts(),
  ]);

  return { notifications, alerts };
}
