import {taskFollowUpReadWhere,operationalAlarmReadWhere} from './followup-access';
import 'server-only';
import {
  EntryStatus,
  EntryType,
  HandoverStatus,
  OperationalAlarmStatus,
  ShiftStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_RESOLVED_STATUSES, TASK_COMPLETED_STATUSES, metricPeriod, metricCalendarRange, incidentResolutionAt, SHARED_METRIC_SCOPE, TASK_COMPLETION_DEFINITION, INCIDENT_RESOLUTION_DEFINITION } from '@/domain/operational-metrics';
import { formatCalendarDate } from '@/lib/format';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';

// Shared operational aggregates never disclose private or supervisory sources.
const sharedReader={id:'',permissions:[]};
const sharedTasks=taskFollowUpReadWhere(sharedReader,true);

export type MetricsRange = { from: Date; to: Date };

export function defaultRange(days = 30): MetricsRange {
  return metricPeriod(days).current;
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
    openOperationalEntries,
    formalIncidentClosures,
    incidentsWithoutDate,
    tasksWithoutDate,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { AND:[sharedTasks],
        deletedAt: null,
        status: { in: TASK_COMPLETED_STATUSES },
        completedAt: { gte: range.from, lte: range.to },
      },
      select: { completedAt: true, dueAt: true, createdAt: true },
    }),
    prisma.task.count({
      where: { AND:[sharedTasks],
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
        status: { in: ENTRY_RESOLVED_STATUSES },
        OR: [{ resolvedAt: createdIn }, { resolvedAt: null, closedAt: createdIn }],
      },
      select: { occurredAt: true, resolvedAt: true, closedAt: true },
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
      where: { AND:[sharedTasks], deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
    }),
    prisma.operationalAlarm.count({ where: { AND:[operationalAlarmReadWhere(sharedReader,true)], status: OperationalAlarmStatus.ACTIVA } }),
    // La continuidad es inherente: todo registro abierto sigue vigente entre
    // turnos hasta resolverse o cerrarse. No existe una categoría separada de
    // «heredados» ni un umbral horario artificial.
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    prisma.operationalEntry.count({ where: { deletedAt: null, type: EntryType.INCIDENCIA, status: EntryStatus.CERRADO, closedAt: createdIn } }),
    prisma.operationalEntry.count({ where: { deletedAt: null, type: EntryType.INCIDENCIA, status: { in: ENTRY_RESOLVED_STATUSES }, resolvedAt: null, closedAt: null } }),
    prisma.task.count({ where: { AND: [sharedTasks], deletedAt: null, status: { in: TASK_COMPLETED_STATUSES }, completedAt: null } }),
  ]);

  const completedOnTime = tasksClosed.filter(
    (t) => !t.dueAt || (t.completedAt && t.completedAt.getTime() <= t.dueAt.getTime()),
  ).length;
  const completedLate = tasksClosed.length - completedOnTime;

  const resolutionHours = closedIncidents
    .map((i) => ({ end: incidentResolutionAt(i), start: i.occurredAt }))
    .filter((i) => i.end && i.end >= i.start)
    .map((i) => (i.end!.getTime() - i.start.getTime()) / 3600_000);
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
      where: { date: metricCalendarRange(range), status: ShiftStatus.CERRADO },
    }),
    prisma.shift.count({
      where: { date: metricCalendarRange(range), status: { not: ShiftStatus.ANULADO } },
    }),
  ]);

  return {
    range,
    scope: SHARED_METRIC_SCOPE,
    definitions: { tasks: TASK_COMPLETION_DEFINITION, incidents: INCIDENT_RESOLUTION_DEFINITION },
    tasks: {
      completed: tasksClosed.length,
      withoutCompletionDate: tasksWithoutDate,
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
      closedInRange: formalIncidentClosures,
      resolvedInRange: closedIncidents.length,
      resolutionSamples: resolutionHours.length,
      historicalClosureSamples: closedIncidents.filter((i) => !i.resolvedAt).length,
      withoutResolutionDate: incidentsWithoutDate,
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
            ? `${shift.type} ${formatCalendarDate(shift.date)}`
            : 'Sin turno',
          count: row._count._all,
          date: shift?.date ?? null,
        };
      })
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
      .slice(0, 12),
    alerts: { live: liveAlerts },
    openOperationalEntries,
  };
}

/** Indicadores del turno en curso, para la cabecera del panel. */
export async function getShiftMetrics(shiftId: string) {
  const [entries, incidents, tasksCreated, tasksCompleted] = await Promise.all([
    prisma.operationalEntry.count({ where: { shiftId, deletedAt: null } }),
    prisma.operationalEntry.count({
      where: { shiftId, deletedAt: null, type: EntryType.INCIDENCIA },
    }),
    prisma.task.count({ where: { AND:[sharedTasks], shiftId, deletedAt: null } }),
    prisma.task.count({
      where: { AND:[sharedTasks], shiftId, deletedAt: null, status: { in: TASK_COMPLETED_STATUSES } },
    }),
  ]);
  return { entries, incidents, tasksCreated, tasksCompleted };
}
