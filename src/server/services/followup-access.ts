import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError } from '@/server/errors';
import { prisma } from '@/lib/prisma';

export type FollowUpReader = Pick<CurrentUser, 'id' | 'permissions'>;

/** Lectura canónica: propiedad, asignación y gestión nunca abren privados ajenos. */
export function followUpReadWhere(user: FollowUpReader, options: { includeDeleted?: boolean; onlyDeleted?: boolean } = {}): Prisma.FollowUpWhereInput {
  if (!user?.id) throw new ForbiddenError('Se requiere identidad para consultar seguimientos.');
  if ((options.includeDeleted || options.onlyDeleted) && !user.permissions.includes('entry.restore')) {
    throw new ForbiddenError('No tienes autorización para consultar registros eliminados.');
  }
  const manager = user.permissions.includes('supervision.followup.manage');
  return {
    AND: [
      { OR: [
        { visibility: 'PRIVADO', createdById: user.id },
        ...(manager ? [{ visibility: 'SUPERVISION' as const }] : []),
        { visibility: 'OPERATIVO', ...(manager ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) },
      ] },
      ...(options.onlyDeleted ? [{ deletedAt: { not: null } }] : options.includeDeleted ? [] : [{ deletedAt: null }]),
    ],
  };
}

/** El historial técnico tampoco concede acceso al contenido reservado. */
export async function followUpAuditVisibility(user: FollowUpReader): Promise<Prisma.AuditLogWhereInput> {
  const readable = await prisma.followUp.findMany({
    where: followUpReadWhere(user, { includeDeleted: user.permissions.includes('entry.restore') }),
    select: { id: true },
  });
  const alerts = await prisma.alert.findMany({ where: { OR: [{ followUpId: null }, { followUpId: { in: readable.map(row => row.id) } }] }, select: { id: true } });
  return { OR: [{ entity: { notIn: ['FollowUp', 'Alert'] } }, { entity: 'FollowUp', entityId: { in: readable.map(row => row.id) } }, { entity: 'Alert', entityId: { in: alerts.map(row => row.id) } }] };
}

/** Proyecciones de alertas heredan la privacidad de su seguimiento de origen. */
export function followUpAlertVisibility(user: FollowUpReader): Prisma.AlertWhereInput {
  return { OR: [{ followUpId: null }, { followUp: followUpReadWhere(user) }] };
}

/** Avisos históricos se filtran al leer; no se borran ni reescriben. */
export async function followUpNotificationVisibility(user: FollowUpReader, client: PrismaClient | Prisma.TransactionClient = prisma): Promise<Prisma.NotificationWhereInput> {
  const [followUps, alerts] = await Promise.all([
    client.followUp.findMany({ where: followUpReadWhere(user), select: { id: true } }),
    client.alert.findMany({ where: followUpAlertVisibility(user), select: { id: true } }),
  ]);
  const alarms = await client.operationalAlarm.findMany({ where: { OR: [{ sourceEntity: null }, { sourceEntity: { not: 'FollowUp' } }, { sourceEntity: 'FollowUp', sourceId: { in: followUps.map(row => row.id) } }] }, select: { id: true } });
  const recipients = await client.operationalAlarmRecipient.findMany({ where: { userId: user.id, alarmId: { in: alarms.map(row => row.id) } }, select: { id: true } });
  return { OR: [
    { entity: null }, { entity: { notIn: ['FollowUp', 'Alert', 'OperationalAlarm', 'OperationalAlarmRecipient'] } },
    { entity: 'OperationalAlarm', entityId: { in: alarms.map(row => row.id) } },
    { entity: 'OperationalAlarmRecipient', entityId: { in: recipients.map(row => row.id) } },
    { entity: 'FollowUp', entityId: { in: followUps.map(row => row.id) } },
    { entity: 'Alert', entityId: { in: alerts.map(row => row.id) } },
  ] };
}

/** Referencias congeladas se proyectan al leer, conservando el historial almacenado. */
export async function visibleHandoverItems<T extends { refType: string | null; refId: string | null }>(user: FollowUpReader, items: T[]): Promise<T[]> {
  const refs = items.filter(item => item.refType === 'followup' || item.refType === 'alert').map(item => item.refId).filter((id): id is string => Boolean(id));
  if (!refs.length) return items;
  const readable = await prisma.followUp.findMany({ where: { AND: [followUpReadWhere(user)], id: { in: refs } }, select: { id: true } });
  const alerts = await prisma.alert.findMany({ where: { AND: [followUpAlertVisibility(user)], id: { in: refs } }, select: { id: true } });
  const ids = new Set([...readable, ...alerts].map(row => row.id));
  return items.filter(item => (item.refType !== 'followup' && item.refType !== 'alert') || (item.refId !== null && ids.has(item.refId)));
}

export async function followUpAlarmVisibility(user: FollowUpReader): Promise<Prisma.OperationalAlarmWhereInput> {
  const rows = await prisma.followUp.findMany({ where: followUpReadWhere(user), select: { id: true } });
  return { OR: [{ sourceEntity: null }, { sourceEntity: { not: 'FollowUp' } }, { sourceEntity: 'FollowUp', sourceId: { in: rows.map(row => row.id) } }] };
}
