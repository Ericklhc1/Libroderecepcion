import 'server-only';
import { AuditAction, GuaranteeState, GuaranteeStatus, Prisma } from '@prisma/client';
import type { GuaranteeKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  GUARANTEE_STATE_LABELS,
  OPEN_GUARANTEE_STATES,
  canTransition,
  deriveReservationGuaranteeSummary,
  type GuaranteeStateValue,
} from '@/domain/guarantees';

/**
 * Garantías de una reserva.
 *
 * La garantía cuelga de la reserva, no de la habitación: sobrevive a un cambio
 * de habitación y a los turnos sin que nadie la mueva.
 *
 * No tiene tabla de historial: cada cambio queda en `AuditLog` con su antes y
 * su después, igual que el resto del sistema.
 *
 * `ReservationReference.guaranteeStatus` se conserva porque el motor de alertas
 * y la entrega de turno lo leen. Este servicio es el **único** sitio que lo
 * escribe a partir de las garantías, con `syncReservationSummary`, de modo que
 * no puede quedar descuadrado.
 */

type Tx = Prisma.TransactionClient;

export const guaranteeInclude = {
  reservationReference: {
    select: {
      id: true,
      code: true,
      roomNumber: true,
      guest: { select: { id: true, fullName: true, vip: true } },
    },
  },
  createdBy: { select: { name: true } },
  returnedBy: { select: { name: true } },
} satisfies Prisma.GuaranteeInclude;

export type GuaranteeWithContext = Prisma.GuaranteeGetPayload<{
  include: typeof guaranteeInclude;
}>;

/**
 * Recalcula el resumen de la reserva a partir de sus garantías vivas.
 *
 * Sin garantías registradas no toca nada: ese campo existía antes que esta
 * entidad y alguien pudo ponerlo a mano.
 */
async function syncReservationSummary(tx: Tx, reservationReferenceId: string): Promise<void> {
  const guarantees = await tx.guarantee.findMany({
    where: { reservationReferenceId, deletedAt: null },
    select: { state: true },
  });

  const summary = deriveReservationGuaranteeSummary(
    guarantees.map((guarantee) => guarantee.state as GuaranteeStateValue),
  );
  if (!summary) return;

  await tx.reservationReference.update({
    where: { id: reservationReferenceId },
    data: { guaranteeStatus: GuaranteeStatus[summary] },
  });
}

function money(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

export async function createGuarantee(
  user: CurrentUser,
  input: {
    reservationReferenceId: string;
    kind: GuaranteeKind;
    amount: number;
    currency: string;
    state?: GuaranteeState;
    notes?: string | null;
  },
): Promise<{ id: string }> {
  const guarantee = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservationReference.findFirst({
      where: { id: input.reservationReferenceId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!reservation) throw new NotFoundError('Esa reserva no existe.');

    const created = await tx.guarantee.create({
      data: {
        reservationReferenceId: reservation.id,
        kind: input.kind,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency.toUpperCase(),
        state: input.state ?? GuaranteeState.PENDIENTE,
        notes: input.notes ?? null,
        createdById: user.id,
      },
      select: { id: true, state: true, amount: true, currency: true },
    });

    await syncReservationSummary(tx, reservation.id);
    return { ...created, reservationCode: reservation.code };
  });

  await recordAudit({
    entity: 'Guarantee',
    entityId: guarantee.id,
    action: AuditAction.CREAR,
    user,
    summary:
      `Garantía registrada en la reserva ${guarantee.reservationCode}: ` +
      `${guarantee.currency} ${money(guarantee.amount)}, ` +
      `${GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue]}`,
    after: { state: guarantee.state, amount: money(guarantee.amount) },
  });

  return { id: guarantee.id };
}

/**
 * Cambia el estado de una garantía.
 *
 * Las transiciones válidas las define el dominio (`canTransition`): una
 * garantía devuelta no vuelve a estar vigente y una cerrada no se reabre.
 */
export async function changeGuaranteeState(
  user: CurrentUser,
  input: {
    id: string;
    state: GuaranteeState;
    appliedAmount?: number | null;
    applicationReason?: string | null;
    penaltyAmount?: number | null;
    notes?: string | null;
  },
): Promise<{ id: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const guarantee = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        state: true,
        amount: true,
        currency: true,
        reservationReferenceId: true,
        reservationReference: { select: { code: true } },
      },
    });
    if (!guarantee) throw new NotFoundError('Esa garantía no existe.');

    const from = guarantee.state as GuaranteeStateValue;
    const to = input.state as GuaranteeStateValue;
    if (from === to) throw new RuleError('La garantía ya está en ese estado.');
    if (!canTransition(from, to)) {
      throw new RuleError(
        `No se puede pasar de «${GUARANTEE_STATE_LABELS[from]}» a ` +
          `«${GUARANTEE_STATE_LABELS[to]}».`,
      );
    }

    // Aplicar parte de la garantía exige decir cuánto y por qué: sin eso no
    // hay forma de explicarle al huésped qué se le cobró.
    if (to === 'APLICADA_PARCIALMENTE') {
      if (!input.appliedAmount || input.appliedAmount <= 0) {
        throw new RuleError('Indica el monto aplicado.');
      }
      if (!input.applicationReason?.trim()) {
        throw new RuleError('Indica el motivo de la aplicación.');
      }
    }
    if (to === 'MULTA' && (!input.penaltyAmount || input.penaltyAmount <= 0)) {
      throw new RuleError('Indica el monto de la multa.');
    }

    const total = money(guarantee.amount) ?? 0;
    const aplicado = input.appliedAmount ?? 0;
    const multa = input.penaltyAmount ?? 0;
    if (aplicado + multa > total) {
      throw new RuleError(
        `Lo aplicado y la multa (${aplicado + multa}) superan la garantía tomada (${total}).`,
      );
    }

    const devuelta = to === 'DEVUELTA';
    await tx.guarantee.update({
      where: { id: guarantee.id },
      data: {
        state: input.state,
        ...(input.appliedAmount !== undefined
          ? {
              appliedAmount:
                input.appliedAmount === null ? null : new Prisma.Decimal(input.appliedAmount),
            }
          : {}),
        ...(input.applicationReason !== undefined
          ? { applicationReason: input.applicationReason }
          : {}),
        ...(input.penaltyAmount !== undefined
          ? {
              penaltyAmount:
                input.penaltyAmount === null ? null : new Prisma.Decimal(input.penaltyAmount),
            }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(devuelta ? { returnedAt: new Date(), returnedById: user.id } : {}),
      },
    });

    await syncReservationSummary(tx, guarantee.reservationReferenceId);
    return { guarantee, from, to };
  });

  await recordAudit({
    entity: 'Guarantee',
    entityId: result.guarantee.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `Garantía de la reserva ${result.guarantee.reservationReference.code}: ` +
      `${GUARANTEE_STATE_LABELS[result.from]} → ${GUARANTEE_STATE_LABELS[result.to]}`,
    before: { state: result.from },
    after: {
      state: result.to,
      appliedAmount: input.appliedAmount ?? null,
      penaltyAmount: input.penaltyAmount ?? null,
    },
  });

  return { id: result.guarantee.id };
}

export async function softDeleteGuarantee(
  user: CurrentUser,
  input: { id: string; reason: string },
): Promise<void> {
  const guarantee = await prisma.$transaction(async (tx) => {
    const found = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        state: true,
        reservationReferenceId: true,
        reservationReference: { select: { code: true } },
      },
    });
    if (!found) throw new NotFoundError('Esa garantía no existe o ya fue eliminada.');

    await tx.guarantee.update({
      where: { id: found.id },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletionReason: input.reason,
      },
    });
    await syncReservationSummary(tx, found.reservationReferenceId);
    return found;
  });

  await recordAudit({
    entity: 'Guarantee',
    entityId: guarantee.id,
    action: AuditAction.ELIMINAR,
    user,
    summary:
      `Garantía de la reserva ${guarantee.reservationReference.code} eliminada: ${input.reason}`,
    before: { state: guarantee.state },
  });
}

/** Garantías vivas que exigen atención, ordenadas por lo más antiguo. */
export async function listOpenGuarantees(limit = 50): Promise<GuaranteeWithContext[]> {
  return prisma.guarantee.findMany({
    where: {
      deletedAt: null,
      state: { in: OPEN_GUARANTEE_STATES.map((state) => GuaranteeState[state]) },
    },
    include: guaranteeInclude,
    orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

export async function listGuaranteesOfReservation(
  reservationReferenceId: string,
): Promise<GuaranteeWithContext[]> {
  return prisma.guarantee.findMany({
    where: { reservationReferenceId, deletedAt: null },
    include: guaranteeInclude,
    orderBy: { createdAt: 'desc' },
  });
}
