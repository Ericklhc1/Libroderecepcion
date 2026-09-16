import 'server-only';
import {
  AlertStatus,
  AssignmentRole,
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
import {
  cashBlockersForReceiving,
  cashBlockersForSending,
  ensureHandoverElements,
} from './cash';

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

/** Clave estable de una franja de turno. No es un id de fila. */
export function slotKey(date: Date, type: ShiftType): string {
  const day = operationalDate(date);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${dayOfMonth}:${type}`;
}

/**
 * Interpreta una clave de franja recibida en un formulario.
 *
 * El valor llega del cliente, así que se valida entero. No basta el patrón:
 * `new Date(2026, 12, 1)` no falla, desborda en silencio a enero de 2027, de
 * modo que un mes 13 crearía un turno en una fecha que nadie pidió. Por eso se
 * comprueba que la fecha construida coincida componente a componente con lo
 * recibido.
 */
export function parseSlotKey(raw: string): { date: Date; type: ShiftType } {
  const match = /^(\d{4})-(\d{2})-(\d{2}):(MANANA|TARDE|NOCHE)$/.exec(raw.trim());
  if (!match) throw new RuleError('La franja de turno indicada no es válida.');

  const [, year, month, day, type] = match;
  const [y, m, d] = [Number(year), Number(month), Number(day)];
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);

  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new RuleError('La franja de turno indicada no es válida.');
  }
  return { date, type: type as ShiftType };
}

export type TakeableSlot = {
  key: string;
  /** Nulo cuando la franja todavía no tiene fila: se crea al tomarla. */
  shiftId: string | null;
  date: Date;
  type: ShiftType;
  plannedStart: Date;
  plannedEnd: Date;
  /** Cierre del turno anterior esperando confirmación. Es lo primero que verá quien tome esta franja. */
  pendingClosure: {
    handoverId: string;
    fromType: ShiftType;
    fromDate: Date;
    issuedByName: string;
    issuedAt: Date | null;
  } | null;
};

/**
 * Franjas de turno que se pueden tomar ahora.
 *
 * NO hay asignación previa: nadie reparte los turnos de antemano, porque en el
 * mesón quien llega es quien llega. Lo que habilita a tomar una franja es que
 * esté sin tomar, y lo que la hace urgente es que el turno anterior haya
 * dejado un cierre esperando confirmación.
 *
 * Se ofrecen tres cosas, sin repetir ninguna franja:
 *   · la franja que corresponde al reloj;
 *   · las franjas que siguen a un turno con entrega enviada y sin recibir,
 *     que son los cierres por confirmar;
 *   · los turnos que alguien haya programado a mano, que siguen valiendo.
 *
 * `ShiftAssignment` no desaparece: deja de ser un requisito y pasa a ser el
 * registro de quién tomó el turno, que es lo que consulta `getMyOpenShift`.
 */
export async function getStartableShifts(): Promise<TakeableSlot[]> {
  const today = operationalDate();
  const from = addDays(today, -1);

  const [programmed, awaitingReceipt] = await Promise.all([
    prisma.shift.findMany({
      where: { status: ShiftStatus.PROGRAMADO, date: { gte: from } },
      orderBy: [{ date: 'asc' }, { type: 'asc' }],
      take: 10,
    }),
    prisma.shiftHandover.findMany({
      where: { status: HandoverStatus.ENVIADA, receivedAt: null },
      include: {
        fromShift: { select: { id: true, date: true, type: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { issuedAt: 'asc' },
      take: 10,
    }),
  ]);

  const candidates = new Map<string, { date: Date; type: ShiftType }>();
  const add = (date: Date, type: ShiftType) => {
    const key = slotKey(date, type);
    if (!candidates.has(key)) candidates.set(key, { date: operationalDate(date), type });
  };

  add(today, currentShiftType());
  for (const handover of awaitingReceipt) {
    const slot = nextShiftSlot(handover.fromShift.type);
    add(addDays(operationalDate(handover.fromShift.date), slot.dayOffset), slot.type);
  }
  for (const shift of programmed) add(shift.date, shift.type);

  // Una sola consulta para saber cuáles de esas franjas ya tienen fila.
  const existing = await prisma.shift.findMany({
    where: {
      OR: [...candidates.values()].map(({ date, type }) => ({ date, type })),
    },
    select: { id: true, date: true, type: true, status: true },
  });
  const rows = new Map(existing.map((row) => [slotKey(row.date, row.type), row]));

  // Una sola consulta para los cierres pendientes de los turnos anteriores.
  const previousOf = new Map<string, { date: Date; type: ShiftType }>();
  for (const [key, slot] of candidates) {
    const previous = previousShiftSlot(slot.type);
    previousOf.set(key, {
      date: addDays(slot.date, previous.dayOffset),
      type: previous.type,
    });
  }
  const pending = await prisma.shiftHandover.findMany({
    where: {
      status: HandoverStatus.ENVIADA,
      receivedAt: null,
      fromShift: { OR: [...previousOf.values()].map(({ date, type }) => ({ date, type })) },
    },
    include: {
      fromShift: { select: { date: true, type: true } },
      issuedBy: { select: { name: true } },
    },
  });
  const pendingByPrevious = new Map(
    pending.map((handover) => [
      slotKey(handover.fromShift.date, handover.fromShift.type),
      handover,
    ]),
  );

  const slots: TakeableSlot[] = [];
  for (const [key, slot] of candidates) {
    const row = rows.get(key);
    // Una franja ya tomada, cerrada o anulada no se vuelve a ofrecer.
    if (row && row.status !== ShiftStatus.PROGRAMADO) continue;

    const window = plannedWindow(slot.date, slot.type);
    const previous = previousOf.get(key);
    const handover = previous
      ? pendingByPrevious.get(slotKey(previous.date, previous.type))
      : undefined;

    slots.push({
      key,
      shiftId: row?.id ?? null,
      date: slot.date,
      type: slot.type,
      plannedStart: window.start,
      plannedEnd: window.end,
      pendingClosure: handover
        ? {
            handoverId: handover.id,
            fromType: handover.fromShift.type,
            fromDate: handover.fromShift.date,
            issuedByName: handover.issuedBy.name,
            issuedAt: handover.issuedAt,
          }
        : null,
    });
  }

  // Primero lo que tiene un cierre esperando, después por orden cronológico.
  slots.sort((a, b) => {
    if (Boolean(a.pendingClosure) !== Boolean(b.pendingClosure)) {
      return a.pendingClosure ? -1 : 1;
    }
    return a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key);
  });
  return slots;
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
/**
 * Toma una franja de turno.
 *
 * No se exige asignación previa: quien llega al mesón toma el turno y por eso
 * mismo la asignación se ESCRIBE aquí, como registro de quién lo tomó. La
 * franja puede no tener fila todavía, así que se crea dentro de la misma
 * transacción; `ensureShift` es idempotente, de modo que dos personas pulsando
 * a la vez no crean dos turnos, y la segunda choca contra el filtro de estado
 * PROGRAMADO y recibe un error en lugar de robarle el turno a la primera.
 */
export async function startShift(
  user: CurrentUser,
  slot: { date: Date; type: ShiftType },
) {
  if (!user.roleOperational) {
    throw new RuleError(
      'El Administrador de sistema no participa en la operación de turnos. Usa una cuenta operativa.',
    );
  }
  await assertUserFree(user.id);

  return prisma.$transaction(async (tx) => {
    const shift = await ensureShift(slot.date, slot.type, user.id, tx);
    assertTransition(shift.status, ShiftStatus.INICIADO);

    const result = await tx.shift
      .update({
        where: { id: shift.id, status: ShiftStatus.PROGRAMADO },
        data: {
          status: ShiftStatus.INICIADO,
          actualStart: new Date(),
          startedById: user.id,
        },
      })
      .catch(() => {
        throw new RuleError(
          'Otra persona tomó este turno hace un instante. Actualiza la pantalla para ver el estado real.',
        );
      });

    // La asignación pasa a ser consecuencia de tomar el turno, no requisito.
    await tx.shiftAssignment.upsert({
      where: { shiftId_userId: { shiftId: shift.id, userId: user.id } },
      create: { shiftId: shift.id, userId: user.id, role: AssignmentRole.TITULAR },
      update: {},
    });

    await recordAudit(
      {
        entity: 'Shift',
        entityId: shift.id,
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

  /*
    Recibir el turno es recibir la caja. Quien entra recuenta el fondo fijo y
    confirma los elementos ANTES de que la entrega se marque como recibida:
    después ya no hay a quién preguntarle por una diferencia.

    Sólo aplica cuando hay una entrega concreta que recibir. El primer turno
    del ciclo no tiene nada que contar, y si el hotel no configuró fondo fijo
    la lista viene vacía y la recepción funciona como siempre.
  */
  if (incoming) {
    const cashProblems = await cashBlockersForReceiving(incoming.id);
    if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));
  }

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

    /*
      Los elementos físicos que viajan con la caja se materializan acá, al
      preparar. Es idempotente: regenerar el borrador no borra lo que alguien
      ya marcó. Si el hotel no configuró elementos, no crea ninguno.
    */
    await ensureHandoverElements(handover.id, tx);

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

  /*
    La caja se cuenta antes de entregar, no después. Si el hotel no tiene
    fondo fijo configurado esto no bloquea nada: la lista viene vacía.
  */
  const cashProblems = await cashBlockersForSending(handover.id);
  if (cashProblems.length > 0) throw new RuleError(cashProblems.join(' '));

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
