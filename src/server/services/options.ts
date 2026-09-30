import 'server-only';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
import { ENTRY_OPEN_STATUSES, ENTRY_TYPE_LABEL, TASK_OPEN_STATUSES } from '@/domain/labels';
import { listOperationalUsers } from './users';

export type Option = { value: string; label: string };

export type FormOptions = {
  users: Option[];
  departments: Option[];
  /** Legado PMS: se conserva vacío para compatibilidad de componentes antiguos. */
  guests: Option[];
  /** Legado PMS: se conserva vacío para compatibilidad de componentes antiguos. */
  reservations: Option[];
  openEntries: Option[];
  openTasks: Option[];
  /** Catálogo operativo de las 89 habitaciones. No representa ocupación PMS. */
  rooms: Option[];
  activeShifts: Option[];
};

/**
 * Opciones para los formularios operativos.
 *
 * Habitaciones es sólo catálogo de contexto operativo. No consulta estadías,
 * ocupación, check-in ni check-out del PMS.
 */
export async function getFormOptions(): Promise<FormOptions> {
  const [users, departments, entries, tasks, rooms, activeShifts] = await Promise.all([
    listOperationalUsers(),
    prisma.department.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, humanId: true, title: true, type: true },
      take: 100,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, humanId: true, title: true },
      take: 100,
    }),
    prisma.room.findMany({
      where: { active: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      select: { id: true, number: true },
    }),
    prisma.shift.findMany({
      where: {
        archivedAt: null,
        status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA'] },
      },
      orderBy: { plannedStart: 'desc' },
      select: { id: true, type: true, date: true },
      take: 12,
    }),
  ]);

  return {
    users: users.map((user) => ({ value: user.id, label: user.name })),
    departments: departments.map((department) => ({
      value: department.id,
      label: department.name,
    })),
    guests: [],
    reservations: [],
    openEntries: entries.map((entry) => ({
      value: entry.id,
      label: `${ENTRY_TYPE_LABEL[entry.type]} #${entry.humanId} · ${entry.title}`,
    })),
    openTasks: tasks.map((task) => ({
      value: task.id,
      label: `Tarea #${task.humanId} · ${task.title}`,
    })),
    rooms: rooms.map((room) => ({ value: room.id, label: room.number })),
    activeShifts: activeShifts.map((shift) => ({
      value: shift.id,
      label: `${shift.type} · ${formatCalendarDate(shift.date)}`,
    })),
  };
}
