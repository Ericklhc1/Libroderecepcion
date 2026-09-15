import 'server-only';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditAction,
  FollowUpStatus,
  NotificationType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { diffFields, recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import { FOLLOWUP_STATUS_LABEL } from '@/domain/labels';
import { assertAssignable } from './users';

export const followUpInclude = {
  owner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  entry: { select: { id: true, seq: true, title: true, type: true, status: true } },
  task: { select: { id: true, seq: true, title: true, status: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.FollowUpInclude;

export type FollowUpWithRelations = Prisma.FollowUpGetPayload<{
  include: typeof followUpInclude;
}>;

/**
 * Crea un seguimiento. Debe colgar de un registro o de una tarea: un
 * seguimiento huérfano no aporta trazabilidad y queda prohibido.
 */
export async function createFollowUp(
  user: CurrentUser,
  input: {
    entryId?: string | null;
    taskId?: string | null;
    action: string;
    result?: string | null;
    nextAction?: string | null;
    scheduledAt?: Date | null;
    ownerId?: string | null;
    notes?: string | null;
  },
) {
  if (!input.entryId && !input.taskId) {
    throw new RuleError('El seguimiento debe asociarse a un registro o a una tarea.');
  }
  const ownerId = input.ownerId ?? user.id;
  await assertAssignable(ownerId);

  if (input.entryId) {
    const entry = await prisma.operationalEntry.count({
      where: { id: input.entryId, deletedAt: null },
    });
    if (entry === 0) throw new NotFoundError('El registro asociado no existe.');
  }
  if (input.taskId) {
    const task = await prisma.task.count({ where: { id: input.taskId, deletedAt: null } });
    if (task === 0) throw new NotFoundError('La tarea asociada no existe.');
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.followUp.create({
      data: {
        entryId: input.entryId ?? null,
        taskId: input.taskId ?? null,
        action: input.action,
        result: input.result ?? null,
        nextAction: input.nextAction ?? null,
        scheduledAt: input.scheduledAt ?? null,
        notes: input.notes ?? null,
        ownerId,
        createdById: user.id,
      },
      include: followUpInclude,
    });

    // El registro asociado queda marcado como "con seguimiento".
    if (created.entryId) {
      await tx.operationalEntry.update({
        where: { id: created.entryId },
        data: { requiresFollowUp: true },
      });
    }

    await recordAudit(
      {
        entity: 'FollowUp',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `Seguimiento creado: ${created.action}`,
        user,
        after: {
          action: created.action,
          nextAction: created.nextAction,
          scheduledAt: created.scheduledAt,
          ownerId: created.ownerId,
          entryId: created.entryId,
          taskId: created.taskId,
        },
      },
      tx,
    );

    if (ownerId !== user.id) {
      await notify(
        {
          userId: ownerId,
          type: NotificationType.ACCION_REQUERIDA,
          title: `Seguimiento a tu cargo: ${created.action}`,
          body: created.scheduledAt
            ? `Programado para el ${created.scheduledAt.toLocaleString('es-CL')}.`
            : 'Sin fecha programada.',
          link: created.entryId ? `/libro/${created.entryId}` : `/seguimientos`,
          entity: 'FollowUp',
          entityId: created.id,
        },
        tx,
      );
    }

    return created;
  });
}

export async function updateFollowUp(
  user: CurrentUser,
  input: {
    id: string;
    result?: string | null;
    nextAction?: string | null;
    scheduledAt?: Date | null;
    notes?: string | null;
    status?: FollowUpStatus;
    ownerId?: string | null;
  },
) {
  const current = await prisma.followUp.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('El seguimiento no existe o fue eliminado.');

  const isOwner = current.ownerId === user.id || current.createdById === user.id;
  if (!isOwner && !user.permissions.includes('followup.manage')) {
    throw new RuleError('Sólo el responsable del seguimiento o un supervisor puede modificarlo.');
  }
  if (input.ownerId) await assertAssignable(input.ownerId);

  if (input.status === FollowUpStatus.CUMPLIDO && !(input.result ?? current.result)) {
    throw new RuleError('Para cerrar un seguimiento debes registrar el resultado.');
  }

  const after: Record<string, unknown> = {};
  for (const key of ['result', 'nextAction', 'scheduledAt', 'notes', 'status', 'ownerId'] as const) {
    const value = input[key];
    if (value !== undefined) after[key] = value;
  }
  const changes = diffFields(
    current as unknown as Record<string, unknown>,
    after,
    Object.keys(after),
  );
  if (changes.changed.length === 0) return current;

  return prisma.$transaction(async (tx) => {
    const closing =
      input.status === FollowUpStatus.CUMPLIDO || input.status === FollowUpStatus.CANCELADO;
    const updated = await tx.followUp.update({
      where: { id: input.id },
      data: {
        ...after,
        completedAt: closing ? new Date() : null,
      } as Prisma.FollowUpUpdateInput,
      include: followUpInclude,
    });

    if (closing) {
      await tx.alert.updateMany({
        where: { followUpId: updated.id, auto: true, status: { not: AlertStatus.RESUELTA } },
        data: {
          status: AlertStatus.RESUELTA,
          resolvedAt: new Date(),
          resolvedById: user.id,
          resolutionNote: 'Seguimiento cerrado.',
        },
      });
    }

    await recordAudit(
      {
        entity: 'FollowUp',
        entityId: updated.id,
        action: input.status
          ? input.status === FollowUpStatus.CUMPLIDO
            ? AuditAction.CERRAR
            : AuditAction.CAMBIO_ESTADO
          : AuditAction.EDITAR,
        summary: input.status
          ? `Seguimiento "${updated.action}" → ${FOLLOWUP_STATUS_LABEL[input.status]}`
          : `Seguimiento "${updated.action}" actualizado (${changes.changed.join(', ')})`,
        user,
        before: changes.before,
        after: changes.after,
      },
      tx,
    );

    return updated;
  });
}

/**
 * Genera la alerta de seguimiento vencido. El motor de alertas hace lo mismo de
 * forma masiva; esta función permite forzarlo al vuelo para un seguimiento.
 */
export async function raiseOverdueFollowUpAlert(followUpId: string) {
  const followUp = await prisma.followUp.findFirst({
    where: { id: followUpId, deletedAt: null },
    select: { id: true, action: true, scheduledAt: true, status: true, entryId: true },
  });
  if (!followUp || !followUp.scheduledAt) return null;
  if (followUp.scheduledAt.getTime() > Date.now()) return null;
  if (followUp.status !== FollowUpStatus.PENDIENTE && followUp.status !== FollowUpStatus.VENCIDO) {
    return null;
  }

  await prisma.followUp.update({
    where: { id: followUp.id },
    data: { status: FollowUpStatus.VENCIDO },
  });

  const dedupeKey = `followup-overdue:${followUp.id}`;
  const existing = await prisma.alert.findUnique({ where: { dedupeKey } });
  if (existing) return existing;

  return prisma.alert.create({
    data: {
      dedupeKey,
      type: AlertType.SEGUIMIENTO_VENCIDO,
      level: AlertLevel.ATENCION,
      title: `Seguimiento vencido: ${followUp.action}`,
      message: `Estaba programado para el ${followUp.scheduledAt.toLocaleString('es-CL')}.`,
      dueAt: followUp.scheduledAt,
      followUpId: followUp.id,
      entryId: followUp.entryId,
      auto: true,
    },
  });
}

export async function softDeleteFollowUp(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const current = await prisma.followUp.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('El seguimiento no existe o ya fue eliminado.');
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.followUp.update({
      where: { id: input.id },
      data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
    });
    await recordAudit(
      {
        entity: 'FollowUp',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica del seguimiento "${current.action}"`,
        user,
        after: { deletedAt: deleted.deletedAt },
        reason: input.reason,
      },
      tx,
    );
    return deleted;
  });
}

export async function restoreFollowUp(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
) {
  const current = await prisma.followUp.findFirst({
    where: { id: input.id, NOT: { deletedAt: null } },
  });
  if (!current) throw new NotFoundError('El seguimiento no está eliminado.');
  return prisma.$transaction(async (tx) => {
    const restored = await tx.followUp.update({
      where: { id: input.id },
      data: { deletedAt: null, deletedById: null, deletionReason: null },
    });
    await recordAudit(
      {
        entity: 'FollowUp',
        entityId: input.id,
        action: AuditAction.RESTAURAR,
        summary: `Seguimiento "${current.action}" restaurado`,
        user,
        before: { deletedAt: current.deletedAt },
        after: { deletedAt: null },
        reason: input.reason ?? null,
      },
      tx,
    );
    return restored;
  });
}
