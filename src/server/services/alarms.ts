import 'server-only';

import {
  AlarmKind,
  AlarmScope,
  AlarmStatus,
  NotificationType,
  ShiftStatus,
  SupervisionShiftStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError, NotFoundError } from '@/server/errors';
import { recordAudit } from '@/server/audit';

type Client = PrismaClient | Prisma.TransactionClient;

const OPEN_SHIFT_STATUSES = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
  ShiftStatus.ENTREGA_ENVIADA,
] as const;

export async function listAlarmAssignableUsers() {
  return prisma.user.findMany({
    where: { active: true, deletedAt: null },
    select: { id: true, name: true, username: true, role: { select: { name: true, operational: true } } },
    orderBy: { name: 'asc' },
  });
}

async function alarmOrigin(userId: string) {
  const [assignment, supervision] = await Promise.all([
    prisma.shiftAssignment.findFirst({
      where: {
        userId,
        activatedAt: { not: null },
        leftAt: null,
        shift: { status: { in: [...OPEN_SHIFT_STATUSES] }, archivedAt: null },
      },
      select: { shiftId: true },
      orderBy: { activatedAt: 'desc' },
    }),
    prisma.supervisionShift.findFirst({
      where: {
        supervisorId: userId,
        status: { in: [SupervisionShiftStatus.ACTIVO, SupervisionShiftStatus.ENTREGADO] },
      },
      select: { id: true },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  return {
    sourceShiftId: assignment?.shiftId ?? null,
    sourceSupervisionShiftId: supervision?.id ?? null,
  };
}

export async function createAlarm(
  user: CurrentUser,
  input: {
    kind: AlarmKind;
    scope: AlarmScope;
    title: string;
    note?: string | null;
    dueAt: Date;
    userIds?: string[];
  },
) {
  if (input.dueAt.getTime() <= Date.now()) {
    throw new RuleError('La alarma debe quedar programada para un momento futuro.');
  }

  let recipientIds: string[];
  if (input.scope === AlarmScope.GLOBAL) {
    const users = await prisma.user.findMany({
      where: {
        active: true,
        deletedAt: null,
        role: { operational: true },
      },
      select: { id: true },
    });
    recipientIds = users.map((row) => row.id);
  } else {
    const requested = Array.from(new Set(input.userIds ?? []));
    if (input.scope === AlarmScope.INDIVIDUAL && requested.length !== 1) {
      throw new RuleError('Una alarma individual debe tener exactamente una persona destinataria.');
    }
    if (input.scope === AlarmScope.GRUPO && requested.length < 1) {
      throw new RuleError('Selecciona al menos una persona para la alarma grupal.');
    }
    const users = await prisma.user.findMany({
      where: { id: { in: requested }, active: true, deletedAt: null },
      select: { id: true },
    });
    if (users.length !== requested.length) {
      throw new RuleError('Uno de los destinatarios ya no está activo.');
    }
    recipientIds = users.map((row) => row.id);
  }

  if (!recipientIds.length) throw new RuleError('No hay destinatarios activos para esta alarma.');
  const origin = await alarmOrigin(user.id);

  return prisma.$transaction(async (tx) => {
    const alarm = await tx.alarm.create({
      data: {
        kind: input.kind,
        scope: input.scope,
        title: input.title.trim(),
        note: input.note?.trim() || null,
        dueAt: input.dueAt,
        createdById: user.id,
        sourceShiftId: origin.sourceShiftId,
        sourceSupervisionShiftId: origin.sourceSupervisionShiftId,
        recipients: { createMany: { data: recipientIds.map((userId) => ({ userId })) } },
      },
      include: {
        recipients: { include: { user: { select: { id: true, name: true } } } },
      },
    });

    await recordAudit(
      {
        entity: 'Alarm',
        entityId: alarm.id,
        action: 'CREAR',
        user,
        summary: `${input.kind === AlarmKind.TIMER ? 'Timer' : 'Reminder'} «${alarm.title}» · ${recipientIds.length} destinatario(s)`,
        after: {
          kind: alarm.kind,
          scope: alarm.scope,
          dueAt: alarm.dueAt,
          recipientIds,
          sourceShiftId: alarm.sourceShiftId,
          sourceSupervisionShiftId: alarm.sourceSupervisionShiftId,
        },
      },
      tx,
    );
    return alarm;
  });
}

export async function listAlarmsForUser(userId: string, take = 80) {
  return prisma.alarm.findMany({
    where: {
      OR: [{ createdById: userId }, { recipients: { some: { userId } } }],
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      recipients: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
    take,
  });
}

/**
 * Convierte alarmas vencidas en notificaciones internas cuando el usuario tiene
 * el Libro abierto. El SSE llama al feed cada ~2 s, así que el disparo se siente
 * como una alarma sin mantener timers frágiles sólo en el navegador.
 */
export async function materializeDueAlarmsForUser(userId: string): Promise<number> {
  const now = new Date();
  const rows = await prisma.alarmRecipient.findMany({
    where: {
      userId,
      acknowledgedAt: null,
      cancelledAt: null,
      alarm: { status: AlarmStatus.ACTIVA },
      OR: [
        { snoozedUntil: { lte: now } },
        { snoozedUntil: null, alarm: { dueAt: { lte: now } } },
      ],
    },
    include: { alarm: true },
    take: 20,
  });

  let created = 0;
  for (const row of rows) {
    const due = row.snoozedUntil ?? row.alarm.dueAt;
    if (row.lastNotifiedAt && row.lastNotifiedAt >= due) continue;

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.alarmRecipient.updateMany({
        where: {
          id: row.id,
          acknowledgedAt: null,
          cancelledAt: null,
          OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: due } }],
        },
        data: {
          triggeredAt: row.triggeredAt ?? now,
          lastNotifiedAt: now,
        },
      });
      if (!claimed.count) return;

      await tx.notification.create({
        data: {
          userId,
          type: NotificationType.ALARMA,
          title: row.alarm.title,
          body:
            (row.alarm.kind === AlarmKind.TIMER ? 'Timer' : 'Reminder') +
            (row.alarm.note ? ` · ${row.alarm.note}` : ''),
          link: '/alarmas',
          entity: 'AlarmRecipient',
          entityId: row.id,
          isDemo: row.alarm.isDemo,
        },
      });
      created += 1;
    });
  }
  return created;
}

export async function respondAlarm(
  user: CurrentUser,
  input:
    | { recipientId: string; action: 'ACK' }
    | { recipientId: string; action: 'SNOOZE'; minutes: number },
) {
  const recipient = await prisma.alarmRecipient.findUnique({
    where: { id: input.recipientId },
    include: { alarm: true },
  });
  if (!recipient || recipient.userId !== user.id) throw new NotFoundError('Esa alarma no te pertenece.');
  if (recipient.cancelledAt || recipient.alarm.status !== AlarmStatus.ACTIVA) {
    throw new RuleError('La alarma ya no está activa.');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (input.action === 'ACK') {
      await tx.alarmRecipient.update({
        where: { id: recipient.id },
        data: { acknowledgedAt: now, snoozedUntil: null },
      });
    } else {
      if (![5, 10, 15, 30, 60].includes(input.minutes)) {
        throw new RuleError('Intervalo de posposición no permitido.');
      }
      await tx.alarmRecipient.update({
        where: { id: recipient.id },
        data: {
          snoozedUntil: new Date(now.getTime() + input.minutes * 60_000),
        },
      });
    }
    await tx.notification.updateMany({
      where: {
        userId: user.id,
        entity: 'AlarmRecipient',
        entityId: recipient.id,
        readAt: null,
      },
      data: { readAt: now },
    });

    if (input.action === 'ACK') {
      const remaining = await tx.alarmRecipient.count({
        where: {
          alarmId: recipient.alarmId,
          acknowledgedAt: null,
          cancelledAt: null,
        },
      });
      if (remaining === 0) {
        await tx.alarm.update({
          where: { id: recipient.alarmId },
          data: { status: AlarmStatus.COMPLETADA, completedAt: now },
        });
      }
    }

    await recordAudit(
      {
        entity: 'Alarm',
        entityId: recipient.alarmId,
        action: 'CAMBIO_ESTADO',
        user,
        summary:
          input.action === 'ACK'
            ? `Alarma «${recipient.alarm.title}» detenida por ${user.name}`
            : `Alarma «${recipient.alarm.title}» pospuesta ${input.minutes} min por ${user.name}`,
        after:
          input.action === 'ACK'
            ? { acknowledgedAt: now }
            : { snoozedUntil: new Date(now.getTime() + input.minutes * 60_000) },
      },
      tx,
    );
  });
}

export async function cancelAlarm(user: CurrentUser, alarmId: string) {
  const alarm = await prisma.alarm.findUnique({
    where: { id: alarmId },
    select: { id: true, title: true, createdById: true, status: true },
  });
  if (!alarm) throw new NotFoundError('La alarma no existe.');
  const canManageOthers = user.permissions.includes('supervision.center.view');
  if (alarm.createdById !== user.id && !canManageOthers) {
    throw new RuleError('Sólo quien creó la alarma o Supervisión puede cancelarla.');
  }
  if (alarm.status !== AlarmStatus.ACTIVA) return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.alarm.update({
      where: { id: alarm.id },
      data: { status: AlarmStatus.CANCELADA, cancelledAt: now },
    });
    await tx.alarmRecipient.updateMany({
      where: { alarmId: alarm.id, acknowledgedAt: null, cancelledAt: null },
      data: { cancelledAt: now },
    });
    await tx.notification.updateMany({
      where: { entity: 'AlarmRecipient', entityId: { in: (
        await tx.alarmRecipient.findMany({ where: { alarmId: alarm.id }, select: { id: true } })
      ).map((row) => row.id) }, readAt: null },
      data: { readAt: now },
    });
    await recordAudit({
      entity: 'Alarm',
      entityId: alarm.id,
      action: 'CERRAR',
      user,
      summary: `Alarma «${alarm.title}» cancelada`,
      after: { status: AlarmStatus.CANCELADA, cancelledAt: now },
    }, tx);
  });
}

/** TIMER no cruza la frontera del turno; REMINDER queda intacto. */
export async function cancelTimersForShift(
  client: Client,
  input: { shiftId?: string; supervisionShiftId?: string; at?: Date },
): Promise<number> {
  const at = input.at ?? new Date();
  const alarms = await client.alarm.findMany({
    where: {
      kind: AlarmKind.TIMER,
      status: AlarmStatus.ACTIVA,
      ...(input.shiftId ? { sourceShiftId: input.shiftId } : {}),
      ...(input.supervisionShiftId ? { sourceSupervisionShiftId: input.supervisionShiftId } : {}),
    },
    select: { id: true },
  });
  if (!alarms.length) return 0;
  const ids = alarms.map((row) => row.id);
  await client.alarm.updateMany({
    where: { id: { in: ids } },
    data: { status: AlarmStatus.CANCELADA, cancelledAt: at },
  });
  await client.alarmRecipient.updateMany({
    where: { alarmId: { in: ids }, acknowledgedAt: null, cancelledAt: null },
    data: { cancelledAt: at },
  });
  return ids.length;
}
