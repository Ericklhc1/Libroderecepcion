import 'server-only';
import {
  AlertStatus,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  TaskStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  ALERT_LEVEL_TONE,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  ENTRY_OPEN_STATUSES,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  ENTRY_TYPE_LABEL,
  FOLLOWUP_STATUS_LABEL,
  FOLLOWUP_STATUS_TONE,
  PRIORITY_LABEL,
  TASK_OPEN_STATUSES,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isOverdue,
  type Tone,
} from '@/domain/labels';
import { LIVE_ALERT_WHERE } from './alert-engine';

/**
 * El libro operativo es una vista cronológica única.
 *
 * En lugar de duplicar módulos, se unifican en un mismo flujo los cuatro
 * objetos operativos —registros, tareas, seguimientos y alertas— mediante una
 * proyección común (`BookItem`). Cada uno conserva su modelo y sus reglas.
 */
export type BookKind = 'entry' | 'task' | 'followup' | 'alert';

export type BookItem = {
  kind: BookKind;
  id: string;
  ref: string;
  kindLabel: string;
  typeLabel: string;
  title: string;
  summary: string | null;
  statusLabel: string;
  tone: Tone;
  priorityLabel: string | null;
  priorityTone: Tone | null;
  departmentName: string | null;
  ownerName: string | null;
  creatorName: string | null;
  date: Date;
  shiftLabel: string | null;
  dueAt: Date | null;
  overdue: boolean;
  hasFollowUp: boolean;
  commentCount: number;
  guestLabel: string | null;
  href: string;
  deleted: boolean;
};

export type BookFilters = {
  q?: string;
  from?: Date | null;
  to?: Date | null;
  shiftId?: string | null;
  userId?: string | null;
  departmentId?: string | null;
  entryType?: EntryType | null;
  status?: string | null;
  priority?: string | null;
  ownerId?: string | null;
  room?: string | null;
  reservation?: string | null;
  kinds?: BookKind[];
  onlyOpen?: boolean;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 40;

function textSearch(q: string | undefined) {
  if (!q || q.trim().length === 0) return null;
  return q.trim();
}

function shiftLabel(shift: { type: string; date: Date } | null | undefined): string | null {
  if (!shift) return null;
  return `${shift.type} ${shift.date.toLocaleDateString('es-CL')}`;
}

/**
 * Trae los registros del libro aplicando filtros combinados.
 *
 * Se consulta cada fuente ordenada por fecha descendente y se mezclan los
 * primeros `offset + pageSize` resultados: el orden global queda correcto sin
 * necesidad de vistas materializadas.
 */
export async function getBookItems(filters: BookFilters): Promise<{
  items: BookItem[];
  hasMore: boolean;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? DEFAULT_PAGE_SIZE));
  const window = page * pageSize + 1;
  const kinds: BookKind[] =
    filters.kinds && filters.kinds.length > 0
      ? filters.kinds
      : ['entry', 'task', 'followup', 'alert'];

  const q = textSearch(filters.q);
  const deletedFilter = filters.includeDeleted ? {} : { deletedAt: null };
  const dateRange =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        }
      : undefined;

  const items: BookItem[] = [];

  if (kinds.includes('entry')) {
    // Cada grupo de condiciones se acumula en AND: así ningún filtro
    // sobrescribe a otro y todos se aplican simultáneamente.
    const and: Prisma.OperationalEntryWhereInput[] = [];
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { ownerId: filters.userId }] });
    }
    if (filters.room) {
      and.push({
        OR: [
          { guest: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
          { reservation: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
        ],
      });
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { guest: { fullName: { contains: q, mode: 'insensitive' } } },
          { reservation: { code: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.OperationalEntryWhereInput = {
      ...deletedFilter,
      ...(filters.entryType ? { type: filters.entryType } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.shiftId ? { shiftId: filters.shiftId } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(dateRange ? { occurredAt: dateRange } : {}),
      ...(filters.status && filters.status in EntryStatus
        ? { status: filters.status as EntryStatus }
        : {}),
      ...(filters.onlyOpen ? { status: { in: ENTRY_OPEN_STATUSES } } : {}),
      ...(filters.priority ? { priority: filters.priority as Prisma.EnumPriorityFilter } : {}),
      ...(filters.reservation
        ? { reservation: { code: { contains: filters.reservation, mode: 'insensitive' } } }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.operationalEntry.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
        shift: { select: { type: true, date: true } },
        guest: { select: { fullName: true, roomNumber: true } },
        _count: { select: { comments: true, followUps: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: window,
    });

    for (const row of rows) {
      const open = ENTRY_OPEN_STATUSES.includes(row.status);
      items.push({
        kind: 'entry',
        id: row.id,
        ref: `#${row.seq}`,
        kindLabel: row.type === EntryType.INCIDENCIA ? 'Incidencia' : 'Registro',
        typeLabel: ENTRY_TYPE_LABEL[row.type],
        title: row.title,
        summary: row.description.slice(0, 180),
        statusLabel: ENTRY_STATUS_LABEL[row.status],
        tone: isOverdue(row.dueAt, open) ? 'critico' : ENTRY_STATUS_TONE[row.status],
        priorityLabel: PRIORITY_LABEL[row.priority],
        priorityTone:
          row.priority === 'CRITICA'
            ? 'critico'
            : row.priority === 'ALTA'
              ? 'atencion'
              : row.priority === 'MEDIA'
                ? 'curso'
                : 'neutro',
        departmentName: row.department?.name ?? null,
        ownerName: row.owner?.name ?? null,
        creatorName: row.createdBy.name,
        date: row.occurredAt,
        shiftLabel: shiftLabel(row.shift),
        dueAt: row.dueAt,
        overdue: isOverdue(row.dueAt, open),
        hasFollowUp: row.requiresFollowUp || row._count.followUps > 0,
        commentCount: row._count.comments,
        guestLabel: row.guest
          ? `${row.guest.fullName}${row.guest.roomNumber ? ` · hab. ${row.guest.roomNumber}` : ''}`
          : null,
        href: `/libro/${row.id}`,
        deleted: row.deletedAt !== null,
      });
    }
  }

  if (kinds.includes('task')) {
    const and: Prisma.TaskWhereInput[] = [];
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { assigneeId: filters.userId }] });
    }
    // La habitación y la reserva llegan a la tarea a través de su registro de
    // origen: si la tarea no tiene ese vínculo, queda fuera del resultado.
    if (filters.room) {
      and.push({
        entry: {
          OR: [
            { guest: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
            { reservation: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
          ],
        },
      });
    }
    if (filters.reservation) {
      and.push({
        entry: { reservation: { code: { contains: filters.reservation, mode: 'insensitive' } } },
      });
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { entry: { guest: { fullName: { contains: q, mode: 'insensitive' } } } },
        ],
      });
    }

    const where: Prisma.TaskWhereInput = {
      ...deletedFilter,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.shiftId ? { shiftId: filters.shiftId } : {}),
      ...(filters.ownerId ? { assigneeId: filters.ownerId } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(filters.status && filters.status in TaskStatus
        ? { status: filters.status as TaskStatus }
        : {}),
      ...(filters.onlyOpen ? { status: { in: TASK_OPEN_STATUSES } } : {}),
      ...(filters.priority ? { priority: filters.priority as Prisma.EnumPriorityFilter } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
        shift: { select: { type: true, date: true } },
        _count: { select: { comments: true, followUps: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window,
    });

    for (const row of rows) {
      const open = TASK_OPEN_STATUSES.includes(row.status);
      items.push({
        kind: 'task',
        id: row.id,
        ref: `T#${row.seq}`,
        kindLabel: 'Tarea',
        typeLabel: 'Tarea',
        title: row.title,
        summary: row.description?.slice(0, 180) ?? null,
        statusLabel: TASK_STATUS_LABEL[row.status],
        tone: isOverdue(row.dueAt, open) ? 'critico' : TASK_STATUS_TONE[row.status],
        priorityLabel: PRIORITY_LABEL[row.priority],
        priorityTone:
          row.priority === 'CRITICA'
            ? 'critico'
            : row.priority === 'ALTA'
              ? 'atencion'
              : row.priority === 'MEDIA'
                ? 'curso'
                : 'neutro',
        departmentName: row.department?.name ?? null,
        ownerName: row.assignee?.name ?? null,
        creatorName: row.createdBy.name,
        date: row.createdAt,
        shiftLabel: shiftLabel(row.shift),
        dueAt: row.dueAt,
        overdue: isOverdue(row.dueAt, open),
        hasFollowUp: row._count.followUps > 0,
        commentCount: row._count.comments,
        guestLabel: null,
        href: `/tareas/${row.id}`,
        deleted: row.deletedAt !== null,
      });
    }
  }

  if (kinds.includes('followup')) {
    const and: Prisma.FollowUpWhereInput[] = [];
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { ownerId: filters.userId }] });
    }
    if (filters.departmentId) {
      and.push({ entry: { departmentId: filters.departmentId } });
    }
    if (filters.room) {
      and.push({
        entry: {
          OR: [
            { guest: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
            { reservation: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
          ],
        },
      });
    }
    if (filters.reservation) {
      and.push({
        entry: { reservation: { code: { contains: filters.reservation, mode: 'insensitive' } } },
      });
    }
    if (q) {
      and.push({
        OR: [
          { action: { contains: q, mode: 'insensitive' } },
          { nextAction: { contains: q, mode: 'insensitive' } },
          { result: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.FollowUpWhereInput = {
      ...deletedFilter,
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(filters.status && filters.status in FollowUpStatus
        ? { status: filters.status as FollowUpStatus }
        : {}),
      ...(filters.onlyOpen
        ? { status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] } }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.followUp.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        entry: { select: { id: true, seq: true, title: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window,
    });

    for (const row of rows) {
      items.push({
        kind: 'followup',
        id: row.id,
        ref: 'Seg.',
        kindLabel: 'Seguimiento',
        typeLabel: 'Seguimiento',
        title: row.action,
        summary: row.nextAction ? `Próxima acción: ${row.nextAction}` : row.result,
        statusLabel: FOLLOWUP_STATUS_LABEL[row.status],
        tone: FOLLOWUP_STATUS_TONE[row.status],
        priorityLabel: null,
        priorityTone: null,
        departmentName: null,
        ownerName: row.owner.name,
        creatorName: row.createdBy.name,
        date: row.createdAt,
        shiftLabel: null,
        dueAt: row.scheduledAt,
        overdue: row.status === FollowUpStatus.VENCIDO,
        hasFollowUp: true,
        commentCount: row._count.comments,
        guestLabel: null,
        href: row.entry ? `/libro/${row.entry.id}` : '/seguimientos',
        deleted: row.deletedAt !== null,
      });
    }
  }

  if (kinds.includes('alert')) {
    const and: Prisma.AlertWhereInput[] = [];
    if (filters.onlyOpen) and.push(LIVE_ALERT_WHERE());
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { acknowledgedById: filters.userId }] });
    }
    if (filters.ownerId) {
      and.push({ OR: [{ createdById: filters.ownerId }, { acknowledgedById: filters.ownerId }] });
    }
    if (filters.room) {
      and.push({
        OR: [
          { guest: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
          { reservation: { roomNumber: { contains: filters.room, mode: 'insensitive' } } },
        ],
      });
    }
    if (filters.reservation) {
      and.push({ reservation: { code: { contains: filters.reservation, mode: 'insensitive' } } });
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
          { guest: { fullName: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.AlertWhereInput = {
      ...deletedFilter,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(filters.status && filters.status in AlertStatus
        ? { status: filters.status as AlertStatus }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.alert.findMany({
      where,
      include: {
        department: { select: { name: true } },
        createdBy: { select: { name: true } },
        guest: { select: { fullName: true, roomNumber: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window,
    });

    for (const row of rows) {
      items.push({
        kind: 'alert',
        id: row.id,
        ref: 'Alerta',
        kindLabel: 'Alerta',
        typeLabel: ALERT_TYPE_LABEL[row.type],
        title: row.title,
        summary: row.message,
        statusLabel: ALERT_STATUS_LABEL[row.status],
        tone:
          row.status === AlertStatus.RESUELTA ? 'resuelto' : ALERT_LEVEL_TONE[row.level],
        priorityLabel: null,
        priorityTone: null,
        departmentName: row.department?.name ?? null,
        ownerName: null,
        creatorName: row.createdBy?.name ?? 'Sistema',
        date: row.createdAt,
        shiftLabel: null,
        dueAt: row.dueAt,
        overdue: isOverdue(row.dueAt, row.status !== AlertStatus.RESUELTA),
        hasFollowUp: false,
        commentCount: row._count.comments,
        guestLabel: row.guest
          ? `${row.guest.fullName}${row.guest.roomNumber ? ` · hab. ${row.guest.roomNumber}` : ''}`
          : null,
        href: `/alertas?alerta=${row.id}`,
        deleted: row.deletedAt !== null,
      });
    }
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  const offset = (page - 1) * pageSize;
  const slice = items.slice(offset, offset + pageSize);
  return { items: slice, hasMore: items.length > offset + pageSize, page, pageSize };
}
