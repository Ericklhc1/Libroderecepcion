import 'server-only';
import {
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  type Prisma,
  Priority,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import type { CurrentUser } from '@/server/auth/current-user';
import { LIVE_ALERT_WHERE, runAlertEngine } from './alert-engine';
import {
  getCurrentShift,
  getMyOpenShift,
  getPendingHandover,
  operationalDate,
} from './shifts';
import { getShiftMetrics } from './metrics';
import { ROLE_KEYS } from '@/lib/permissions';
import { getSettingNumber } from './settings';
import { buildOperationalAttention } from '@/domain/operational-attention';

let lastEngineRun = 0;
const ENGINE_THROTTLE_MS = 60_000;

/**
 * Mantiene las alertas al día sin un proceso programado externo.
 *
 * El motor son 18 consultas. Ejecutarlo dentro del render dejaba esas 18
 * esperas delante de la primera pantalla que ve el recepcionista, y con la
 * base en otra región eso se siente. `after()` corre el motor **después** de
 * enviar la respuesta: la pantalla sale con los datos que ya hay y el motor
 * deja las alertas listas para la siguiente carga.
 *
 * El límite de una vez por minuto por instancia se mantiene: evita que cada
 * navegación lo dispare.
 */
export function refreshAlertsInBackground(): void {
  const now = Date.now();
  if (now - lastEngineRun < ENGINE_THROTTLE_MS) return;
  lastEngineRun = now;
  try {
    after(async () => {
      try {
        await runAlertEngine();
      } catch (error) {
        console.error('[alertas] el motor falló', error);
      }
    });
  } catch (error) {
    /*
      `after` sólo existe dentro de una petición: si a este servicio lo llama
      un script o una prueba, lanza. El motor es frescura, no corrección, así
      que no puede tumbar la pantalla. Se deja el turno libre para que la
      siguiente petición real lo vuelva a intentar.
    */
    lastEngineRun = 0;
    console.warn('[alertas] el motor no se pudo programar en segundo plano', error);
  }
}

export async function getDashboardData(user: CurrentUser) {
  refreshAlertsInBackground();

  const now = new Date();
  const myShift = await getMyOpenShift(user.id);
  const alertDashboardLimit = Math.max(
    1,
    Math.min(50, Math.trunc(await getSettingNumber('alerts.dashboardLimit', 10))),
  );
  const canValidateClosure =
    user.roleKey === ROLE_KEYS.SUPERVISOR || user.isSystemAdmin;
  const visibleAlertWhere: Prisma.AlertWhereInput = canValidateClosure
    ? LIVE_ALERT_WHERE(now)
    : {
        AND: [
          LIVE_ALERT_WHERE(now),
          { NOT: { dedupeKey: { startsWith: 'shift-validation:' } } },
        ],
      };

  const [
    incoming,
    criticalEntries,
    overdueTasks,
    myTasks,
    alerts,
    followUps,
  ] = await Promise.all([
    getPendingHandover(myShift?.id ?? null),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        OR: [
          { priority: { in: [Priority.CRITICA, Priority.ALTA] } },
          { dueAt: { lt: now } },
        ],
      },
      select: {
        id: true,
        seq: true,
        title: true,
        priority: true,
        dueAt: true,
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES }, dueAt: { lt: now } },
      select: { id: true, title: true, priority: true },
      orderBy: { dueAt: 'asc' },
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      select: { id: true, dueAt: true },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 8,
    }),
    prisma.alert.findMany({
      where: visibleAlertWhere,
      select: {
        id: true,
        level: true,
        title: true,
        message: true,
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: alertDashboardLimit,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
      },
      select: {
        id: true,
        action: true,
        status: true,
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: 6,
    }),
  ]);

  /*
    Los contadores y el resumen del turno no dependen entre sí. Encadenarlos
    con `await` sucesivos costaba viajes a la base uno detrás de otro, que es
    lo que se percibía como demora al abrir Inicio tras cada acción.
  */
  const [
    nextShift,
    shiftMetrics,
    openEntries,
    openTasks,
    openIncidents,
    liveAlerts,
    criticalAlerts,
  ] = await Promise.all([
    // El «turno siguiente» ya no se deduce por adyacencia: es el que esté
    // en curso, que puede ser el propio o ninguno.
    getCurrentShift(),
    myShift ? getShiftMetrics(myShift.id) : null,
    prisma.operationalEntry.count({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    prisma.alert.count({ where: visibleAlertWhere }),
    prisma.alert.count({ where: { AND: [visibleAlertWhere, { level: 'CRITICA' }] } }),
  ]);

  const roomsNeedingAction: [] = [];

  const counters = {
    openEntries,
    openTasks,
    openIncidents,
    liveAlerts,
    criticalAlerts,
    roomsNeedingAction: roomsNeedingAction.length,
  };

  const attention = buildOperationalAttention({
    rooms: [],
    alerts: alerts.map((alert) => ({
      id: alert.id,
      level: alert.level,
      title: alert.title,
      message: alert.message,
    })),
    overdueTasks: overdueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
    })),
    criticalEntries: criticalEntries.map((entry) => ({
      id: entry.id,
      seq: entry.seq,
      title: entry.title,
      priority: entry.priority,
      overdue: Boolean(entry.dueAt && entry.dueAt < now),
    })),
    followUps: followUps.map((followUp) => ({
      id: followUp.id,
      action: followUp.action,
      status: followUp.status,
    })),
  });

  return {
    now,
    myShift,
    incoming,
    nextShift,
    shiftMetrics,
    criticalEntries,
    overdueTasks,
    myTasks,
    alerts,
    followUps,
    roomsNeedingAction,
    attention,
    counters,
    today: operationalDate(now),
  };
}

export const DASHBOARD_ENUMS = {
  EntryStatus,
  TaskStatus,
  AlertStatus,
  ShiftStatus,
};
