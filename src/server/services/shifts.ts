import 'server-only';
import {
  AlertStatus,
  AuditAction,
  HandoverLevel,
  HandoverStatus,
  NotificationType,
  ShiftStatus,
  ShiftType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  FINISHED_SHIFT_STATUSES,
  OCCUPYING_SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
  assertCanClose,
  assertTransition,
  nextShiftSlot,
  plannedWindow,
  previousShiftSlot,
} from '@/domain/shift';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { buildHandoverSnapshot, SNAPSHOT_SECTION_ORDER } from './handover-snapshot';
import { LIVE_ALERT_WHERE } from './alert-engine';
import { getSettingBool } from './settings';

/** Fecha operativa (medianoche local) usada como clave de turno. */
export function operationalDate(now = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

/** Turno que corresponde al reloj actual. */
export function currentShiftType(now = new Date()): ShiftType {
  const hour = now.getHours();
  if (hour >= 7 && hour < 15) return ShiftType.MANANA;
  if (hour >= 15 && hour < 23) return ShiftType.TARDE;
  return ShiftType.NOCHE;
}

/** Crea el turno si no existe (idempotente por fecha + tipo). */
export async function ensureShift(
  date: Date,
  type: ShiftType,
  createdById?: string | null,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const day = operationalDate(date);
  const existing = await client.shift.findUnique({
    where: { date_type: { date: day, type } },
  });
  if (existing) return existing;
  const window = plannedWindow(day, type);
  return client.shift.create({
    data: {
      date: day,
      type,
      plannedStart: window.start,
      plannedEnd: window.end,
      createdById: createdById ?? null,
    },
  });
}

export const shiftInclude = {
  assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
  handoverOut: {
    include: {
      issuedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  },
} satisfies Prisma.ShiftInclude;

export type ShiftWithDetail = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

/** Turno que el usuario tiene abierto ahora mismo, si alguno. */
export async function getMyOpenShift(userId: string) {
  return prisma.shift.findFirst({
    where: {
      status: { in: [...OCCUPYING_SHIFT_STATUSES, ShiftStatus.ENTREGA_ENVIADA] },
      assignments: { some: { userId } },
    },
    include: shiftInclude,
    orderBy: [{ date: 'desc' }, { type: 'desc' }],
  });
}

/** Turnos que el usuario puede iniciar: asignados y aún programados. */
export async function getStartableShifts(userId: string) {
  const from = addDays(operationalDate(), -1);
  return prisma.shift.findMany({
    where: {
      status: ShiftStatus.PROGRAMADO,
      date: { gte: from },
      assignments: { some: { userId } },
    },
    include: shiftInclude,
    orderBy: [{ date: 'asc' }, { type: 'asc' }],
    take: 10,
  });
}

export async function getShiftById(shiftId: string): Promise<ShiftWithDetail> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: shiftInclude,
  });
  if (!shift) throw new NotFoundError('El turno no existe.');
  return shift;
}

async function findNeighbourShift(
  shift: { date: Date; type: ShiftType },
  direction: 'next' | 'previous',
) {
  const slot =
    direction === 'next' ? nextShiftSlot(shift.type) : previousShiftSlot(shift.type);
  return prisma.shift.findUnique({
    where: {
      date_type: {
        date: addDays(operationalDate(shift.date), slot.dayOffset),
        type: slot.type,
      },
    },
    include: shiftInclude,
  });
}

export const getNextShift = (shift: { date: Date; type: ShiftType }) =>
  findNeighbourShift(shift, 'next');
export const getPreviousShift = (shift: { date: Date; type: ShiftType }) =>
  findNeighbourShift(shift, 'previous');

/** Entrega pendiente de recibir que corresponde a este turno. */
export async function getIncomingHandover(shift: { id: string; date: Date; type: ShiftType }) {
  const previous = await getPreviousShift(shift);
  const byShift = previous
    ? await prisma.shiftHandover.findFirst({
        where: { fromShiftId: previous.id, status: HandoverStatus.ENVIADA },
        include: {
          issuedBy: { select: { id: true, name: true } },
          fromShift: true,
          items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
        },
      })
    : null;
  if (byShift) return byShift;

  // Entrega dirigida explícitamente a este turno (p. ej. turno reprogramado).
  return prisma.shiftHandover.findFirst({
    where: { toShiftId: shift.id, status: HandoverStatus.ENVIADA },
    include: {
      issuedBy: { select: { id: true, name: true } },
      fromShift: true,
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
    },
  });
}

/**
 * Información que se muestra al iniciar turno: qué está pasando y qué se hereda.
 */
export async function getShiftBriefing(shift: { id: string; date: Date; type: ShiftType }) {
  const now = new Date();
  const [incoming, openEntries, overdueTasks, myTasks, alerts, followUps, vipGuests, reservations] =
    await Promise.all([
      getIncomingHandover(shift),
      prisma.operationalEntry.findMany({
        where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
        include: {
          owner: { select: { id: true, name: true } },
          department: { select: { name: true } },
          guest: { select: { fullName: true, roomNumber: true } },
        },
        orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
        take: 25,
      }),
      prisma.task.findMany({
        where: {
          deletedAt: null,
          status: { in: TASK_OPEN_STATUSES },
          dueAt: { lt: now },
        },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: { dueAt: 'asc' },
        take: 25,
      }),
      prisma.task.findMany({
        where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 25,
      }),
      prisma.alert.findMany({
        where: LIVE_ALERT_WHERE(now),
        orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
        take: 25,
      }),
      prisma.followUp.findMany({
        where: {
          deletedAt: null,
          status: { in: ['PENDIENTE', 'VENCIDO'] },
        },
        include: {
          owner: { select: { id: true, name: true } },
          entry: { select: { id: true, seq: true, title: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 25,
      }),
      prisma.guestReference.findMany({
        where: { deletedAt: null, vip: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      prisma.reservationReference.findMany({
        where: {
          deletedAt: null,
          OR: [
            { requiresAction: true },
            { guaranteeStatus: { in: ['PENDIENTE', 'RECHAZADA'] } },
            { balanceDue: { gt: 0 } },
            { status: 'PENDIENTE' },
          ],
        },
        include: { guest: { select: { fullName: true, vip: true } } },
        orderBy: { checkIn: 'asc' },
        take: 20,
      }),
    ]);

  const comments = await prisma.comment.findMany({
    where: { deletedAt: null },
    include: {
      author: { select: { id: true, name: true } },
      entry: { select: { id: true, seq: true, title: true } },
      task: { select: { id: true, seq: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return {
    incoming,
    openEntries,
    overdueTasks,
    myTasks,
    alerts,
    followUps,
    vipGuests,
    reservations,
    comments,
  };
}

async function assertUserFree(userId: string, exceptShiftId?: string) {
  const other = await prisma.shift.findFirst({
    where: {
      status: { in: OCCUPYING_SHIFT_STATUSES },
      assignments: { some: { userId } },
      ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}),
    },
    select: { id: true, type: true, date: true, status: true },
  });
  if (other) {
    throw new RuleError(
      `Ya tienes el turno ${SHIFT_TYPE_LABEL[other.type]} del ${other.date.toLocaleDateString('es-CL')} en estado ${SHIFT_STATUS_LABEL[other.status]}. Ciérralo o entrégalo antes de iniciar otro.`,
    );
  }
}

/** Paso 1: iniciar turno. Deja el turno en INICIADO (pendiente de confirmar recepción). */
export async function startShift(user: CurrentUser, shiftId: string) {
  if (!user.roleOperational) {
    throw new RuleError(
      'El Administrador de sistema no participa en la operación de turnos. Usa una cuenta operativa.',
    );
  }
  await assertUserFree(user.id, shiftId);

  const shift = await getShiftById(shiftId);
  const assigned = shift.assignments.some((a) => a.userId === user.id);
  if (!assigned) {
    throw new RuleError('No estás asignado a este turno.');
  }
  assertTransition(shift.status, ShiftStatus.INICIADO);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.shift.update({
      where: { id: shiftId, status: ShiftStatus.PROGRAMADO },
      data: {
        status: ShiftStatus.INICIADO,
        actualStart: new Date(),
        startedById: user.id,
      },
    });
    await recordAudit(
      {
        entity: 'Shift',
        entityId: shiftId,
        action: AuditAction.TURNO_INICIAR,
        summary: `Inicio de turno ${SHIFT_TYPE_LABEL[shift.type]} del ${shift.date.toLocaleDateString('es-CL')}`,
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.INICIADO, actualStart: result.actualStart },
      },
      tx,
    );
    return result;
  });

  return updated;
}

/**
 * Paso 2: confirmar la recepción de la entrega anterior.
 *
 * Si no hay entrega pendiente (primer turno del ciclo o turno anterior sin
 * entrega), el turno pasa a ACTIVO igualmente, pero el hecho queda auditado.
 */
export async function receiveHandover(
  user: CurrentUser,
  params: { shiftId: string; handoverId?: string | null; observations?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('No estás asignado a este turno.');
  }

  const incoming = await getIncomingHandover(shift);

  // La entrega se valida antes que el estado del turno: así el mensaje explica
  // el problema real ("ya fue recibida", "no existe") en lugar de hablar de
  // transiciones de estado.
  if (params.handoverId && (!incoming || incoming.id !== params.handoverId)) {
    const already = await prisma.shiftHandover.findUnique({
      where: { id: params.handoverId },
      select: { id: true, status: true },
    });
    if (!already) throw new NotFoundError('La entrega indicada no existe.');
    if (already.status === HandoverStatus.RECIBIDA) {
      throw new RuleError('Esa entrega ya fue recibida y confirmada.');
    }
    throw new RuleError('La entrega indicada no corresponde a este turno.');
  }

  assertTransition(shift.status, ShiftStatus.ACTIVO);

  const autoClose = await getSettingBool('shift.autoCloseOnReceive', true);

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    if (incoming) {
      // Guarda de concurrencia: sólo una transacción puede pasar de ENVIADA.
      const claim = await tx.shiftHandover.updateMany({
        where: { id: incoming.id, status: HandoverStatus.ENVIADA },
        data: {
          status: HandoverStatus.RECIBIDA,
          receivedById: user.id,
          receivedAt: now,
          receiverSessionId: user.sessionId,
          receiverObservations: params.observations ?? null,
          toShiftId: incoming.toShiftId ?? shift.id,
        },
      });
      if (claim.count === 0) {
        throw new RuleError('Esa entrega ya fue recibida por otro usuario.');
      }

      const fromShift = await tx.shift.findUnique({
        where: { id: incoming.fromShiftId },
        select: { id: true, status: true, type: true, date: true },
      });
      if (fromShift && fromShift.status === ShiftStatus.ENTREGA_ENVIADA) {
        await tx.shift.update({
          where: { id: fromShift.id },
          data: {
            status: autoClose ? ShiftStatus.CERRADO : ShiftStatus.RECIBIDO,
            ...(autoClose ? { actualEnd: fromShift.status ? now : now } : {}),
          },
        });
        await recordAudit(
          {
            entity: 'Shift',
            entityId: fromShift.id,
            action: autoClose ? AuditAction.TURNO_CERRAR : AuditAction.CAMBIO_ESTADO,
            summary: autoClose
              ? 'Turno cerrado automáticamente tras la confirmación de recepción'
              : 'Turno marcado como recibido por el turno siguiente',
            user,
            before: { status: fromShift.status },
            after: { status: autoClose ? ShiftStatus.CERRADO : ShiftStatus.RECIBIDO },
          },
          tx,
        );
      }

      // Las alertas de entrega pendiente dejan de aplicar.
      await tx.alert.updateMany({
        where: { handoverId: incoming.id, auto: true, status: { not: AlertStatus.RESUELTA } },
        data: {
          status: AlertStatus.RESUELTA,
          resolvedAt: now,
          resolvedById: user.id,
          resolutionNote: 'Entrega recibida.',
        },
      });

      await notify(
        {
          userId: incoming.issuedById,
          type: NotificationType.ACCION_REQUERIDA,
          title: 'Tu entrega de turno fue recibida',
          body: `${user.name} confirmó la recepción de la entrega.`,
          link: `/turno/entrega/${incoming.id}`,
          entity: 'ShiftHandover',
          entityId: incoming.id,
        },
        tx,
      );
    }

    const updated = await tx.shift.update({
      where: { id: shift.id, status: ShiftStatus.INICIADO },
      data: { status: ShiftStatus.ACTIVO },
    });

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_RECIBIR,
        summary: incoming
          ? `Recepción de turno confirmada (entrega ${incoming.id})`
          : 'Turno activado sin entrega previa pendiente',
        user,
        before: { status: ShiftStatus.INICIADO },
        after: {
          status: ShiftStatus.ACTIVO,
          handoverId: incoming?.id ?? null,
          observations: params.observations ?? null,
          sessionId: user.sessionId,
        },
        reason: params.observations ?? null,
      },
      tx,
    );

    return updated;
  });
}

/** Paso 3: abrir la preparación de la entrega, generando el resumen automático. */
export async function prepareHandover(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('Sólo quien está en el turno puede preparar su entrega.');
  }

  if (shift.handoverOut && shift.handoverOut.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('Este turno ya envió su entrega.');
  }

  if (shift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
    assertTransition(shift.status, ShiftStatus.PREPARANDO_ENTREGA);
  }

  const snapshot = await buildHandoverSnapshot();
  const nextShift = await getNextShift(shift);

  return prisma.$transaction(async (tx) => {
    const handover = shift.handoverOut
      ? await tx.shiftHandover.update({
          where: { id: shift.handoverOut.id },
          data: { toShiftId: nextShift?.id ?? null },
        })
      : await tx.shiftHandover.create({
          data: {
            fromShiftId: shift.id,
            toShiftId: nextShift?.id ?? null,
            issuedById: user.id,
            status: HandoverStatus.BORRADOR,
            isDemo: shift.isDemo,
          },
        });

    // El resumen automático se regenera; las notas manuales se conservan.
    await tx.handoverItem.deleteMany({
      where: { handoverId: handover.id, manual: false },
    });
    if (snapshot.length > 0) {
      await tx.handoverItem.createMany({
        data: snapshot.map((item, index) => ({
          handoverId: handover.id,
          level: item.level,
          section: item.section,
          title: item.title,
          detail: item.detail,
          refType: item.refType,
          refId: item.refId,
          manual: false,
          order: SNAPSHOT_SECTION_ORDER.indexOf(item.section) * 1000 + index,
        })),
      });
    }

    if (shift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
      await tx.shift.update({
        where: { id: shift.id },
        data: { status: ShiftStatus.PREPARANDO_ENTREGA },
      });
      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: 'Turno en preparación de entrega',
          user,
          before: { status: shift.status },
          after: { status: ShiftStatus.PREPARANDO_ENTREGA },
        },
        tx,
      );
    }

    return handover;
  });
}

/** Paso 4: enviar la entrega al turno siguiente. */
export async function sendHandover(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('Sólo quien está en el turno puede enviar su entrega.');
  }
  const handover = shift.handoverOut;
  if (!handover) {
    throw new RuleError('Primero debes preparar la entrega.');
  }
  if (handover.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('Esta entrega ya fue enviada.');
  }
  assertTransition(shift.status, ShiftStatus.ENTREGA_ENVIADA);

  const nextShift = await getNextShift(shift);
  const items = await prisma.handoverItem.findMany({
    where: { handoverId: handover.id },
    orderBy: [{ level: 'asc' }, { order: 'asc' }],
  });

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const sent = await tx.shiftHandover.update({
      where: { id: handover.id, status: HandoverStatus.BORRADOR },
      data: {
        status: HandoverStatus.ENVIADA,
        issuedAt: now,
        issuedById: user.id,
        issuerSessionId: user.sessionId,
        notes: params.notes ?? handover.notes,
        toShiftId: nextShift?.id ?? null,
        // Fotografía inmutable de lo entregado.
        snapshot: {
          generatedAt: now.toISOString(),
          fromShift: {
            id: shift.id,
            type: shift.type,
            date: shift.date.toISOString(),
          },
          issuedBy: { id: user.id, name: user.name },
          counts: {
            urgente: items.filter((i) => i.level === HandoverLevel.URGENTE).length,
            importante: items.filter((i) => i.level === HandoverLevel.IMPORTANTE).length,
            informativo: items.filter((i) => i.level === HandoverLevel.INFORMATIVO).length,
          },
          items: items.map((i) => ({
            level: i.level,
            section: i.section,
            title: i.title,
            detail: i.detail,
            refType: i.refType,
            refId: i.refId,
            manual: i.manual,
          })),
        } satisfies Prisma.InputJsonValue,
      },
    });

    await tx.shift.update({
      where: { id: shift.id, status: ShiftStatus.PREPARANDO_ENTREGA },
      data: { status: ShiftStatus.ENTREGA_ENVIADA },
    });

    await recordAudit(
      {
        entity: 'ShiftHandover',
        entityId: sent.id,
        action: AuditAction.TURNO_ENTREGAR,
        summary: `Entrega enviada por ${user.name} (${items.length} puntos)`,
        user,
        after: {
          status: HandoverStatus.ENVIADA,
          toShiftId: nextShift?.id ?? null,
          items: items.length,
        },
      },
      tx,
    );

    if (nextShift) {
      const receivers = await tx.shiftAssignment.findMany({
        where: { shiftId: nextShift.id },
        select: { userId: true },
      });
      await notify(
        receivers.map((r) => ({
          userId: r.userId,
          type: NotificationType.ENTREGA_DISPONIBLE,
          title: 'Entrega de turno disponible',
          body: `${user.name} envió la entrega del turno ${SHIFT_TYPE_LABEL[shift.type]}. Confírmala al iniciar tu turno.`,
          link: `/turno`,
          entity: 'ShiftHandover',
          entityId: sent.id,
        })),
        tx,
      );
    }

    return sent;
  });
}

/** Paso 5: cerrar el turno. */
export async function closeShift(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
) {
  const shift = await getShiftById(params.shiftId);
  const isOwner = shift.assignments.some((a) => a.userId === user.id);
  const canManage = user.permissions.includes('shift.manage');
  if (!isOwner && !canManage) {
    throw new RuleError('Sólo quien está en el turno o un supervisor puede cerrarlo.');
  }

  const nextShift = await getNextShift(shift);
  const handoverStatus: 'NONE' | HandoverStatus = shift.handoverOut
    ? shift.handoverOut.status
    : 'NONE';

  assertCanClose({
    status: shift.status,
    hasNextShift: Boolean(nextShift) && !FINISHED_SHIFT_STATUSES.includes(nextShift!.status),
    handoverStatus,
  });

  return prisma.$transaction(async (tx) => {
    const closed = await tx.shift.update({
      where: { id: shift.id },
      data: {
        status: ShiftStatus.CERRADO,
        actualEnd: new Date(),
        closedById: user.id,
        notes: params.notes ?? shift.notes,
      },
    });
    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.TURNO_CERRAR,
        summary: `Turno ${SHIFT_TYPE_LABEL[shift.type]} del ${shift.date.toLocaleDateString('es-CL')} cerrado por ${user.name}`,
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.CERRADO },
        reason: params.notes ?? null,
      },
      tx,
    );
    return closed;
  });
}

/** Cancela la preparación y devuelve el turno a ACTIVO. */
export async function cancelHandoverPreparation(user: CurrentUser, shiftId: string) {
  const shift = await getShiftById(shiftId);
  if (!shift.assignments.some((a) => a.userId === user.id)) {
    throw new RuleError('Sólo quien está en el turno puede cancelar la preparación.');
  }
  assertTransition(shift.status, ShiftStatus.ACTIVO);
  if (shift.handoverOut && shift.handoverOut.status !== HandoverStatus.BORRADOR) {
    throw new RuleError('La entrega ya fue enviada: no puede cancelarse.');
  }
  return prisma.$transaction(async (tx) => {
    if (shift.handoverOut) {
      await tx.handoverItem.deleteMany({ where: { handoverId: shift.handoverOut.id } });
      await tx.shiftHandover.delete({ where: { id: shift.handoverOut.id } });
    }
    const updated = await tx.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.ACTIVO },
    });
    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
        action: AuditAction.CAMBIO_ESTADO,
        summary: 'Preparación de entrega cancelada',
        user,
        before: { status: shift.status },
        after: { status: ShiftStatus.ACTIVO },
      },
      tx,
    );
    return updated;
  });
}
