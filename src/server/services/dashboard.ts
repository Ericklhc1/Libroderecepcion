import 'server-only';
import {
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  HandoverStatus,
  Priority,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import type { CurrentUser } from '@/server/auth/current-user';
import { LIVE_ALERT_WHERE, runAlertEngine } from './alert-engine';
import {
  getIncomingHandover,
  getMyOpenShift,
  getNextShift,
  getStartableShifts,
  operationalDate,
} from './shifts';
import { getShiftMetrics } from './metrics';

let lastEngineRun = 0;
const ENGINE_THROTTLE_MS = 60_000;

/**
 * El motor de alertas se ejecuta al abrir el panel, con un límite de una vez
 * por minuto por instancia: mantiene las alertas al día sin necesidad de un
 * proceso programado externo en la primera versión.
 */
export async function refreshAlertsThrottled(): Promise<void> {
  const now = Date.now();
  if (now - lastEngineRun < ENGINE_THROTTLE_MS) return;
  lastEngineRun = now;
  try {
    await runAlertEngine();
  } catch (error) {
    console.error('[alertas] el motor falló', error);
  }
}

export async function getDashboardData(user: CurrentUser) {
  await refreshAlertsThrottled();

  const now = new Date();
  const myShift = await getMyOpenShift(user.id);

  const [
    startableShifts,
    incoming,
    criticalEntries,
    overdueTasks,
    myTasks,
    openIncidents,
    alerts,
    followUps,
    latestEntries,
    lastReceivedHandover,
  ] = await Promise.all([
    myShift ? Promise.resolve([]) : getStartableShifts(user.id),
    myShift ? getIncomingHandover(myShift) : Promise.resolve(null),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        OR: [
          { priority: { in: [Priority.CRITICA, Priority.ALTA] } },
          { dueAt: { lt: now } },
        ],
      },
      include: {
        owner: { select: { id: true, name: true } },
        department: { select: { name: true } },
        guest: { select: { fullName: true, roomNumber: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES }, dueAt: { lt: now } },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 8,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES } },
      include: {
        entry: { select: { id: true, seq: true } },
        _count: { select: { checklist: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 8,
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
      include: {
        owner: { select: { id: true, name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      take: 6,
    }),
    prisma.alert.findMany({
      where: LIVE_ALERT_WHERE(now),
      include: {
        entry: { select: { id: true, seq: true } },
        task: { select: { id: true } },
        reservation: { select: { code: true } },
      },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 8,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
      },
      include: {
        owner: { select: { id: true, name: true } },
        entry: { select: { id: true, seq: true, title: true } },
      },
      orderBy: [{ scheduledAt: 'asc' }],
      take: 6,
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null },
      include: {
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 6,
    }),
    // Última entrega que recibió el turno en curso (o el usuario).
    prisma.shiftHandover.findFirst({
      where: {
        status: HandoverStatus.RECIBIDA,
        ...(myShift ? { toShiftId: myShift.id } : { receivedById: user.id }),
      },
      include: {
        issuedBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
        fromShift: { select: { type: true, date: true } },
        items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
      },
      orderBy: { receivedAt: 'desc' },
    }),
  ]);

  const nextShift = myShift ? await getNextShift(myShift) : null;
  const shiftMetrics = myShift ? await getShiftMetrics(myShift.id) : null;

  const counters = {
    openEntries: await prisma.operationalEntry.count({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
    }),
    openTasks: await prisma.task.count({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    liveAlerts: await prisma.alert.count({ where: LIVE_ALERT_WHERE(now) }),
    criticalAlerts: await prisma.alert.count({
      where: { ...LIVE_ALERT_WHERE(now), level: 'CRITICA' },
    }),
  };

  return {
    now,
    myShift,
    startableShifts,
    incoming,
    nextShift,
    shiftMetrics,
    criticalEntries,
    overdueTasks,
    myTasks,
    openIncidents,
    alerts,
    followUps,
    latestEntries,
    lastReceivedHandover,
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
