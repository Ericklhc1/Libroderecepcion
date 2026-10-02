import { visibleHandoverItems, followUpReadWhere } from '@/server/services/followup-access';
import 'server-only';
import {
  AlertLevel,
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  Priority,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import type { CurrentUser } from '@/server/auth/current-user';
import { runAlertEngine } from './alert-engine';
import {
  getCurrentShift,
  getMyOpenShift,
  getPendingHandover,
  resolveOperationalBusinessDate,
} from './shifts';
import { getShiftMetrics } from './metrics';
import { ROLE_KEYS, isReceptionDeskRole } from '@/lib/permissions';
import { buildOperationalAttention } from '@/domain/operational-attention';
import { countMyActiveOperationalAlarms } from './operational-alarms';

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
  const businessDate = myShift?.date ?? await resolveOperationalBusinessDate(now);
  const receptionEntriesOnly = isReceptionDeskRole(user.roleKey);

  const [
    incoming,
    criticalEntries,
    overdueTasks,
    myTasks,
    followUps,
    blockingOutgoing,
  ] = await Promise.all([
    getPendingHandover(myShift?.id ?? null),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        ...(receptionEntriesOnly
          ? {
              type: { in: [EntryType.NOVEDAD, EntryType.INCIDENCIA] },
              createdBy: { role: { key: { in: [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.NIGHT_AUDITOR] } } },
            }
          : {}),
        OR: [
          { priority: { in: [Priority.CRITICA, Priority.ALTA] } },
          { dueAt: { lt: now } },
        ],
      },
      select: {
        id: true,
        humanId: true,
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
    prisma.followUp.findMany({
      where: { AND: [followUpReadWhere(user)],
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
    prisma.shift.findFirst({
      where: {
        archivedAt: null,
        status: {
          in: [
            ShiftStatus.INICIADO,
            ShiftStatus.ACTIVO,
            ShiftStatus.PREPARANDO_ENTREGA,
            ShiftStatus.ENTREGA_ENVIADA,
          ],
        },
        assignments: {
          some: {
            activatedAt: { not: null },
            leftAt: null,
          },
        },
      },
      select: { id: true, status: true },
      orderBy: { actualStart: 'asc' },
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
  ] = await Promise.all([
    // El «turno siguiente» ya no se deduce por adyacencia: es el que esté
    // en curso, que puede ser el propio o ninguno.
    getCurrentShift(),
    myShift ? getShiftMetrics(myShift.id) : null,
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        ...(receptionEntriesOnly
          ? {
              type: { in: [EntryType.NOVEDAD, EntryType.INCIDENCIA] },
              createdBy: { role: { key: ROLE_KEYS.RECEPTIONIST } },
            }
          : {}),
      },
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
        ...(receptionEntriesOnly
          ? { createdBy: { role: { key: { in: [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.NIGHT_AUDITOR] } } } }
          : {}),
      },
    }),
    countMyActiveOperationalAlarms(user),
  ]);

  const roomsNeedingAction: [] = [];
  // Compatibilidad del contrato del dashboard: las Alert legadas ya no se
  // proyectan en Inicio, pero el campo conserva su tipo para consumidores
  // existentes mientras migran a OperationalAlarm.
  const alerts: Array<{
    id: string;
    level: AlertLevel;
    title: string;
    message: string | null;
  }> = [];

  const counters = {
    openEntries,
    openTasks,
    openIncidents,
    liveAlerts,
    criticalAlerts: 0,
    roomsNeedingAction: roomsNeedingAction.length,
  };

  if (incoming) incoming.items = await visibleHandoverItems(user, incoming.items);
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
      humanId: entry.humanId,
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
    blockingOutgoing,
    roomsNeedingAction,
    attention,
    counters,
    today: businessDate,
  };
}

export const DASHBOARD_ENUMS = {
  EntryStatus,
  TaskStatus,
  AlertStatus,
  ShiftStatus,
};
