import 'server-only';
import {
  AuditAction,
  GuaranteeKind,
  GuaranteeState,
  GuaranteeStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  GUARANTEE_STATE_LABELS,
  OPEN_GUARANTEE_STATES,
  canTransition,
  deriveReservationGuaranteeSummary,
  outstandingAmount,
  type GuaranteeStateValue,
} from '@/domain/guarantees';
import { getMyOpenShift } from './shifts';
import {
  assertGuaranteeCanBeDeleted,
  recordGuaranteeCashIn,
  recordGuaranteeCashOut,
} from './live-cash';

type Tx = Prisma.TransactionClient;

/**
 * Desde v1.4.0 la garantía es una entidad propia de Caja.
 *
 * guestName, roomNumber y reference son contexto libre de Recepción. Los
 * vínculos a reserva/estadía se conservan únicamente para registros históricos
 * o integraciones legadas y jamás son requisito para operar una garantía nueva.
 */
export const guaranteeInclude = {
  stay: {
    select: {
      id: true,
      room: { select: { id: true, number: true } },
      guestNames: true,
    },
  },
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

function money(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

function guaranteeLabel(input: {
  reference?: string | null;
  guestName?: string | null;
  roomNumber?: string | null;
  id?: string | null;
}): string {
  if (input.reference?.trim()) return input.reference.trim();
  const parts = [
    input.guestName?.trim() || null,
    input.roomNumber?.trim() ? `Hab. ${input.roomNumber.trim()}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : `Garantía ${input.id?.slice(-6) ?? ''}`.trim();
}

/**
 * Compatibilidad histórica: sólo toca ReservationReference cuando el registro
 * realmente tiene ese vínculo legado.
 */
async function syncReservationSummary(
  tx: Tx,
  reservationReferenceId: string | null | undefined,
): Promise<void> {
  if (!reservationReferenceId) return;
  const guarantees = await tx.guarantee.findMany({
    where: { reservationReferenceId, deletedAt: null },
    select: { state: true },
  });
  const summary = deriveReservationGuaranteeSummary(
    guarantees.map((guarantee) => guarantee.state as GuaranteeStateValue),
  );
  if (!summary) return;
  await tx.reservationReference.updateMany({
    where: { id: reservationReferenceId, deletedAt: null },
    data: { guaranteeStatus: GuaranteeStatus[summary] },
  });
}

export async function createGuarantee(
  user: CurrentUser,
  input: {
    reservationReferenceId?: string | null;
    stayId?: string | null;
    roomId?: string | null;
    guestName?: string | null;
    roomNumber?: string | null;
    reference?: string | null;
    dueAt?: Date | null;
    kind: GuaranteeKind;
    amount: number;
    currency: string;
    state?: GuaranteeState;
    notes?: string | null;
  },
): Promise<{ id: string }> {
  const shift = await getMyOpenShift(user.id);
  const initialState = input.state ?? GuaranteeState.PENDIENTE;

  const guarantee = await prisma.$transaction(async (tx) => {
    const legacyReservation = input.reservationReferenceId
      ? await tx.reservationReference.findFirst({
          where: { id: input.reservationReferenceId, deletedAt: null },
          select: {
            id: true,
            code: true,
            roomNumber: true,
            guest: { select: { fullName: true } },
          },
        })
      : null;

    const created = await tx.guarantee.create({
      data: {
        reservationReferenceId: legacyReservation?.id ?? null,
        stayId: input.stayId ?? null,
        guestName: input.guestName?.trim() || legacyReservation?.guest?.fullName || null,
        roomNumber: input.roomNumber?.trim() || legacyReservation?.roomNumber || null,
        reference: input.reference?.trim() || legacyReservation?.code || null,
        dueAt: input.dueAt ?? null,
        kind: input.kind,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency.toUpperCase(),
        state: initialState,
        notes: input.notes ?? null,
        createdById: user.id,
      },
      select: {
        id: true,
        state: true,
        amount: true,
        currency: true,
        reservationReferenceId: true,
        stayId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        dueAt: true,
      },
    });

    if (input.kind === GuaranteeKind.EFECTIVO && created.state === GuaranteeState.VIGENTE) {
      await recordGuaranteeCashIn(tx, {
        user,
        guaranteeId: created.id,
        reservationReferenceId: created.reservationReferenceId,
        reservationCode: legacyReservation?.code ?? null,
        reference: guaranteeLabel(created),
        stayId: created.stayId,
        currency: created.currency,
        amount: money(created.amount) ?? input.amount,
        shiftId: shift?.id ?? null,
      });
    }

    await syncReservationSummary(tx, created.reservationReferenceId);
    return created;
  });

  await recordAudit({
    entity: 'Guarantee',
    entityId: guarantee.id,
    action: AuditAction.CREAR,
    user,
    summary:
      `${guaranteeLabel(guarantee)} · ${guarantee.currency} ${money(guarantee.amount)} · ` +
      GUARANTEE_STATE_LABELS[guarantee.state as GuaranteeStateValue],
    after: {
      state: guarantee.state,
      amount: money(guarantee.amount),
      currency: guarantee.currency,
      guestName: guarantee.guestName,
      roomNumber: guarantee.roomNumber,
      reference: guarantee.reference,
      dueAt: guarantee.dueAt,
    },
  });

  return { id: guarantee.id };
}

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
  const shift = await getMyOpenShift(user.id);

  const result = await prisma.$transaction(async (tx) => {
    const guarantee = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        kind: true,
        state: true,
        amount: true,
        appliedAmount: true,
        penaltyAmount: true,
        currency: true,
        reservationReferenceId: true,
        stayId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        reservationReference: { select: { code: true } },
      },
    });
    if (!guarantee) throw new NotFoundError('Esa garantía no existe.');

    const from = guarantee.state as GuaranteeStateValue;
    const to = input.state as GuaranteeStateValue;
    if (from === to) throw new RuleError('La garantía ya está en ese estado.');
    if (!canTransition(from, to)) {
      throw new RuleError(
        `No se puede pasar de «${GUARANTEE_STATE_LABELS[from]}» a «${GUARANTEE_STATE_LABELS[to]}».`,
      );
    }

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
    const aplicado =
      input.appliedAmount !== undefined
        ? (input.appliedAmount ?? 0)
        : (money(guarantee.appliedAmount) ?? 0);
    const multa =
      input.penaltyAmount !== undefined
        ? (input.penaltyAmount ?? 0)
        : (money(guarantee.penaltyAmount) ?? 0);

    if (aplicado + multa > total) {
      throw new RuleError(
        `Lo aplicado y la multa (${aplicado + multa}) superan la garantía tomada (${total}).`,
      );
    }

    const refundable = outstandingAmount({
      amount: total,
      appliedAmount: aplicado,
      penaltyAmount: multa,
    });

    if (
      guarantee.kind === GuaranteeKind.EFECTIVO &&
      to === 'CERRADA' &&
      (from === 'VIGENTE' || from === 'APLICADA_PARCIALMENTE') &&
      refundable > 0
    ) {
      throw new RuleError(
        'No puedes cerrar una garantía en efectivo mientras quede saldo reembolsable. Devuelve el saldo o resuélvelo como aplicación/multa antes de cerrarla.',
      );
    }

    const returnsRemainder = to === 'DEVUELTA' || to === 'MULTA';

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
        ...(returnsRemainder && refundable > 0
          ? { returnedAt: new Date(), returnedById: user.id }
          : {}),
      },
    });

    if (guarantee.kind === GuaranteeKind.EFECTIVO) {
      const reference = guaranteeLabel(guarantee);

      if (to === 'VIGENTE') {
        await recordGuaranteeCashIn(tx, {
          user,
          guaranteeId: guarantee.id,
          reservationReferenceId: guarantee.reservationReferenceId,
          reservationCode: guarantee.reservationReference?.code ?? null,
          reference,
          stayId: guarantee.stayId,
          currency: guarantee.currency,
          amount: total,
          shiftId: shift?.id ?? null,
        });
      }

      if (returnsRemainder && refundable > 0) {
        await recordGuaranteeCashOut(tx, {
          user,
          guaranteeId: guarantee.id,
          reservationReferenceId: guarantee.reservationReferenceId,
          reservationCode: guarantee.reservationReference?.code ?? null,
          reference: `Devolución · ${reference}`,
          stayId: guarantee.stayId,
          currency: guarantee.currency,
          amount: refundable,
          shiftId: shift?.id ?? null,
        });
      }
    }

    await syncReservationSummary(tx, guarantee.reservationReferenceId);
    return { guarantee, from, to };
  });

  await recordAudit({
    entity: 'Guarantee',
    entityId: result.guarantee.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `${guaranteeLabel(result.guarantee)}: ` +
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
  await assertGuaranteeCanBeDeleted(input.id);

  const guarantee = await prisma.$transaction(async (tx) => {
    const found = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        state: true,
        reservationReferenceId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
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
    summary: `${guaranteeLabel(guarantee)} eliminada: ${input.reason}`,
    before: { state: guarantee.state },
  });
}

export async function listOpenGuarantees(limit = 50): Promise<GuaranteeWithContext[]> {
  return prisma.guarantee.findMany({
    where: {
      deletedAt: null,
      state: { in: OPEN_GUARANTEE_STATES.map((state) => GuaranteeState[state]) },
    },
    include: guaranteeInclude,
    orderBy: [{ state: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

/** Compatibilidad para pantallas históricas no operativas. */
export async function listGuaranteesOfReservation(
  reservationReferenceId: string,
): Promise<GuaranteeWithContext[]> {
  return prisma.guarantee.findMany({
    where: { reservationReferenceId, deletedAt: null },
    include: guaranteeInclude,
    orderBy: { createdAt: 'desc' },
  });
}
