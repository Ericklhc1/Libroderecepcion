import 'server-only';
import {
  EntryStatus,
  EntryType,
  HandoverStatus,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { LIVE_ALERT_WHERE } from './alert-engine';

export type MetricsRange = { from: Date; to: Date };

export function defaultRange(days = 30): MetricsRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600_000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

/**
 * Indicadores operativos. Se limitan a lo que permite tomar decisiones en el
 * día a día: cumplimiento, carga heredada y tiempos de resolución.
 */
export async function getMetrics(range: MetricsRange) {
  const now = new Date();
  const createdIn = { gte: range.from, lte: range.to };

  const [
    tasksClosed,
    tasksOverdue,
    openIncidents,
    closedIncidents,
    handoversSent,
    handoversReceived,
    entriesByShift,
    incidentsByDepartment,
    openTasks,
    liveAlerts,
    inheritedPendings,
  ] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: TaskStatus.COMPLETADA,
        completedAt: { gte: range.from, lte: range.to },
      },
      select: { completedAt: true, dueAt: true, createdAt: true },
    }),
    prisma.task.count({
      where: {
        deletedAt: null,
        status: { in: TASK_OPEN_STATUSES },
        dueAt: { lt: now },
      },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: [EntryStatus.CERRADO, EntryStatus.RESUELTO] },
        closedAt: { gte: range.from, lte: range.to },
      },
      select: { occurredAt: true, closedAt: true },
    }),
    prisma.shiftHandover.count({
      where: { issuedAt: createdIn, status: { in: [HandoverStatus.ENVIADA, HandoverStatus.RECIBIDA] } },
    }),
    prisma.shiftHandover.count({
      where: { issuedAt: createdIn, status: HandoverStatus.RECIBIDA },
    }),
    prisma.operationalEntry.groupBy({
      by: ['shiftId'],
      where: { deletedAt: null, occurredAt: createdIn },
      _count: { _all: true },
    }),
    prisma.operationalEntry.groupBy({
      by: ['departmentId'],
      where: { deletedAt: null, type: EntryType.INCIDENCIA, occurredAt: createdIn },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.alert.count({ where: LIVE_ALERT_WHERE(now) }),
    // Pendientes heredados: abiertos creados en un turno anterior al actual.
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        occurredAt: { lt: new Date(now.getTime() - 8 * 3600_000) },
      },
    }),
  ]);

  const completedOnTime = tasksClosed.filter(
    (t) => !t.dueAt || (t.completedAt && t.completedAt.getTime() <= t.dueAt.getTime()),
  ).length;
  const completedLate = tasksClosed.length - completedOnTime;

  const resolutionHours = closedIncidents
    .filter((i) => i.closedAt)
    .map((i) => (i.closedAt!.getTime() - i.occurredAt.getTime()) / 3600_000);
  const avgResolutionHours =
    resolutionHours.length > 0
      ? resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length
      : null;

  const shiftIds = entriesByShift
    .map((row) => row.shiftId)
    .filter((id): id is string => id !== null);
  const shifts = shiftIds.length
    ? await prisma.shift.findMany({
        where: { id: { in: shiftIds } },
        select: { id: true, type: true, date: true },
      })
    : [];
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const departmentIds = incidentsByDepartment
    .map((row) => row.departmentId)
    .filter((id): id is string => id !== null);
  const departments = departmentIds.length
    ? await prisma.department.findMany({
        where: { id: { in: departmentIds } },
        select: { id: true, name: true },
      })
    : [];
  const departmentById = new Map(departments.map((d) => [d.id, d.name]));

  const [shiftsClosed, shiftsTotal] = await Promise.all([
    prisma.shift.count({
      where: { date: { gte: range.from, lte: range.to }, status: ShiftStatus.CERRADO },
    }),
    prisma.shift.count({
      where: { date: { gte: range.from, lte: range.to }, status: { not: ShiftStatus.ANULADO } },
    }),
  ]);

  return {
    range,
    tasks: {
      completed: tasksClosed.length,
      completedOnTime,
      completedLate,
      onTimeRate:
        tasksClosed.length > 0
          ? Math.round((completedOnTime / tasksClosed.length) * 100)
          : null,
      overdue: tasksOverdue,
      open: openTasks,
    },
    incidents: {
      open: openIncidents,
      closedInRange: closedIncidents.length,
      avgResolutionHours,
      byDepartment: incidentsByDepartment
        .map((row) => ({
          department: row.departmentId
            ? (departmentById.get(row.departmentId) ?? 'Sin área')
            : 'Sin área',
          count: row._count._all,
        }))
        .sort((a, b) => b.count - a.count),
    },
    handovers: {
      sent: handoversSent,
      received: handoversReceived,
      complianceRate:
        handoversSent > 0 ? Math.round((handoversReceived / handoversSent) * 100) : null,
    },
    shifts: {
      closed: shiftsClosed,
      total: shiftsTotal,
      closureRate: shiftsTotal > 0 ? Math.round((shiftsClosed / shiftsTotal) * 100) : null,
    },
    volumeByShift: entriesByShift
      .map((row) => {
        const shift = row.shiftId ? shiftById.get(row.shiftId) : null;
        return {
          label: shift
            ? `${shift.type} ${shift.date.toLocaleDateString('es-CL')}`
            : 'Sin turno',
          count: row._count._all,
          date: shift?.date ?? null,
        };
      })
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      .slice(0, 12),
    alerts: { live: liveAlerts },
    inheritedPendings,
  };
}

/** Indicadores del turno en curso, para la cabecera del panel. */
export async function getShiftMetrics(shiftId: string) {
  const [entries, incidents, tasksCreated, tasksCompleted] = await Promise.all([
    prisma.operationalEntry.count({ where: { shiftId, deletedAt: null } }),
    prisma.operationalEntry.count({
      where: { shiftId, deletedAt: null, type: EntryType.INCIDENCIA },
    }),
    prisma.task.count({ where: { shiftId, deletedAt: null } }),
    prisma.task.count({
      where: { shiftId, deletedAt: null, status: TaskStatus.COMPLETADA },
    }),
  ]);
  return { entries, incidents, tasksCreated, tasksCompleted };
}
