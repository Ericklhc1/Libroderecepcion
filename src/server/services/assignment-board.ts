import 'server-only';
import { Priority, TaskStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { TASK_OPEN_STATUSES, ENTRY_OPEN_STATUSES } from '@/domain/labels';

/**
 * Tablero de asignación del Supervisor.
 *
 * Responde a una sola pregunta: **¿quién hace qué, y qué no tiene dueño?**
 *
 * Lo que aporta frente a la lista de tareas es la CARGA por persona. Asignar a
 * ciegas es cómo se llega a un recepcionista con once pendientes y otro con
 * dos, y eso no se ve en un listado ordenado por fecha.
 *
 * Todo se calcula al leer. No hay contadores que mantener.
 */

export type WorkloadRow = {
  userId: string;
  name: string;
  roleName: string;
  /** Tareas abiertas asignadas. */
  openTasks: number;
  /** De ésas, cuántas están vencidas. */
  overdueTasks: number;
  /** Registros del libro de los que es responsable y siguen abiertos. */
  openEntries: number;
  /** Crítica o alta: es lo que decide si puede recibir una más. */
  urgent: number;
};

export type UnassignedItem = {
  id: string;
  kind: 'task' | 'entry';
  seq: number;
  title: string;
  priority: Priority;
  createdAt: Date;
  dueAt: Date | null;
  href: string;
  roomNumber: string | null;
};

export type AssignmentBoard = {
  now: Date;
  /** Sin responsable: es lo primero que hay que resolver. */
  unassigned: UnassignedItem[];
  /** Carga de cada persona operativa, de la más cargada a la menos. */
  workload: WorkloadRow[];
  /** Quién puede recibir asignaciones, para los selectores. */
  assignees: Array<{ value: string; label: string }>;
  overdueTotal: number;
};

export async function getAssignmentBoard(): Promise<AssignmentBoard> {
  const now = new Date();

  const [unassignedTasks, unassignedEntries, people] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null, assigneeId: null, status: { in: TASK_OPEN_STATUSES } },
      select: {
        id: true,
        seq: true,
        title: true,
        priority: true,
        createdAt: true,
        dueAt: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 40,
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, ownerId: null, status: { in: ENTRY_OPEN_STATUSES } },
      select: {
        id: true,
        seq: true,
        title: true,
        priority: true,
        createdAt: true,
        dueAt: true,
        room: { select: { number: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 40,
    }),
    /*
      Una sola consulta para la carga de todos: los `_count` con filtro los
      resuelve PostgreSQL. La versión ingenua —una consulta por persona— son
      diez viajes a otra región por cada carga de la pantalla.
    */
    prisma.user.findMany({
      where: { deletedAt: null, active: true, role: { operational: true } },
      select: {
        id: true,
        name: true,
        role: { select: { name: true } },
        tasksAssigned: {
          where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
          select: { priority: true, dueAt: true },
        },
        entriesOwned: {
          where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
          select: { priority: true, dueAt: true },
        },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  const workload: WorkloadRow[] = people.map((person) => {
    const overdueTasks = person.tasksAssigned.filter(
      (task) => task.dueAt && task.dueAt < now,
    ).length;
    const urgent = [...person.tasksAssigned, ...person.entriesOwned].filter(
      (item) => item.priority === Priority.CRITICA || item.priority === Priority.ALTA,
    ).length;

    return {
      userId: person.id,
      name: person.name,
      roleName: person.role.name,
      openTasks: person.tasksAssigned.length,
      overdueTasks,
      openEntries: person.entriesOwned.length,
      urgent,
    };
  });

  // De la más cargada a la menos: el Supervisor mira primero a quién aliviar.
  workload.sort(
    (a, b) =>
      b.openTasks + b.openEntries - (a.openTasks + a.openEntries) ||
      a.name.localeCompare(b.name),
  );

  const unassigned: UnassignedItem[] = [
    ...unassignedTasks.map((task) => ({
      id: task.id,
      kind: 'task' as const,
      seq: task.seq,
      title: task.title,
      priority: task.priority,
      createdAt: task.createdAt,
      dueAt: task.dueAt,
      href: `/tareas/${task.id}`,
      roomNumber: null,
    })),
    ...unassignedEntries.map((entry) => ({
      id: entry.id,
      kind: 'entry' as const,
      seq: entry.seq,
      title: entry.title,
      priority: entry.priority,
      createdAt: entry.createdAt,
      dueAt: entry.dueAt,
      href: `/libro/${entry.id}`,
      roomNumber: entry.room?.number ?? null,
    })),
  ].sort((a, b) => {
    // Lo vencido primero; después lo más antiguo, que es lo que llevan
    // esperando sin que nadie lo tome.
    const aOverdue = a.dueAt && a.dueAt < now ? 1 : 0;
    const bOverdue = b.dueAt && b.dueAt < now ? 1 : 0;
    return bOverdue - aOverdue || a.createdAt.getTime() - b.createdAt.getTime();
  });

  return {
    now,
    unassigned,
    workload,
    assignees: people.map((person) => ({
      value: person.id,
      label: `${person.name} · ${person.role.name}`,
    })),
    overdueTotal: workload.reduce((sum, row) => sum + row.overdueTasks, 0),
  };
}

/** Tareas abiertas de una persona, para mirar su carga en detalle. */
export async function getPersonWorkload(userId: string) {
  return prisma.task.findMany({
    where: { deletedAt: null, assigneeId: userId, status: { in: TASK_OPEN_STATUSES } },
    select: {
      id: true,
      seq: true,
      title: true,
      priority: true,
      status: true,
      dueAt: true,
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    take: 30,
  });
}

export { TaskStatus };
