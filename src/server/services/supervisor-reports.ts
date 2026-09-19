import 'server-only';

import { AlertStatus, EntryStatus, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { formatGymFolio } from './gym-pass';

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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function when(date: Date) {
  return formatDateTime(date);
}

function tag(tags: string[], prefix: string) {
  return tags.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function reportDateRange(fromRaw?: string | null, toRaw?: string | null): { from: Date; to: Date } {
  const today = dateKey(new Date());
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw ?? '') ? fromRaw! : today;
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(toRaw ?? '') ? toRaw! : fromKey;
  const from = new Date(`${fromKey}T00:00:00-03:00`);
  const to = new Date(`${toKey}T23:59:59.999-03:00`);
  if (to < from) return { from: to, to: from };
  return { from, to };
}

export async function buildSupervisorReport(
  type: SupervisorReportType,
  range: { from: Date; to: Date },
): Promise<SupervisorReport> {
  const suffix = `${dateKey(range.from)}_${dateKey(range.to)}`;

  if (type === 'gimnasio') {
    const rows = await prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        category: 'PASE_GIMNASIO',
        occurredAt: { gte: range.from, lte: range.to },
      },
      include: { room: { select: { number: true } }, createdBy: { select: { name: true } } },
      orderBy: { occurredAt: 'asc' },
      take: 2000,
    });
    const active = rows.filter((row) => !row.tags.includes('anulado')).length;
    const cancelled = rows.length - active;
    return {
      type,
      title: 'Informe de pases de gimnasio',
      filename: `informe-gimnasio-${suffix}.pdf`,
      from: range.from,
      to: range.to,
      total: rows.length,
      summary: [`Emitidos vigentes: ${active}`, `Anulados: ${cancelled}`, `Total de folios: ${rows.length}`],
      lines: rows.map((row) => {
        const folio = Number(tag(row.tags, 'folio-') ?? '0');
        const reservation = tag(row.tags, 'reserva-') ?? '—';
        return `${when(row.occurredAt)} | ${folio ? formatGymFolio(folio) : '—'} | ${row.tags.includes('anulado') ? 'ANULADO' : 'EMITIDO'} | Hab. ${row.room?.number ?? '—'} | Rva. ${reservation} | ${row.createdBy.name}`;
      }),
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

  const [entries, tasks, alerts, shifts] = await Promise.all([
    prisma.operationalEntry.groupBy({
      by: ['status'],
      where: { deletedAt: null, occurredAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.alert.groupBy({
      by: ['status'],
      where: { deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.shift.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, archivedAt: null },
      include: { assignments: { include: { user: { select: { name: true } } } } },
      orderBy: { actualStart: 'asc' },
      take: 500,
    }),
  ]);

  const entryTotal = entries.reduce((sum, row) => sum + row._count._all, 0);
  const taskTotal = tasks.reduce((sum, row) => sum + row._count._all, 0);
  const alertTotal = alerts.reduce((sum, row) => sum + row._count._all, 0);
  const openEntries = entries
    .filter((row) => OPEN_ENTRY_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);
  const openTasks = tasks
    .filter((row) => OPEN_TASK_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);
  const openAlerts = alerts
    .filter((row) => row.status !== AlertStatus.RESUELTA)
    .reduce((sum, row) => sum + row._count._all, 0);

  return {
    type,
    title: 'Informe de estado operativo',
    filename: `informe-estado-operativo-${suffix}.pdf`,
    from: range.from,
    to: range.to,
    total: entryTotal + taskTotal + alertTotal,
    summary: [
      `Registros operativos: ${entryTotal} · abiertos ${openEntries}`,
      `Tareas: ${taskTotal} · abiertas ${openTasks}`,
      `Alertas: ${alertTotal} · activas ${openAlerts}`,
      `Turnos iniciados en el período: ${shifts.length}`,
    ],
    lines: [
      'REGISTROS POR ESTADO',
      ...entries.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'TAREAS POR ESTADO',
      ...tasks.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'ALERTAS POR ESTADO',
      ...alerts.map((row) => `${row.status.replaceAll('_', ' ')}: ${row._count._all}`),
      '',
      'TURNOS',
      ...shifts.map((shift) => `${formatCalendarDate(shift.date)} | ${shift.type} | ${shift.status} | ${shift.assignments.map((assignment) => assignment.user.name).join(', ') || 'sin asignación'}`),
    ],
  };
}
