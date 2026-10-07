import { entryReadWhere } from './entry-visibility';
import 'server-only';
import type { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { AUDIT_ACTION_LABEL } from '@/domain/labels';
import type {CurrentUser} from '@/server/auth/current-user';
import {followUpReadWhere,taskFollowUpReadWhere,alertReadWhere,auditFollowUpReadWhere} from './followup-access';

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
export async function getHistory(target: HistoryTarget,user:Pick<CurrentUser,'id'|'permissions'> & Partial<Pick<CurrentUser,'roleKey'|'departmentId'|'isSystemAdmin'>>): Promise<HistoryEvent[]> {
  const visible=target.entity==='OperationalEntry'?await prisma.operationalEntry.count({where:{id:target.entityId,AND:[entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})]}})
    :target.entity==='Task'?await prisma.task.count({where:{id:target.entityId,AND:[taskFollowUpReadWhere(user)]}})
    :target.entity==='FollowUp'?await prisma.followUp.count({where:{id:target.entityId,AND:[followUpReadWhere(user,true)]}})
    :target.entity==='Alert'?await prisma.alert.count({where:{id:target.entityId,AND:[alertReadWhere(user)]}}):1;
  if(!visible) return [];
  const [logs, comments, followUps] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: target.entity, entityId: target.entityId,AND:[auditFollowUpReadWhere(user)] },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 300,
    }),
    prisma.comment.findMany({
      where: {
        deletedAt: null,
        AND:[{OR:[{entryId:null},{entry:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}]},{OR:[{followUpId:null},{followUp:followUpReadWhere(user)}]},{OR:[{taskId:null},{task:taskFollowUpReadWhere(user)}]},{OR:[{alertId:null},{alert:alertReadWhere(user)}]}],
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
            AND:[followUpReadWhere(user)],
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
          ? `Programado: ${formatDateTime(followUp.scheduledAt)}`
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
