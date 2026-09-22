import 'server-only';
import {
  AuditAction,
  EntryStatus,
  EntryType,
  NotificationType,
  Severity,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { diffFields, recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import { ENTRY_OPEN_STATUSES, ENTRY_STATUS_LABEL, ENTRY_TYPE_LABEL } from '@/domain/labels';
import { normalizeTags } from '@/domain/tags';
import { getMyOpenShift } from './shifts';
import { assertAssignable, listSupervisorIds } from './users';

export const entryInclude = {
  createdBy: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, key: true } },
  room: { select: { id: true, number: true, floor: true } },
  shift: { select: { id: true, type: true, date: true } },
  guest: { select: { id: true, fullName: true, roomNumber: true, vip: true } },
  reservation: { select: { id: true, code: true, roomNumber: true, status: true } },
  stay: {
    select: {
      id: true,
      reservationId: true,
      status: true,
      stage: true,
      room: { select: { id: true, number: true } },
    },
  },
  _count: { select: { comments: true, tasks: true, followUps: true, attachments: true } },
} satisfies Prisma.OperationalEntryInclude;

export type EntryWithRelations = Prisma.OperationalEntryGetPayload<{
  include: typeof entryInclude;
}>;

type EntryCreateInput = {
  type: EntryType;
  title: string;
  description: string;
  category?: string | null;
  departmentId?: string | null;
  roomId?: string | null;
  priority: Prisma.OperationalEntryCreateInput['priority'];
  ownerId?: string | null;
  occurredAt?: Date | null;
  dueAt?: Date | null;
  tags: string[];
  requiresFollowUp: boolean;
  guestId?: string | null;
  reservationId?: string | null;
  stayId?: string | null;
  severity?: Severity | undefined;
  impact?: Prisma.OperationalEntryCreateInput['impact'];
  immediateAction?: string | null;
};

/**
 * Crea un registro del libro operativo.
 *
 * Las incidencias son el mismo modelo con campos adicionales (gravedad,
 * impacto, acción inmediata, causa y resolución): un único libro, sin módulos
 * duplicados. Se exige gravedad para que una incidencia nunca quede sin
 * clasificar.
 */
export async function createEntry(user: CurrentUser, input: EntryCreateInput) {
  if (input.ownerId) await assertAssignable(input.ownerId);

  if (input.type === EntryType.INCIDENCIA && !input.severity) {
    throw new RuleError('Una incidencia requiere indicar su gravedad.');
  }

  const shift = await getMyOpenShift(user.id);

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.operationalEntry.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description,
        category: input.category ?? null,
        departmentId: input.departmentId ?? null,
        roomId: null,
        priority: input.priority,
        ownerId: input.ownerId ?? null,
        shiftId: shift?.id ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        dueAt: input.dueAt ?? null,
        tags: normalizeTags(input.tags),
        requiresFollowUp: input.requiresFollowUp,
        guestId: null,
        reservationId: null,
        stayId: null,
        severity: input.type === EntryType.INCIDENCIA ? (input.severity ?? null) : null,
        impact: input.type === EntryType.INCIDENCIA ? (input.impact ?? null) : null,
        immediateAction: input.immediateAction ?? null,
        createdById: user.id,
      },
      include: entryInclude,
    });

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `${ENTRY_TYPE_LABEL[created.type]} #${created.seq}: ${created.title}`,
        user,
        after: {
          type: created.type,
          title: created.title,
          priority: created.priority,
          severity: created.severity,
          status: created.status,
          ownerId: created.ownerId,
          departmentId: created.departmentId,
          category: created.category,
        },
      },
      tx,
    );

    if (created.ownerId && created.ownerId !== user.id) {
      await notify(
        {
          userId: created.ownerId,
          type: NotificationType.ACCION_REQUERIDA,
          title: `Te asignaron un registro: ${created.title}`,
          body: `${ENTRY_TYPE_LABEL[created.type]} #${created.seq} creada por ${user.name}.`,
          link: `/libro/${created.id}`,
          entity: 'OperationalEntry',
          entityId: created.id,
        },
        tx,
      );
    }

    if (created.severity === Severity.CRITICA) {
      const supervisors = await listSupervisorIds();
      await notify(
        supervisors
          .filter((id) => id !== user.id)
          .map((id) => ({
            userId: id,
            type: NotificationType.INCIDENCIA_CRITICA,
            title: `Incidencia crítica #${created.seq}: ${created.title}`,
            body: created.description.slice(0, 200),
            link: `/libro/${created.id}`,
            entity: 'OperationalEntry',
            entityId: created.id,
          })),
        tx,
      );
    }

    return created;
  });

  return entry;
}

const EDITABLE_FIELDS = [
  'title',
  'description',
  'category',
  'departmentId',
  'priority',
  'ownerId',
  'dueAt',
  'occurredAt',
  'requiresFollowUp',
  'severity',
  'impact',
  'immediateAction',
  'rootCause',
  'resolution',
  'tags',
] as const;

export async function getEntry(id: string): Promise<EntryWithRelations> {
  const entry = await prisma.operationalEntry.findUnique({
    where: { id },
    include: entryInclude,
  });
  if (!entry) throw new NotFoundError('El registro no existe.');
  return entry;
}

export async function updateEntry(
  user: CurrentUser,
  input: { id: string } & Partial<EntryCreateInput> & {
      rootCause?: string | null;
      resolution?: string | null;
    },
) {
  const current = await prisma.operationalEntry.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('El registro no existe o fue eliminado.');
  if (current.status === EntryStatus.CERRADO && !user.permissions.includes('entry.reopen')) {
    throw new RuleError('El registro está cerrado. Reábrelo para poder editarlo.');
  }
  if (input.ownerId) await assertAssignable(input.ownerId);

  const data: Prisma.OperationalEntryUpdateInput = {};
  const after: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const raw = (input as Record<string, unknown>)[field];
    if (raw === undefined) continue;
    const value = field === 'tags' ? normalizeTags(raw as string[]) : raw;
    (data as Record<string, unknown>)[field] = value;
    after[field] = value;
  }

  if (Object.keys(data).length === 0) return current;

  const changes = diffFields(
    current as unknown as Record<string, unknown>,
    after,
    Object.keys(after),
  );
  if (changes.changed.length === 0) return current;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.operationalEntry.update({
      where: { id: input.id },
      data,
      include: entryInclude,
    });

    const ownerChanged = changes.changed.includes('ownerId');
    const priorityChanged = changes.changed.includes('priority');

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: updated.id,
        action: ownerChanged
          ? AuditAction.CAMBIO_RESPONSABLE
          : priorityChanged
            ? AuditAction.CAMBIO_PRIORIDAD
            : AuditAction.EDITAR,
        summary: `Registro #${updated.seq} actualizado (${changes.changed.join(', ')})`,
        user,
        before: changes.before,
        after: changes.after,
      },
      tx,
    );

    if (ownerChanged && updated.ownerId && updated.ownerId !== user.id) {
      await notify(
        {
          userId: updated.ownerId,
          type: NotificationType.RESPONSABLE_CAMBIADO,
          title: `Ahora eres responsable de #${updated.seq}`,
          body: updated.title,
          link: `/libro/${updated.id}`,
          entity: 'OperationalEntry',
          entityId: updated.id,
        },
        tx,
      );
    }

    return updated;
  });
}

export async function changeEntryStatus(
  user: CurrentUser,
  input: {
    id: string;
    status: EntryStatus;
    reason?: string | null;
    resolution?: string | null;
    rootCause?: string | null;
  },
) {
  const current = await prisma.operationalEntry.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('El registro no existe o fue eliminado.');
  if (current.status === input.status) return current;

  const closing =
    input.status === EntryStatus.CERRADO || input.status === EntryStatus.RESUELTO;
  const reopening =
    (current.status === EntryStatus.CERRADO || current.status === EntryStatus.RESUELTO) &&
    ENTRY_OPEN_STATUSES.includes(input.status);

  if (closing) {
    const permission =
      current.type === EntryType.INCIDENCIA ? 'incident.close' : 'entry.close';
    if (!user.permissions.includes(permission) && !user.permissions.includes('entry.close')) {
      throw new RuleError('No tienes permiso para cerrar este registro.');
    }
    if (current.type === EntryType.INCIDENCIA && input.status === EntryStatus.CERRADO) {
      const resolution = input.resolution ?? current.resolution;
      if (!resolution) {
        throw new RuleError(
          'Para cerrar una incidencia debes registrar cómo se resolvió.',
        );
      }
    }
    const openFollowUps = await prisma.followUp.count({
      where: { entryId: current.id, deletedAt: null, status: { in: ['PENDIENTE', 'VENCIDO'] } },
    });
    if (openFollowUps > 0 && input.status === EntryStatus.CERRADO) {
      throw new RuleError(
        `No puedes cerrar el registro: tiene ${openFollowUps} seguimiento(s) sin cerrar.`,
      );
    }
  }

  if (reopening && !user.permissions.includes('entry.reopen')) {
    throw new RuleError('No tienes permiso para reabrir registros.');
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.operationalEntry.update({
      where: { id: input.id },
      data: {
        status: input.status,
        resolution: input.resolution ?? current.resolution,
        rootCause: input.rootCause ?? current.rootCause,
        closedAt: input.status === EntryStatus.CERRADO ? now : null,
        closedById: input.status === EntryStatus.CERRADO ? user.id : null,
        reopenedAt: reopening ? now : current.reopenedAt,
      },
      include: entryInclude,
    });

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: updated.id,
        action:
          input.status === EntryStatus.CERRADO
            ? AuditAction.CERRAR
            : reopening
              ? AuditAction.REABRIR
              : AuditAction.CAMBIO_ESTADO,
        summary: `Registro #${updated.seq}: ${ENTRY_STATUS_LABEL[current.status]} → ${ENTRY_STATUS_LABEL[input.status]}`,
        user,
        before: { status: current.status },
        after: { status: input.status, resolution: updated.resolution },
        reason: input.reason ?? null,
      },
      tx,
    );

    const interested = new Set<string>([current.createdById]);
    if (current.ownerId) interested.add(current.ownerId);
    interested.delete(user.id);
    await notify(
      Array.from(interested).map((userId) => ({
        userId,
        type: NotificationType.ACCION_REQUERIDA,
        title: `#${updated.seq} pasó a ${ENTRY_STATUS_LABEL[input.status]}`,
        body: updated.title,
        link: `/libro/${updated.id}`,
        entity: 'OperationalEntry',
        entityId: updated.id,
      })),
      tx,
    );

    return updated;
  });
}

export async function softDeleteEntry(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const current = await prisma.operationalEntry.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('El registro no existe o ya fue eliminado.');

  return prisma.$transaction(async (tx) => {
    const deleted = await tx.operationalEntry.update({
      where: { id: input.id },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletionReason: input.reason,
      },
    });
    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica del registro #${current.seq}: ${current.title}`,
        user,
        before: { deletedAt: null },
        after: { deletedAt: deleted.deletedAt },
        reason: input.reason,
      },
      tx,
    );
    return deleted;
  });
}

export async function restoreEntry(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
) {
  const current = await prisma.operationalEntry.findFirst({
    where: { id: input.id, NOT: { deletedAt: null } },
  });
  if (!current) throw new NotFoundError('El registro no está eliminado.');

  return prisma.$transaction(async (tx) => {
    const restored = await tx.operationalEntry.update({
      where: { id: input.id },
      data: { deletedAt: null, deletedById: null, deletionReason: null },
    });
    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: input.id,
        action: AuditAction.RESTAURAR,
        summary: `Registro #${current.seq} restaurado`,
        user,
        before: { deletedAt: current.deletedAt, deletionReason: current.deletionReason },
        after: { deletedAt: null },
        reason: input.reason ?? null,
      },
      tx,
    );
    return restored;
  });
}
