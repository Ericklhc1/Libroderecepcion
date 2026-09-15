import 'server-only';
import { AuditAction, NotificationType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';

type CommentTarget = {
  entryId?: string | null;
  taskId?: string | null;
  followUpId?: string | null;
  alertId?: string | null;
  handoverId?: string | null;
};

/**
 * Comentario sobre cualquier objeto operativo. Se exige exactamente un destino
 * para que no existan comentarios huérfanos ni ambiguos.
 */
export async function addComment(
  user: CurrentUser,
  input: CommentTarget & { body: string },
) {
  const targets = (
    ['entryId', 'taskId', 'followUpId', 'alertId', 'handoverId'] as const
  ).filter((key) => Boolean(input[key]));

  if (targets.length !== 1) {
    throw new RuleError('El comentario debe referirse a un único registro.');
  }

  // Interesados a notificar: autor original y responsable actual.
  const recipients = new Set<string>();
  let summaryRef = '';
  let link = '/';

  if (input.entryId) {
    const entry = await prisma.operationalEntry.findFirst({
      where: { id: input.entryId, deletedAt: null },
      select: { id: true, seq: true, title: true, createdById: true, ownerId: true },
    });
    if (!entry) throw new NotFoundError('El registro no existe.');
    recipients.add(entry.createdById);
    if (entry.ownerId) recipients.add(entry.ownerId);
    summaryRef = `registro #${entry.seq}`;
    link = `/libro/${entry.id}`;
  } else if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, deletedAt: null },
      select: { id: true, seq: true, createdById: true, assigneeId: true },
    });
    if (!task) throw new NotFoundError('La tarea no existe.');
    recipients.add(task.createdById);
    if (task.assigneeId) recipients.add(task.assigneeId);
    summaryRef = `tarea #${task.seq}`;
    link = `/tareas/${task.id}`;
  } else if (input.followUpId) {
    const followUp = await prisma.followUp.findFirst({
      where: { id: input.followUpId, deletedAt: null },
      select: { id: true, action: true, ownerId: true, createdById: true, entryId: true },
    });
    if (!followUp) throw new NotFoundError('El seguimiento no existe.');
    recipients.add(followUp.ownerId);
    recipients.add(followUp.createdById);
    summaryRef = `seguimiento "${followUp.action}"`;
    link = followUp.entryId ? `/libro/${followUp.entryId}` : '/seguimientos';
  } else if (input.alertId) {
    const alert = await prisma.alert.findFirst({
      where: { id: input.alertId, deletedAt: null },
      select: { id: true, title: true, createdById: true },
    });
    if (!alert) throw new NotFoundError('La alerta no existe.');
    if (alert.createdById) recipients.add(alert.createdById);
    summaryRef = `alerta "${alert.title}"`;
    link = '/alertas';
  } else if (input.handoverId) {
    const handover = await prisma.shiftHandover.findUnique({
      where: { id: input.handoverId },
      select: { id: true, issuedById: true, receivedById: true },
    });
    if (!handover) throw new NotFoundError('La entrega no existe.');
    recipients.add(handover.issuedById);
    if (handover.receivedById) recipients.add(handover.receivedById);
    summaryRef = 'entrega de turno';
    link = `/turno/entrega/${handover.id}`;
  }

  const comment = await prisma.comment.create({
    data: {
      body: input.body,
      authorId: user.id,
      entryId: input.entryId ?? null,
      taskId: input.taskId ?? null,
      followUpId: input.followUpId ?? null,
      alertId: input.alertId ?? null,
      handoverId: input.handoverId ?? null,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  const entity = input.entryId
    ? 'OperationalEntry'
    : input.taskId
      ? 'Task'
      : input.followUpId
        ? 'FollowUp'
        : input.alertId
          ? 'Alert'
          : 'ShiftHandover';
  const entityId =
    input.entryId ?? input.taskId ?? input.followUpId ?? input.alertId ?? input.handoverId!;

  await recordAudit({
    entity,
    entityId,
    action: AuditAction.COMENTAR,
    summary: `Comentario de ${user.name} en ${summaryRef}`,
    user,
    after: { body: input.body.slice(0, 500) },
  });

  recipients.delete(user.id);
  await notify(
    Array.from(recipients).map((userId) => ({
      userId,
      type: NotificationType.COMENTARIO,
      title: `${user.name} comentó en ${summaryRef}`,
      body: input.body.slice(0, 200),
      link,
      entity,
      entityId,
    })),
  );

  return comment;
}

export async function softDeleteComment(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const comment = await prisma.comment.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!comment) throw new NotFoundError('El comentario no existe.');
  if (comment.authorId !== user.id && !user.permissions.includes('entry.delete')) {
    throw new RuleError('Sólo el autor o un supervisor puede eliminar un comentario.');
  }
  const deleted = await prisma.comment.update({
    where: { id: input.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
  });
  await recordAudit({
    entity: 'Comment',
    entityId: input.id,
    action: AuditAction.ELIMINAR,
    summary: 'Comentario eliminado',
    user,
    before: { body: comment.body.slice(0, 200) },
    reason: input.reason,
  });
  return deleted;
}

/** Comentarios de un objeto, del más antiguo al más reciente. */
export async function listComments(target: CommentTarget) {
  return prisma.comment.findMany({
    where: {
      deletedAt: null,
      ...(target.entryId ? { entryId: target.entryId } : {}),
      ...(target.taskId ? { taskId: target.taskId } : {}),
      ...(target.followUpId ? { followUpId: target.followUpId } : {}),
      ...(target.alertId ? { alertId: target.alertId } : {}),
      ...(target.handoverId ? { handoverId: target.handoverId } : {}),
    },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
