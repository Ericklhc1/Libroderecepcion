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
import { LIVE_ALERT_WHERE } from './alert-engine';
import { ROLE_KEYS } from '@/lib/permissions';

/**
 * Libro Operativo v1.4.0.
 *
 * Proyecta únicamente continuidad del Libro: Novedades/Incidencias, Tareas,
 * Seguimientos y Alertas. No consulta PMS, huéspedes, reservas, habitaciones,
 * estadías, multas ni otros módulos físicos.
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
  /** Compatibilidad de presentación; el Libro nuevo no proyecta huésped PMS. */
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
  kinds?: BookKind[];
  onlyOpen?: boolean;
  includeDeleted?: boolean;
  /** Vista operativa de Novedades: sólo registros humanos de Recepción en gestión. */
  receptionEntriesOnly?: boolean;
  /** Oculta alertas internas de validación de cierre a vistas no supervisoras. */
  hideClosureValidation?: boolean;
  page?: number;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 40;

function textSearch(q: string | undefined): string | null {
  if (!q || q.trim().length === 0) return null;
  const raw = q.trim();
  const normalized = raw.replace(/^T#/i, '').replace(/^#/, '').trim();
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

function priorityTone(priority: string): Tone {
  if (priority === 'CRITICA') return 'critico';
  if (priority === 'ALTA') return 'atencion';
  if (priority === 'MEDIA') return 'curso';
  return 'neutro';
}

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
    const and: Prisma.OperationalEntryWhereInput[] = [];

    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { ownerId: filters.userId }] });
    }

    if (filters.receptionEntriesOnly) {
      and.push({
        type: { in: [EntryType.NOVEDAD, EntryType.INCIDENCIA] },
        status: { in: ENTRY_OPEN_STATUSES },
        createdBy: { role: { key: ROLE_KEYS.RECEPTIONIST } },
      });
    }

    if (q) {
      and.push({
        OR: [
          ...(seq !== null ? [{ seq }] : []),
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { createdBy: { name: { contains: q, mode: 'insensitive' } } },
          { createdBy: { username: { contains: q, mode: 'insensitive' } } },
          { owner: { name: { contains: q, mode: 'insensitive' } } },
          { owner: { username: { contains: q, mode: 'insensitive' } } },
          { department: { name: { contains: q, mode: 'insensitive' } } },
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
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const rows = await prisma.operationalEntry.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
        shift: { select: { type: true, date: true } },
        _count: { select: { comments: true, followUps: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: window,
    });

    return rows.map((row) => {
      const open = ENTRY_OPEN_STATUSES.includes(row.status);
      return {
        kind: 'entry' as const,
        id: row.id,
        ref: `#${row.seq}`,
        kindLabel: row.type === EntryType.INCIDENCIA ? 'Incidencia' : 'Novedad',
        typeLabel: ENTRY_TYPE_LABEL[row.type],
        title: row.title,
        summary: row.description.slice(0, 180),
        statusLabel: ENTRY_STATUS_LABEL[row.status],
        tone: isOverdue(row.dueAt, open) ? 'critico' : ENTRY_STATUS_TONE[row.status],
        priorityLabel: PRIORITY_LABEL[row.priority],
        priorityTone: priorityTone(row.priority),
        departmentName: row.department?.name ?? null,
        ownerName: row.owner?.name ?? null,
        creatorName: row.createdBy.name,
        date: row.occurredAt,
        shiftLabel: shiftLabel(row.shift),
        dueAt: row.dueAt,
        overdue: isOverdue(row.dueAt, open),
        hasFollowUp: row.requiresFollowUp || row._count.followUps > 0,
        commentCount: row._count.comments,
        guestLabel: null,
        href: `/libro/${row.id}`,
        deleted: row.deletedAt !== null,
      };
    });
  }

  async function taskItems(): Promise<BookItem[]> {
    const and: Prisma.TaskWhereInput[] = [];

    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { assigneeId: filters.userId }] });
    }

    if (q) {
      and.push({
        OR: [
          ...(seq !== null ? [{ seq }] : []),
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
          { entry: { title: { contains: q, mode: 'insensitive' } } },
          { entry: { description: { contains: q, mode: 'insensitive' } } },
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

    return rows.map((row) => {
      const open = TASK_OPEN_STATUSES.includes(row.status);
      return {
        kind: 'task' as const,
        id: row.id,
        ref: `T#${row.seq}`,
        kindLabel: 'Tarea',
        typeLabel: 'Tarea',
        title: row.title,
        summary: row.description?.slice(0, 180) ?? null,
        statusLabel: TASK_STATUS_LABEL[row.status],
        tone: isOverdue(row.dueAt, open) ? 'critico' : TASK_STATUS_TONE[row.status],
        priorityLabel: PRIORITY_LABEL[row.priority],
        priorityTone: priorityTone(row.priority),
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
      };
    });
  }

  async function followUpItems(): Promise<BookItem[]> {
    const and: Prisma.FollowUpWhereInput[] = [];

    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { ownerId: filters.userId }] });
    }
    if (filters.departmentId) {
      and.push({ entry: { departmentId: filters.departmentId } });
    }
    if (q) {
      and.push({
        OR: [
          { action: { contains: q, mode: 'insensitive' } },
          { nextAction: { contains: q, mode: 'insensitive' } },
          { result: { contains: q, mode: 'insensitive' } },
          { entry: { title: { contains: q, mode: 'insensitive' } } },
          { entry: { description: { contains: q, mode: 'insensitive' } } },
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

    return rows.map((row) => ({
      kind: 'followup' as const,
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
    }));
  }

  async function alertItems(): Promise<BookItem[]> {
    const and: Prisma.AlertWhereInput[] = [];

    if (filters.onlyOpen) and.push(LIVE_ALERT_WHERE());
    if (filters.hideClosureValidation) {
      and.push({
        NOT: { dedupeKey: { startsWith: 'shift-validation:' } },
      });
    }
    if (filters.userId) {
      and.push({ OR: [{ createdById: filters.userId }, { acknowledgedById: filters.userId }] });
    }
    if (filters.ownerId) {
      and.push({ OR: [{ createdById: filters.ownerId }, { acknowledgedById: filters.ownerId }] });
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
          { entry: { title: { contains: q, mode: 'insensitive' } } },
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
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: window,
    });

    return rows.map((row) => ({
      kind: 'alert' as const,
      id: row.id,
      ref: 'Alerta',
      kindLabel: 'Alerta',
      typeLabel: ALERT_TYPE_LABEL[row.type],
      title: row.title,
      summary: row.message,
      statusLabel: ALERT_STATUS_LABEL[row.status],
      tone: row.status === AlertStatus.RESUELTA ? 'resuelto' : ALERT_LEVEL_TONE[row.level],
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
      guestLabel: null,
      href: `/alertas?alerta=${row.id}`,
      deleted: row.deletedAt !== null,
    }));
  }

  const groups = await Promise.all([
    kinds.includes('entry') ? entryItems() : [],
    kinds.includes('task') ? taskItems() : [],
    kinds.includes('followup') ? followUpItems() : [],
    kinds.includes('alert') ? alertItems() : [],
  ]);

  const items = groups.flat().sort((a, b) => b.date.getTime() - a.date.getTime());
  const offset = (page - 1) * pageSize;
  const slice = items.slice(offset, offset + pageSize);

  return {
    items: slice,
    hasMore: items.length > offset + pageSize,
    page,
    pageSize,
  };
}
