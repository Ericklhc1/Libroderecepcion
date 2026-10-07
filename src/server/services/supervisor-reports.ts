import {taskFollowUpReadWhere,alertReadWhere} from './followup-access';
import 'server-only';

import { AlertStatus, EntryStatus, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { addHotelCalendarDays, hotelDateKey, hotelWallDateTime } from '@/domain/time';
import { listGymPasses } from './gym-pass';

import {entryReadWhere,type EntryReader} from './entry-visibility';

export type SupervisorReportType = 'gimnasio' | 'multas' | 'estado';

export type SupervisorReport = {
  type: SupervisorReportType;
  title: string;
  filename: string;
  from: Date;
  to: Date;
  total: number;
  summary: string[];
  lines: string[];
};

const OPEN_ENTRY_STATUSES = new Set<EntryStatus>([
  EntryStatus.ABIERTO,
  EntryStatus.EN_CURSO,
  EntryStatus.EN_ESPERA,
]);
const OPEN_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.PENDIENTE,
  TaskStatus.EN_CURSO,
  TaskStatus.BLOQUEADA,
]);

function dateKey(date: Date) {
  return hotelDateKey(date);
}

function when(date: Date) {
  return formatDateTime(date);
}

export function reportDateRange(fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date } {
  const today = dateKey(new Date());
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw ?? '') ? fromRaw! : today;
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(toRaw ?? '') ? toRaw! : fromKey;
  const startKey = fromKey <= toKey ? fromKey : toKey;
  const endKey = fromKey <= toKey ? toKey : fromKey;
  const from = hotelWallDateTime(startKey, 0);
  const endStart = hotelWallDateTime(endKey, 0);
  const to = new Date(addHotelCalendarDays(endStart, 1).getTime() - 1);
  return { from, to };
}

export async function buildSupervisorReport(
  user: EntryReader,
  type: SupervisorReportType,
  range: { from: Date; to: Date },
): Promise<SupervisorReport> {
  const suffix = `${dateKey(range.from)}_${dateKey(range.to)}`;

  if (type === 'gimnasio') {
    const summary = await listGymPasses({
      from: dateKey(range.from),
      to: dateKey(range.to),
      limit: 2000,
    });
    return {
      type,
      title: 'Informe de folios de gimnasio',
      filename: `informe-gimnasio-${suffix}.pdf`,
      from: range.from,
      to: range.to,
      total: summary.total,
      summary: [
        `Emitidos: ${summary.emitted}`,
        `Anulados: ${summary.voided}`,
        `Total de folios: ${summary.total}`,
      ],
      lines: summary.rows.map(
        (row) =>
          `${formatCalendarDate(row.serviceDate)} | ${row.formattedFolio} | ${row.status} | Hab. ${row.roomNumber} | ${row.guestName} | ${row.receptionistName}`,
      ),
    };
  }

  if (type === 'multas') {
    const rows = await prisma.fine.findMany({
      where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      include: { room: { select: { number: true } }, createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    const byStatus = new Map<string, number>();
    let amountTotal = 0;
    for (const row of rows) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
      amountTotal += Number(row.amount ?? 0);
    }
    return {
      type,
      title: 'Informe de multas',
      filename: `informe-multas-${suffix}.pdf`,
      from: range.from,
      to: range.to,
      total: rows.length,
      summary: [
        `Total de multas: ${rows.length}`,
        ...[...byStatus.entries()].map(([status, count]) => `${status.replaceAll('_', ' ')}: ${count}`),
        `Monto informado acumulado: ${amountTotal.toLocaleString('es-CL')}`,
      ],
      lines: rows.map((row) =>
        `${when(row.createdAt)} | ${row.status.replaceAll('_', ' ')} | Hab. ${row.room.number} | Rva. ${row.reservationCode} | ${row.guestName} | ${row.reason} | ${row.amount !== null ? `${row.currency} ${Number(row.amount).toLocaleString('es-CL')}` : 'sin monto'} | ${row.createdBy.name}`,
      ),
    };
  }

  const [
    entries,
    tasks,
    alerts,
    shifts,
    currentOpenEntries,
    currentOpenTasks,
    currentOpenAlerts,
  ] = await Promise.all([
    prisma.operationalEntry.groupBy({
      by: ['status'],
      where: { AND:[entryReadWhere(user)], deletedAt: null, occurredAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { AND:[taskFollowUpReadWhere(user)], deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.alert.groupBy({
      by: ['status'],
      where: { AND:[alertReadWhere(user)], deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.shift.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, archivedAt: null },
      include: { assignments: { include: { user: { select: { name: true } } } } },
      orderBy: { actualStart: 'asc' },
      take: 500,
    }),
    prisma.operationalEntry.count({
      where: { AND:[entryReadWhere(user)], deletedAt: null, status: { in: [...OPEN_ENTRY_STATUSES] } },
    }),
    prisma.task.count({
      where: { AND:[taskFollowUpReadWhere(user)], deletedAt: null, status: { in: [...OPEN_TASK_STATUSES] } },
    }),
    prisma.alert.count({
      where: { AND:[alertReadWhere(user)], deletedAt: null, status: { not: AlertStatus.RESUELTA } },
    }),
  ]);

  const entryTotal = entries.reduce((sum, row) => sum + row._count._all, 0);
  const taskTotal = tasks.reduce((sum, row) => sum + row._count._all, 0);
  const alertTotal = alerts.reduce((sum, row) => sum + row._count._all, 0);
  return {
    type,
    title: 'Informe de actividad y estado operativo',
    filename: `informe-estado-operativo-${suffix}.pdf`,
    from: range.from,
    to: range.to,
    total: entryTotal + taskTotal + alertTotal,
    summary: [
      `Actividad del período · registros ocurridos: ${entryTotal}`,
      `Actividad del período · tareas creadas: ${taskTotal}`,
      `Actividad del período · alertas creadas: ${alertTotal}`,
      `Estado vigente ahora · registros abiertos ${currentOpenEntries} · tareas abiertas ${currentOpenTasks} · alertas activas ${currentOpenAlerts}`,
      `Turnos iniciados en el período: ${shifts.length}`,
    ],
    lines: [
      'ACTIVIDAD DEL PERÍODO · REGISTROS POR ESTADO ACTUAL',
      ...entries.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'ACTIVIDAD DEL PERÍODO · TAREAS CREADAS POR ESTADO ACTUAL',
      ...tasks.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'ACTIVIDAD DEL PERÍODO · ALERTAS CREADAS POR ESTADO ACTUAL',
      ...alerts.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'ESTADO VIGENTE AHORA',
      `Registros abiertos: ${currentOpenEntries}`,
      `Tareas abiertas: ${currentOpenTasks}`,
      `Alertas activas: ${currentOpenAlerts}`,
      '',
      'TURNOS INICIADOS EN EL PERÍODO',
      ...shifts.map((shift) => `${formatCalendarDate(shift.date)} | ${shift.type} | ${shift.status} | ${shift.assignments.map((assignment) => assignment.user.name).join(', ') || 'sin asignación'}`),
    ],
  };
}
