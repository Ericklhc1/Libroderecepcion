import 'server-only';

import {
  AuditAction,
  NotificationType,
  OperationalAlarmKind,
  OperationalAlarmScope,
  OperationalAlarmStatus,
  ShiftStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RuleError, NotFoundError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { scheduleWebPushForUsers } from '@/server/services/web-push-scheduler';


const MAX_ACTIVE_PER_CREATOR = 100;

export type AlarmCreateInput = {
  kind: OperationalAlarmKind;
  scope: OperationalAlarmScope;
  title: string;
  note?: string | null;
  dueAt: Date;
  recipientIds?: string[];
  sourceEntity?: string | null;
  sourceId?: string | null;
  sourceLink?: string | null;
};

export async function listAlarmCandidates() {
  return prisma.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      hiddenFromSelectors: false,
      role: { operational: true },
    },
    select: { id: true, name: true, username: true, role: { select: { name: true } } },
    orderBy: [{ name: 'asc' }],
  });
}

export async function listMyOperationalAlarms(userId: string, take = 60) {
  return prisma.operationalAlarm.findMany({
    where: {
      OR: [{ createdById: userId }, { recipients: { some: { userId } } }],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      recipients: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
      originShift: { select: { id: true, type: true, date: true, status: true } },
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'desc' }],
    take: Math.max(1, Math.min(take, 100)),
  });
}

async function resolveRecipients(
  scope: OperationalAlarmScope,
  requestedIds: string[],
): Promise<string[]> {
  if (scope === OperationalAlarmScope.GLOBAL) {
    const users = await prisma.user.findMany({
      where: { active: true, deletedAt: null, role: { operational: true } },
      select: { id: true },
    });
    if (users.length === 0) throw new RuleError('No hay usuarios activos para recibir la alerta.');
    return users.map((row) => row.id);
  }

  const unique = Array.from(new Set(requestedIds.filter(Boolean)));
  if (scope === OperationalAlarmScope.INDIVIDUAL && unique.length !== 1) {
    throw new RuleError('Una alerta individual debe tener exactamente una persona destinataria.');
  }
  if (scope === OperationalAlarmScope.GRUPO && unique.length < 2) {
    throw new RuleError('Una alerta grupal requiere al menos dos destinatarios.');
  }

  const valid = await prisma.user.findMany({
    where: {
      id: { in: unique },
      active: true,
      deletedAt: null,
      hiddenFromSelectors: false,
    },
    select: { id: true },
  });
  if (valid.length !== unique.length) {
    throw new RuleError('Uno o más destinatarios ya no están activos.');
  }
  return valid.map((row) => row.id);
}

export async function createOperationalAlarm(user: CurrentUser, input: AlarmCreateInput) {
  if (
    input.scope === OperationalAlarmScope.GLOBAL &&
    !user.permissions.includes('shift.manage') &&
    !user.isSystemAdmin
  ) {
    throw new RuleError('Sólo Supervisión puede emitir una alerta global.');
  }
  if (!input.title.trim()) throw new RuleError('Escribe qué debe recordar la alerta.');
  if (input.dueAt.getTime() <= Date.now()) {
    throw new RuleError('La alerta debe programarse para un momento futuro.');
  }

  const activeCount = await prisma.operationalAlarm.count({
    where: { createdById: user.id, status: OperationalAlarmStatus.ACTIVA },
  });
  if (activeCount >= MAX_ACTIVE_PER_CREATOR) {
    throw new RuleError('Tienes demasiadas alertas activas. Cierra o cancela alguna antes de crear otra.');
  }

  const recipientIds = await resolveRecipients(input.scope, input.recipientIds ?? []);
  const originShift =
    input.kind === OperationalAlarmKind.TIMER
      ? await prisma.shift.findFirst({
          where: {
            status: {
              in: [
                ShiftStatus.INICIADO,
                ShiftStatus.ACTIVO,
                ShiftStatus.PREPARANDO_ENTREGA,
                ShiftStatus.ENTREGA_ENVIADA,
              ],
            },
            assignments: { some: { userId: user.id } },
          },
          select: { id: true },
          orderBy: [{ actualStart: 'desc' }, { createdAt: 'desc' }],
        })
      : null;

  const alarm = await prisma.$transaction(async (tx) => {
    const created = await tx.operationalAlarm.create({
      data: {
        kind: input.kind,
        scope: input.scope,
        title: input.title.trim(),
        note: input.note?.trim() || null,
        dueAt: input.dueAt,
        createdById: user.id,
        originShiftId: originShift?.id ?? null,
        sourceEntity: input.sourceEntity?.trim() || null,
        sourceId: input.sourceId?.trim() || null,
        sourceLink: input.sourceLink?.trim() || null,
        recipients: {
          createMany: {
            data: recipientIds.map((userId) => ({ userId })),
          },
        },
      },
      include: {
        recipients: { select: { id: true, userId: true } },
      },
    });

    await recordAudit(
      {
        entity: 'OperationalAlarm',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary:
          `${created.kind === OperationalAlarmKind.TIMER ? 'Timer' : 'Recordatorio'} «${created.title}» creado para ${created.recipients.length} destinatario(s)`,
        user,
        after: {
          kind: created.kind,
          scope: created.scope,
          dueAt: created.dueAt,
          originShiftId: created.originShiftId,
          sourceEntity: created.sourceEntity,
          sourceId: created.sourceId,
          sourceLink: created.sourceLink,
          recipients: created.recipients.map((row) => row.userId),
        },
      },
      tx,
    );
    return created;
  });

  return alarm;
}

export async function updateOperationalAlarm(
  user: CurrentUser,
  input: {
    id: string;
    title: string;
    note?: string | null;
    dueAt: Date;
  },
) {
  const alarm = await prisma.operationalAlarm.findUnique({
    where: { id: input.id },
  });
  if (!alarm) throw new NotFoundError('La alerta ya no existe.');
  if (
    alarm.createdById !== user.id &&
    !user.permissions.includes('shift.manage') &&
    !user.isSystemAdmin
  ) {
    throw new RuleError('Sólo quien creó la alerta o Supervisión puede editarla.');
  }
  if (alarm.status !== OperationalAlarmStatus.ACTIVA) {
    throw new RuleError('Sólo se pueden editar alertas activas.');
  }
  if (!input.title.trim()) throw new RuleError('Escribe el motivo de la alerta.');
  if (input.dueAt.getTime() <= Date.now()) {
    throw new RuleError('La alerta debe programarse para un momento futuro.');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.operationalAlarm.update({
      where: { id: alarm.id },
      data: {
        title: input.title.trim(),
        note: input.note?.trim() || null,
        dueAt: input.dueAt,
      },
    });
    // Si ya se había disparado, editarla rearma a los destinatarios que todavía
    // no la han atendido para que vuelva a dispararse en la nueva fecha.
    await tx.operationalAlarmRecipient.updateMany({
      where: { alarmId: alarm.id, acknowledgedAt: null },
      data: { lastTriggeredAt: null, snoozedUntil: null },
    });
    await tx.notification.updateMany({
      where: {
        entity: 'OperationalAlarmRecipient',
        entityId: {
          in: (
            await tx.operationalAlarmRecipient.findMany({
              where: { alarmId: alarm.id },
              select: { id: true },
            })
          ).map((row) => row.id),
        },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    await recordAudit(
      {
        entity: 'OperationalAlarm',
        entityId: alarm.id,
        action: AuditAction.EDITAR,
        summary: `Alerta «${updated.title}» actualizada por ${user.name}`,
        user,
        before: { title: alarm.title, note: alarm.note, dueAt: alarm.dueAt },
        after: { title: updated.title, note: updated.note, dueAt: updated.dueAt },
      },
      tx,
    );
    return updated;
  });
}

export async function countMyActiveOperationalAlarms(userId: string): Promise<number> {
  return prisma.operationalAlarm.count({
    where: {
      status: OperationalAlarmStatus.ACTIVA,
      recipients: { some: { userId, acknowledgedAt: null } },
    },
  });
}

export async function cancelOperationalAlarm(user: CurrentUser, alarmId: string) {
  const alarm = await prisma.operationalAlarm.findUnique({
    where: { id: alarmId },
    include: { recipients: { select: { id: true } } },
  });
  if (!alarm) throw new NotFoundError('La alerta ya no existe.');
  if (alarm.createdById !== user.id && !user.permissions.includes('shift.manage') && !user.isSystemAdmin) {
    throw new RuleError('Sólo quien creó la alerta o Supervisión puede cancelarla.');
  }
  if (alarm.status !== OperationalAlarmStatus.ACTIVA) return alarm;

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.operationalAlarm.update({
      where: { id: alarm.id },
      data: { status: OperationalAlarmStatus.CANCELADA, cancelledAt: now },
    });
    await tx.notification.updateMany({
      where: {
        entity: 'OperationalAlarmRecipient',
        entityId: { in: alarm.recipients.map((row) => row.id) },
        readAt: null,
      },
      data: { readAt: now },
    });
    await recordAudit(
      {
        entity: 'OperationalAlarm',
        entityId: alarm.id,
        action: AuditAction.CERRAR,
        summary: `${alarm.kind === OperationalAlarmKind.TIMER ? 'Timer' : 'Recordatorio'} cancelado por ${user.name}`,
        user,
        before: { status: alarm.status },
        after: { status: OperationalAlarmStatus.CANCELADA },
      },
      tx,
    );
    return updated;
  });
}

export async function dispatchDueAlarmsForUser(userId: string, now = new Date()) {
  const due = await prisma.operationalAlarmRecipient.findMany({
    where: {
      userId,
      acknowledgedAt: null,
      lastTriggeredAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      alarm: {
        status: OperationalAlarmStatus.ACTIVA,
        dueAt: { lte: now },
      },
    },
    include: {
      alarm: {
        select: {
          id: true,
          kind: true,
          title: true,
          note: true,
          dueAt: true,
          sourceLink: true,
          createdBy: { select: { name: true } },
        },
      },
    },
    orderBy: { alarm: { dueAt: 'asc' } },
    take: 10,
  });

  let dispatched = 0;
  for (const recipient of due) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.operationalAlarmRecipient.updateMany({
        where: {
          id: recipient.id,
          acknowledgedAt: null,
          lastTriggeredAt: null,
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
          alarm: { status: OperationalAlarmStatus.ACTIVA },
        },
        data: { lastTriggeredAt: now, snoozedUntil: null },
      });
      if (claimed.count === 0) return;

      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.ALARMA,
          title: recipient.alarm.title,
          body: [
            recipient.alarm.kind === OperationalAlarmKind.TIMER ? 'Timer finalizado.' : 'Recordatorio.',
            recipient.alarm.note,
            `Asignado por ${recipient.alarm.createdBy.name}.`,
          ]
            .filter(Boolean)
            .join(' '),
          link: recipient.alarm.sourceLink ?? '/alertas',
          entity: 'OperationalAlarmRecipient',
          entityId: recipient.id,
        },
      });
      dispatched += 1;
      scheduleWebPushForUsers([userId]);
    });
  }
  return dispatched;
}

export async function dispatchDueAlarmsForAllUsers(now = new Date()): Promise<{
  users: number;
  dispatched: number;
}> {
  const dueUsers = await prisma.operationalAlarmRecipient.findMany({
    where: {
      acknowledgedAt: null,
      lastTriggeredAt: null,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      alarm: {
        status: OperationalAlarmStatus.ACTIVA,
        dueAt: { lte: now },
      },
      user: { active: true, deletedAt: null },
    },
    distinct: ['userId'],
    select: { userId: true },
    take: 200,
  });

  let dispatched = 0;
  for (const row of dueUsers) {
    dispatched += await dispatchDueAlarmsForUser(row.userId, now);
  }
  return { users: dueUsers.length, dispatched };
}

export async function acknowledgeOperationalAlarm(user: CurrentUser, recipientId: string) {
  const recipient = await prisma.operationalAlarmRecipient.findUnique({
    where: { id: recipientId },
    include: { alarm: { include: { recipients: { select: { id: true, acknowledgedAt: true } } } } },
  });
  if (!recipient || recipient.userId !== user.id) {
    throw new NotFoundError('Esa alerta no está asignada a tu cuenta.');
  }
  if (recipient.acknowledgedAt) return recipient;

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.operationalAlarmRecipient.update({
      where: { id: recipient.id },
      data: { acknowledgedAt: now, snoozedUntil: null },
    });
    await tx.notification.updateMany({
      where: {
        userId: user.id,
        entity: 'OperationalAlarmRecipient',
        entityId: recipient.id,
        readAt: null,
      },
      data: { readAt: now },
    });

    const remaining = await tx.operationalAlarmRecipient.count({
      where: { alarmId: recipient.alarmId, acknowledgedAt: null },
    });
    if (remaining === 0) {
      await tx.operationalAlarm.update({
        where: { id: recipient.alarmId },
        data: { status: OperationalAlarmStatus.CERRADA, closedAt: now },
      });
    }
    return updated;
  });
}

export async function snoozeOperationalAlarm(
  user: CurrentUser,
  recipientId: string,
  minutes: number,
) {
  if (![5, 10, 15].includes(minutes)) throw new RuleError('La posposición debe ser de 5, 10 o 15 minutos.');
  const recipient = await prisma.operationalAlarmRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, userId: true, acknowledgedAt: true },
  });
  if (!recipient || recipient.userId !== user.id) {
    throw new NotFoundError('Esa alerta no está asignada a tu cuenta.');
  }
  if (recipient.acknowledgedAt) throw new RuleError('La alerta ya fue detenida.');

  const now = new Date();
  const snoozedUntil = new Date(now.getTime() + minutes * 60_000);
  await prisma.$transaction([
    prisma.operationalAlarmRecipient.update({
      where: { id: recipient.id },
      data: { snoozedUntil, lastTriggeredAt: null },
    }),
    prisma.notification.updateMany({
      where: {
        userId: user.id,
        entity: 'OperationalAlarmRecipient',
        entityId: recipient.id,
        readAt: null,
      },
      data: { readAt: now },
    }),
  ]);
  return { snoozedUntil };
}

/**
 * Los timers pertenecen al turno donde nacen: al cerrar ese turno no viajan al
 * siguiente. Los recordatorios no se tocan y continúan hasta ser atendidos.
 */
export async function cancelShiftTimers(
  tx: Prisma.TransactionClient,
  shiftId: string,
  now: Date,
): Promise<number> {
  const timers = await tx.operationalAlarm.findMany({
    where: {
      originShiftId: shiftId,
      kind: OperationalAlarmKind.TIMER,
      status: OperationalAlarmStatus.ACTIVA,
    },
    select: { id: true, recipients: { select: { id: true } } },
  });
  if (timers.length === 0) return 0;

  await tx.operationalAlarm.updateMany({
    where: { id: { in: timers.map((row) => row.id) } },
    data: { status: OperationalAlarmStatus.CANCELADA, cancelledAt: now },
  });
  await tx.notification.updateMany({
    where: {
      entity: 'OperationalAlarmRecipient',
      entityId: { in: timers.flatMap((row) => row.recipients.map((recipient) => recipient.id)) },
      readAt: null,
    },
    data: { readAt: now },
  });
  return timers.length;
}
