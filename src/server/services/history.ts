import 'server-only';
import type { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AUDIT_ACTION_LABEL } from '@/domain/labels';

export type HistoryEvent = {
  id: string;
  at: Date;
  kind: 'auditoria' | 'comentario' | 'seguimiento';
  action: AuditAction | null;
  actionLabel: string;
  summary: string;
  actorName: string;
  detail: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
};

type HistoryTarget = {
  entity: 'OperationalEntry' | 'Task' | 'FollowUp' | 'Alert' | 'ShiftHandover' | 'Shift' | 'User';
  entityId: string;
};

/**
 * Historial unificado de un registro: creación, modificaciones, comentarios,
 * reasignaciones, seguimientos, cambios de estado y cierre, en orden
 * cronológico. Se alimenta del AuditLog más los objetos asociados.
 */
export async function getHistory(target: HistoryTarget): Promise<HistoryEvent[]> {
  const [logs, comments, followUps] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: target.entity, entityId: target.entityId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 300,
    }),
    prisma.comment.findMany({
      where: {
        deletedAt: null,
        ...(target.entity === 'OperationalEntry' ? { entryId: target.entityId } : {}),
        ...(target.entity === 'Task' ? { taskId: target.entityId } : {}),
        ...(target.entity === 'FollowUp' ? { followUpId: target.entityId } : {}),
        ...(target.entity === 'Alert' ? { alertId: target.entityId } : {}),
        ...(target.entity === 'ShiftHandover' ? { handoverId: target.entityId } : {}),
        ...(target.entity === 'Shift' || target.entity === 'User' ? { id: '__none__' } : {}),
      },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    target.entity === 'OperationalEntry' || target.entity === 'Task'
      ? prisma.followUp.findMany({
          where: {
            deletedAt: null,
            ...(target.entity === 'OperationalEntry'
              ? { entryId: target.entityId }
              : { taskId: target.entityId }),
          },
          include: { owner: { select: { name: true } }, createdBy: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const events: HistoryEvent[] = [];

  for (const log of logs) {
    // Los comentarios se muestran con su texto completo desde la otra fuente.
    if (log.action === 'COMENTAR') continue;
    events.push({
      id: log.id,
      at: log.createdAt,
      kind: 'auditoria',
      action: log.action,
      actionLabel: AUDIT_ACTION_LABEL[log.action],
      summary: log.summary,
      actorName: log.user?.name ?? 'Sistema',
      detail: null,
      before: log.before,
      after: log.after,
      reason: log.reason,
    });
  }

  for (const comment of comments) {
    events.push({
      id: comment.id,
      at: comment.createdAt,
      kind: 'comentario',
      action: null,
      actionLabel: 'Comentario',
      summary: `${comment.author.name} comentó`,
      actorName: comment.author.name,
      detail: comment.body,
      before: null,
      after: null,
      reason: null,
    });
  }

  for (const followUp of followUps) {
    events.push({
      id: followUp.id,
      at: followUp.createdAt,
      kind: 'seguimiento',
      action: null,
      actionLabel: 'Seguimiento',
      summary: followUp.action,
      actorName: followUp.createdBy.name,
      detail: [
        followUp.result ? `Resultado: ${followUp.result}` : null,
        followUp.nextAction ? `Próxima acción: ${followUp.nextAction}` : null,
        followUp.scheduledAt
          ? `Programado: ${followUp.scheduledAt.toLocaleString('es-CL')}`
          : null,
        `Responsable: ${followUp.owner.name}`,
      ]
        .filter(Boolean)
        .join(' · '),
      before: null,
      after: null,
      reason: null,
    });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}
