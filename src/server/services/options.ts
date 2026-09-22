import 'server-only';
import { prisma } from '@/lib/prisma';
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
  /** Legado Habitaciones: ya no participa en formularios operativos nuevos. */
  rooms: Option[];
  activeShifts: Option[];
};

/**
 * Opciones para los formularios operativos.
 *
 * Desde v1.4.0 esta función NO consulta huéspedes, reservas, estadías ni
 * habitaciones. Novedades, tareas y Supervisión funcionan sólo con personas,
 * áreas, registros, tareas y turnos.
 */
export async function getFormOptions(): Promise<FormOptions> {
  const [users, departments, entries, tasks, activeShifts] = await Promise.all([
    listOperationalUsers(),
    prisma.department.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, seq: true, title: true, type: true },
      take: 100,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, seq: true, title: true },
      take: 100,
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
      label: `${ENTRY_TYPE_LABEL[entry.type]} #${entry.seq} · ${entry.title}`,
    })),
    openTasks: tasks.map((task) => ({
      value: task.id,
      label: `Tarea #${task.seq} · ${task.title}`,
    })),
    rooms: [],
    activeShifts: activeShifts.map((shift) => ({
      value: shift.id,
      label: `${shift.type} · ${shift.date.toLocaleDateString('es-CL')}`,
    })),
  };
}
