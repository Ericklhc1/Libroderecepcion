import 'server-only';
import {
  AlertStatus,
  EntryStatus,
  EntryType,
  FineStatus,
  FollowUpStatus,
  TaskStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate } from '@/lib/format';
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
import {
  FINE_KIND_LABELS,
  FINE_STATUS_LABELS,
  OPEN_FINE_STATUSES,
} from '@/domain/fines';
import { LIVE_ALERT_WHERE } from './alert-engine';

/**
 * El libro operativo es una vista cronológica única.
 *
 * No se duplican entidades para hacerlas aparecer acá: cada módulo conserva su
 * propia fuente de verdad y se proyecta como `BookItem`. Las multas forman
 * parte del libro igual que incidencias, tareas, seguimientos y alertas.
 */
export type BookKind = 'entry' | 'task' | 'followup' | 'alert' | 'fine';

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

/**
 * El buscador acepta la forma en que el mesón escribe las referencias: `@401`,
 * `#123`, `T#44` y texto normal. El prefijo ayuda a leer, pero no debe volver
 * invisible el dato en la base.
 */
function textSearch(q: string | undefined) {
  if (!q || q.trim().length === 0) return null;
  const raw = q.trim();
  const normalized = raw.replace(/^T#/i, '').replace(/^[@#]/, '').trim();
  return normalized || raw;
}

function numericRef(q: string | null): number | null {
  if (!q || !/^\d+$/.test(q)) return null;
  const value = Number(q);
  return Number.isSafeInteger(value) ? value : null;
}

function shiftLabel(shift: { type: string; date: Date } | null | undefined): string | null {
  if (!shift) return null;
  return `${shift.type} ${formatCalendarDate(shift.date)}`;
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
      : ['entry', 'task', 'followup', 'alert', 'fine'];

  const q = textSearch(filters.q);
  const seq = numericRef(q);
  const deletedFilter = filters.includeDeleted ? {} : { deletedAt: null };
  const dateRange =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: filters.from } : {}),
          ...(filters.to ? { lte: filters.to } : {}),
        }
      : undefined;

  async function entryItems(): Promise<BookItem[]> {
    const items: BookItem[] = [];
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
          ...(seq !== null ? [{ seq }] : []),
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { guest: { fullName: { contains: q, mode: 'insensitive' } } },
          { guest: { roomNumber: { contains: q, mode: 'insensitive' } } },
          { reservation: { code: { contains: q, mode: 'insensitive' } } },
          { reservation: { roomNumber: { contains: q, mode: 'insensitive' } } },
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
          { owner: { name: { contains: q, mode: 'insensitive' } } },
          { owner: { username: { contains: q, mode: 'insensitive' } } },
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
    return items;
  }

  async function taskItems(): Promise<BookItem[]> {
    const items: BookItem[] = [];
    const and: Prisma.TaskWhereInput[] = [];
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { assigneeId: filters.userId }] });
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
          ...(seq !== null ? [{ seq }] : []),
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { entry: { guest: { fullName: { contains: q, mode: 'insensitive' } } } },
          { entry: { guest: { roomNumber: { contains: q, mode: 'insensitive' } } } },
          { entry: { reservation: { code: { contains: q, mode: 'insensitive' } } } },
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
          { assignee: { name: { contains: q, mode: 'insensitive' } } },
          { assignee: { username: { contains: q, mode: 'insensitive' } } },
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
    return items;
  }

  async function followUpItems(): Promise<BookItem[]> {
    const items: BookItem[] = [];
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
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
          { owner: { name: { contains: q, mode: 'insensitive' } } },
          { owner: { username: { contains: q, mode: 'insensitive' } } },
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
    return items;
  }

  async function alertItems(): Promise<BookItem[]> {
    const items: BookItem[] = [];
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
          { guest: { roomNumber: { contains: q, mode: 'insensitive' } } },
          { reservation: { code: { contains: q, mode: 'insensitive' } } },
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
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
    return items;
  }

  async function fineItems(): Promise<BookItem[]> {
    /*
      Una multa es una entidad operativa propia. No se crea una incidencia copia
      para verla en el Libro: eso partiría su estado en dos lugares. Los filtros
      que una multa no posee (turno, área, prioridad, responsable o tipo de
      registro) simplemente la excluyen de esa consulta especializada.
    */
    if (
      filters.shiftId ||
      filters.departmentId ||
      filters.priority ||
      filters.ownerId ||
      filters.entryType
    ) {
      return [];
    }

    const and: Prisma.FineWhereInput[] = [];
    if (filters.userId) and.push({ createdById: filters.userId });
    if (filters.room) {
      and.push({ room: { number: { contains: filters.room, mode: 'insensitive' } } });
    }
    if (filters.reservation) {
      and.push({ reservationCode: { contains: filters.reservation, mode: 'insensitive' } });
    }
    if (q) {
      and.push({
        OR: [
          { reservationCode: { contains: q, mode: 'insensitive' } },
          { guestName: { contains: q, mode: 'insensitive' } },
          { reason: { contains: q, mode: 'insensitive' } },
          { itemDetail: { contains: q, mode: 'insensitive' } },
          { stainType: { contains: q, mode: 'insensitive' } },
          { guestStatement: { contains: q, mode: 'insensitive' } },
          { room: { number: { contains: q, mode: 'insensitive' } } },
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const where: Prisma.FineWhereInput = {
      ...deletedFilter,
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(filters.status && filters.status in FineStatus
        ? { status: filters.status as FineStatus }
        : {}),
      ...(filters.onlyOpen
        ? { status: { in: OPEN_FINE_STATUSES.map((status) => FineStatus[status]) } }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.fine.findMany({
      where,
      include: {
        room: { select: { number: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window,
    });

    return rows.map((row) => {
      const tone: Tone =
        row.status === FineStatus.COBRADA
          ? 'resuelto'
          : row.status === FineStatus.NOTIFICADA
            ? 'atencion'
            : row.status === FineStatus.REGISTRADA
              ? 'pendiente'
              : 'neutro';
      const detail = row.itemDetail || row.stainType;
      return {
        kind: 'fine' as const,
        id: row.id,
        ref: `Multa · ${row.room.number}`,
        kindLabel: 'Multa',
        typeLabel: FINE_KIND_LABELS[row.kind],
        title: `Multa habitación ${row.room.number} · ${row.guestName}`,
        summary: `${detail ? `${detail}. ` : ''}${row.reason}`.slice(0, 180),
        statusLabel: FINE_STATUS_LABELS[row.status],
        tone,
        priorityLabel: null,
        priorityTone: null,
        departmentName: null,
        ownerName: null,
        creatorName: row.createdBy.name,
        date: row.createdAt,
        shiftLabel: null,
        dueAt: null,
        overdue: false,
        hasFollowUp: OPEN_FINE_STATUSES.includes(row.status),
        commentCount: 0,
        guestLabel: `${row.guestName} · hab. ${row.room.number} · rva. ${row.reservationCode}`,
        href: `/habitaciones/${row.room.number}?multa=${row.id}`,
        deleted: row.deletedAt !== null,
      } satisfies BookItem;
    });
  }

  const groups = await Promise.all([
    kinds.includes('entry') ? entryItems() : [],
    kinds.includes('task') ? taskItems() : [],
    kinds.includes('followup') ? followUpItems() : [],
    kinds.includes('alert') ? alertItems() : [],
    kinds.includes('fine') ? fineItems() : [],
  ]);

  const items = groups.flat();
  items.sort((a, b) => b.date.getTime() - a.date.getTime());

  const offset = (page - 1) * pageSize;
  const slice = items.slice(offset, offset + pageSize);
  return { items: slice, hasMore: items.length > offset + pageSize, page, pageSize };
}
