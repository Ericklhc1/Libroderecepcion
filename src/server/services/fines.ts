import 'server-only';
// `Prisma` entra como VALOR, no como tipo: se usa `new Prisma.Decimal(...)`.
import {
  AuditAction,
  FineStatus,
  GuaranteeState,
  Prisma,
  RoomStayStage,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { resolveOperationalContext } from './operational-context';
import {
  OPEN_FINE_STATUSES,
  canTransition,
  fineProblems,
  fineSummary,
  type FineDraft,
  type FineStatusValue,
} from '@/domain/fines';

/**
 * Multas.
 *
 * El servicio no decide qué campos son obligatorios —eso vive en
 * `domain/fines.ts`— ni inventa un cobro. Hace tres cosas: rellena el contexto
 * que el mesón no debería escribir a mano, guarda, y enlaza con la garantía
 * cuando el cobro sale de ahí.
 *
 * **El contexto se autocompleta desde la habitación.** Quien registra una
 * multa tiene al huésped delante: pedirle que transcriba el número de reserva
 * y el nombre es pedirle que se equivoque. Si la habitación tiene una estadía
 * viva, sus datos entran solos y quedan como vínculo.
 */

const fineInclude = {
  room: { select: { id: true, number: true } },
  createdBy: { select: { id: true, name: true } },
  guarantee: { select: { id: true, state: true, amount: true, currency: true } },
} satisfies Prisma.FineInclude;

export type FineWithContext = Prisma.FineGetPayload<{ include: typeof fineInclude }>;

/**
 * Datos de la habitación para rellenar el formulario.
 *
 * Sólo se autocompleta huésped/reserva cuando hay una única estadía activa.
 * Si hay salida + entrada el mismo día, no se elige a ninguna por defecto.
 */
export async function fineContextForRoom(roomNumber: string) {
  const context = await resolveOperationalContext(prisma, { roomNumber });

  return {
    roomId: context.roomId,
    roomNumber: context.roomNumber ?? roomNumber,
    stayId: context.stayId,
    reservationCode: context.reservationCode ?? '',
    guestName: context.guestName ?? '',
    reservationReferenceId: context.reservationReferenceId,
  };
}

export async function createFine(
  user: CurrentUser,
  input: FineDraft & {
    roomNumber: string;
    stayId?: string | null;
    reservationReferenceId?: string | null;
    currency?: string;
  },
): Promise<FineWithContext> {
  const problems = fineProblems(input);
  if (problems.length > 0) {
    throw new RuleError(problems.map((problem) => problem.message).join(' '));
  }

  const context = await resolveOperationalContext(prisma, {
    roomNumber: input.roomNumber,
    stayId: input.stayId ?? null,
    reservationReferenceId: input.reservationReferenceId ?? null,
    reservationCode: input.reservationCode || null,
  });
  if (!context.roomId || !context.roomNumber) {
    throw new NotFoundError('Esa habitación no existe en el inventario.');
  }

  const fine = await prisma.fine.create({
    data: {
      roomId: context.roomId,
      reservationCode: context.reservationCode ?? input.reservationCode.trim(),
      guestName: context.guestName ?? input.guestName.trim(),
      stayId: context.stayId,
      reservationReferenceId: context.reservationReferenceId,
      kind: input.kind,
      linenKind: input.kind === 'BLANCO' ? (input.linenKind ?? null) : null,
      itemDetail: input.itemDetail?.trim() || null,
      stainType: input.stainType?.trim() || null,
      reason: input.reason!.trim(),
      guestStatement: input.guestStatement?.trim() || null,
      quantity: input.quantity ?? 1,
      amount:
        input.amount !== null && input.amount !== undefined
          ? new Prisma.Decimal(input.amount)
          : null,
      currency: (input.currency ?? 'CLP').toUpperCase(),
      createdById: user.id,
    },
    include: fineInclude,
  });

  await recordAudit({
    entity: 'Fine',
    entityId: fine.id,
    action: AuditAction.CREAR,
    user,
    summary: `Multa registrada: ${fineSummary({
      roomNumber: context.roomNumber,
      kind: input.kind,
      linenKind: input.linenKind ?? null,
      itemDetail: input.itemDetail ?? null,
      stainType: input.stainType ?? null,
      quantity: input.quantity ?? 1,
    })}. Reserva ${context.reservationCode ?? input.reservationCode} · ${context.guestName ?? input.guestName}. Motivo: ${input.reason}`,
  });

  return fine;
}

/**
 * Cambia el estado de la multa.
 *
 * Al cobrarla, si hay una garantía vigente en la reserva, se enlaza y se deja
 * constancia del monto. **No se mueve la garantía desde acá**: eso lo hace
 * `changeGuaranteeState`, que es el único camino de escritura de las
 * garantías, y quien cobra decide ahí cuánto se aplica.
 */
export async function changeFineStatus(
  user: CurrentUser,
  input: { fineId: string; status: FineStatusValue; note?: string | null },
) {
  const fine = await prisma.fine.findFirst({
    where: { id: input.fineId, deletedAt: null },
    include: fineInclude,
  });
  if (!fine) throw new NotFoundError('Esa multa no existe o fue eliminada.');

  if (!canTransition(fine.status as FineStatusValue, input.status)) {
    throw new RuleError(
      `Una multa ${fine.status.toLowerCase()} no puede pasar a ${input.status.toLowerCase()}.`,
    );
  }
  if (
    (input.status === 'CONDONADA' || input.status === 'ANULADA') &&
    !input.note?.trim()
  ) {
    throw new RuleError('Explica por qué no se cobra: sin motivo, la decisión no se sostiene.');
  }

  const updated = await prisma.fine.update({
    where: { id: fine.id },
    data: { status: input.status as FineStatus },
    include: fineInclude,
  });

  await recordAudit({
    entity: 'Fine',
    entityId: fine.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `Multa de la habitación ${fine.room.number} (reserva ${fine.reservationCode}): ` +
      `${fine.status} → ${input.status}${input.note ? `. ${input.note}` : ''}`,
    before: { status: fine.status },
    after: { status: input.status },
  });

  return updated;
}

/** Enlaza la multa con la garantía contra la que se cobra. */
export async function linkFineToGuarantee(
  user: CurrentUser,
  input: { fineId: string; guaranteeId: string },
) {
  const [fine, guarantee] = await Promise.all([
    prisma.fine.findFirst({
      where: { id: input.fineId, deletedAt: null },
      select: { id: true, reservationReferenceId: true, room: { select: { number: true } } },
    }),
    prisma.guarantee.findFirst({
      where: { id: input.guaranteeId, deletedAt: null },
      select: { id: true, state: true, reservationReferenceId: true },
    }),
  ]);
  if (!fine) throw new NotFoundError('Esa multa no existe.');
  if (!guarantee) throw new NotFoundError('Esa garantía no existe.');

  if (
    fine.reservationReferenceId &&
    guarantee.reservationReferenceId !== fine.reservationReferenceId
  ) {
    throw new RuleError('Esa garantía es de otra reserva: no se puede cobrar la multa ahí.');
  }
  if (guarantee.state === GuaranteeState.CERRADA) {
    throw new RuleError('Esa garantía ya está cerrada.');
  }

  await prisma.fine.update({
    where: { id: fine.id },
    data: { guaranteeId: guarantee.id },
  });

  await recordAudit({
    entity: 'Fine',
    entityId: fine.id,
    action: AuditAction.EDITAR,
    user,
    summary: `Multa de la habitación ${fine.room.number} enlazada a una garantía para su cobro`,
  });
}

export async function softDeleteFine(
  user: CurrentUser,
  input: { fineId: string; reason: string },
) {
  const fine = await prisma.fine.findFirst({
    where: { id: input.fineId, deletedAt: null },
    select: { id: true, room: { select: { number: true } }, reservationCode: true },
  });
  if (!fine) throw new NotFoundError('Esa multa no existe o ya fue eliminada.');

  await prisma.fine.update({
    where: { id: fine.id },
    data: {
      deletedAt: new Date(),
      deletedById: user.id,
      deletionReason: input.reason,
    },
  });

  await recordAudit({
    entity: 'Fine',
    entityId: fine.id,
    action: AuditAction.ELIMINAR,
    user,
    summary:
      `Multa de la habitación ${fine.room.number} (reserva ${fine.reservationCode}) ` +
      `eliminada: ${input.reason}`,
  });
}

/**
 * Multas vigentes en el contexto de una habitación.
 *
 * Una multa abierta sigue siendo un pendiente de esa habitación aunque el
 * check-out ya se haya confirmado. El C/O libera la ocupación, no resuelve el
 * cobro. Las multas resueltas dejan de ocupar la ficha cuando su estadía ya
 * finalizó y permanecen en el Libro/historial de la reserva.
 */
export async function listFinesForRoom(roomNumber: string): Promise<FineWithContext[]> {
  return prisma.fine.findMany({
    where: {
      room: { number: roomNumber },
      deletedAt: null,
      OR: [
        { stayId: null },
        { status: { in: OPEN_FINE_STATUSES.map((status) => FineStatus[status]) } },
        { stay: { stage: { not: RoomStayStage.FINALIZADO } } },
      ],
    },
    include: fineInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 30,
  });
}

/** Multas que siguen pidiendo una decisión, para Supervisión. */
export async function listOpenFines(limit = 50): Promise<FineWithContext[]> {
  return prisma.fine.findMany({
    where: {
      deletedAt: null,
      status: { in: OPEN_FINE_STATUSES.map((status) => FineStatus[status]) },
    },
    include: fineInclude,
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}
