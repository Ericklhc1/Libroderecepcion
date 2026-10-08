import { assertAuthorizedRevision } from '@/server/security/authorized-revision';
import 'server-only';
import {
  AuditAction,
  GuaranteeKind,
  GuaranteeSettlementKind,
  GuaranteeState,
  GuaranteeStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { isOperationalRoomNumber } from '@/domain/room-catalog';
import {
  GUARANTEE_STATE_LABELS,
  OPEN_GUARANTEE_STATES,
  CASH_SETTLEMENT_GUARANTEE_STATES,
  canTransition,
  deriveReservationGuaranteeSummary,
  outstandingAmount,
  type GuaranteeStateValue,
} from '@/domain/guarantees';
import { getMyOpenShift } from './shifts';
import {ensureUnresolvedGuaranteeIncidents,lockReservationGuaranteeCreation} from './stay-guarantee-incidents';
import {
  assertGuaranteeCanBeDeleted,
  insertCashMovement,
  recordGuaranteeChargeOut,
  recordGuaranteeCashIn,
  recordGuaranteeCashOut,
} from './live-cash';
import {
  SUPERVISION_BACKUP_EMAIL,
  operationalMailTimestamp,
  queueOperationalMail,
} from './operational-mail';

type Tx = Prisma.TransactionClient;

/**
 * Desde v1.4.0 la garantía es una entidad propia de Caja.
 *
 * guestName y reference son contexto libre de Recepción. roomNumber usa el
 * catálogo canónico de 89 habitaciones. Los vínculos a reserva/estadía se
 * conservan únicamente para registros históricos
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
  settlements: {
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  },
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
    const simpleMode=input.reservationReferenceId?await lockReservationGuaranteeCreation(tx,input.reservationReferenceId):false;
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

    const explicitRoomNumber = input.roomNumber?.trim() || null;
    if (explicitRoomNumber && !isOperationalRoomNumber(explicitRoomNumber)) {
      throw new RuleError('Selecciona una habitación válida del hotel.');
    }

    const roomFromId = input.roomId
      ? await tx.room.findFirst({
          where: { id: input.roomId, active: true },
          select: { number: true },
        })
      : null;
    if (input.roomId && (!roomFromId || !isOperationalRoomNumber(roomFromId.number))) {
      throw new RuleError('La habitación seleccionada no pertenece al catálogo operativo.');
    }

    const roomNumber =
      explicitRoomNumber || roomFromId?.number || legacyReservation?.roomNumber || null;

    const created = await tx.guarantee.create({
      data: {
        reservationReferenceId: legacyReservation?.id ?? null,
        stayId: input.stayId ?? null,
        guestName: input.guestName?.trim() || legacyReservation?.guest?.fullName || null,
        roomNumber,
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
        kind: true,
        amount: true,
        currency: true,
        reservationReferenceId: true,
        stayId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        dueAt: true,
        notes: true,
        createdAt: true,
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
    // Late capture belongs to the simple trial; OFF keeps the legacy creation flow.
    if(simpleMode&&created.reservationReferenceId&&OPEN_GUARANTEE_STATES.includes(created.state)&&await tx.roomStay.count({where:{reservationRefId:created.reservationReferenceId,deletedAt:null,status:'CHECK_OUT',stage:'FINALIZADO'}})){
      await ensureUnresolvedGuaranteeIncidents(user,created.reservationReferenceId,created.roomNumber,{client:tx,guaranteeId:created.id});
    }

    await queueOperationalMail(tx, {
      eventKey: `guarantee-created:${created.id}`,
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: `[Libro Operativo] GARANTÍA · ${guaranteeLabel(created)} · ${created.currency} ${money(created.amount)}`,
      text: [
        'GARANTÍA REGISTRADA',
        `ID: ${created.id}`,
        `Fecha/hora: ${operationalMailTimestamp(created.createdAt)}`,
        `Registrado por: ${user.name} (ID ${user.id})`,
        `Turno: ${shift?.id ?? 'sin turno asociado'}`,
        `Tipo: ${created.kind}`,
        `Estado inicial: ${GUARANTEE_STATE_LABELS[created.state as GuaranteeStateValue]}`,
        `Monto: ${created.currency} ${money(created.amount)}`,
        `Referencia: ${created.reference ?? 'sin referencia'}`,
        `Huésped: ${created.guestName ?? 'sin huésped'}`,
        `Habitación: ${created.roomNumber ?? 'sin habitación'}`,
        `Fecha objetivo: ${created.dueAt ? operationalMailTimestamp(created.dueAt) : 'sin fecha objetivo'}`,
        `Notas: ${created.notes ?? 'sin observaciones'}`,
      ].join('\n'),
    });

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

export async function updateGuarantee(
  user: CurrentUser,
  input: {
    id: string;
    guestName?: string | null;
    roomNumber?: string | null;
    reference?: string | null;
    dueAt?: Date | null;
    kind?: GuaranteeKind;
    amount?: number;
    currency?: string;
    notes?: string | null;
  },
  expectedRevision?:string,
): Promise<{ id: string }> {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${input.id} FOR UPDATE`;
    if(expectedRevision)assertAuthorizedRevision(expectedRevision,await tx.guarantee.findUnique({where:{id:input.id}}));
    const guarantee = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      include: {
        cashMovements: {
          where: { voidedAt: null },
          select: {
            id: true,
            kind: true,
            currency: true,
            amount: true,
          },
        },
      },
    });
    if (!guarantee) throw new NotFoundError('Esa garantía no existe.');

    const nextGuestName =
      input.guestName === undefined ? guarantee.guestName : input.guestName?.trim() || null;
    const nextRoomNumber =
      input.roomNumber === undefined ? guarantee.roomNumber : input.roomNumber?.trim() || null;
    const nextReference =
      input.reference === undefined ? guarantee.reference : input.reference?.trim() || null;
    const nextDueAt = input.dueAt === undefined ? guarantee.dueAt : input.dueAt;
    const nextKind = input.kind ?? guarantee.kind;
    const nextAmount = input.amount ?? money(guarantee.amount) ?? 0;
    const nextCurrency = (input.currency ?? guarantee.currency).trim().toUpperCase();
    const nextNotes = input.notes === undefined ? guarantee.notes : input.notes?.trim() || null;

    if (nextRoomNumber && !isOperationalRoomNumber(nextRoomNumber)) {
      throw new RuleError('Selecciona una habitación válida del hotel.');
    }
    if (!(nextAmount > 0)) throw new RuleError('El monto debe ser mayor que cero.');
    if (!/^[A-Z]{3}$/.test(nextCurrency)) {
      throw new RuleError('La moneda debe tener tres letras.');
    }
    if (
      !guarantee.reservationReferenceId &&
      !guarantee.stayId &&
      !nextGuestName &&
      !nextRoomNumber &&
      !nextReference
    ) {
      throw new RuleError(
        'Indica al menos huésped, habitación o referencia para identificar esta garantía.',
      );
    }

    const applied = money(guarantee.appliedAmount) ?? 0;
    const penalty = money(guarantee.penaltyAmount) ?? 0;
    const returned = money(guarantee.returnedAmount) ?? 0;
    if (applied + penalty + returned > nextAmount) {
      throw new RuleError(
        `El monto editado (${nextAmount}) no puede quedar por debajo de lo ya aplicado, cobrado o devuelto (${applied + penalty + returned}).`,
      );
    }

    const amountChanged = nextAmount !== (money(guarantee.amount) ?? 0);
    const currencyChanged = nextCurrency !== guarantee.currency;
    const kindChanged = nextKind !== guarantee.kind;
    const financialChanged = amountChanged || currencyChanged || kindChanged;
    const terminal =
      guarantee.state === GuaranteeState.DEVUELTA ||
      guarantee.state === GuaranteeState.MULTA ||
      guarantee.state === GuaranteeState.CERRADA;

    if (financialChanged && terminal) {
      throw new RuleError(
        'Una garantía ya devuelta, cobrada o cerrada conserva sus datos financieros históricos. Puedes corregir huésped, habitación, referencia, fecha u observaciones.',
      );
    }
    if (kindChanged && guarantee.state !== GuaranteeState.PENDIENTE) {
      throw new RuleError(
        'La forma de garantía sólo puede cambiarse mientras está pendiente. Una vez vigente, corrige únicamente sus demás datos.',
      );
    }
    if (
      currencyChanged &&
      guarantee.state === GuaranteeState.APLICADA_PARCIALMENTE &&
      (applied > 0 || penalty > 0 || returned > 0)
    ) {
      throw new RuleError(
        'No se puede cambiar la moneda después de aplicar parte de la garantía.',
      );
    }

    const cashIn = guarantee.cashMovements.find((movement) => movement.kind === 'GARANTIA_INGRESO');
    const hasSettlement = guarantee.cashMovements.some(
      (movement) =>
        movement.kind === 'GARANTIA_DEVOLUCION' || movement.kind === 'GARANTIA_COBRO',
    );

    if (
      guarantee.kind === GuaranteeKind.EFECTIVO &&
      (guarantee.state === GuaranteeState.VIGENTE ||
        guarantee.state === GuaranteeState.APLICADA_PARCIALMENTE) &&
      (amountChanged || currencyChanged)
    ) {
      if (hasSettlement) {
        throw new RuleError(
          'La garantía ya tiene una devolución o cobro registrado y su monto/moneda no puede reescribirse.',
        );
      }
      if (!cashIn) {
        throw new RuleError(
          'La garantía en efectivo no tiene su movimiento de ingreso vinculado. Regularízala antes de cambiar monto o moneda.',
        );
      }
      await tx.cashMovement.update({
        where: { id: cashIn.id },
        data: {
          amount: new Prisma.Decimal(nextAmount),
          currency: nextCurrency,
        },
      });
    }

    const row = await tx.guarantee.update({
      where: { id: guarantee.id },
      data: {
        guestName: nextGuestName,
        roomNumber: nextRoomNumber,
        reference: nextReference,
        dueAt: nextDueAt,
        kind: nextKind,
        amount: new Prisma.Decimal(nextAmount),
        currency: nextCurrency,
        notes: nextNotes,
      },
    });

    await recordAudit(
      {
        entity: 'Guarantee',
        entityId: guarantee.id,
        action: AuditAction.EDITAR,
        user,
        summary: `${guaranteeLabel(row)} editada por ${user.name}`,
        before: {
          guestName: guarantee.guestName,
          roomNumber: guarantee.roomNumber,
          reference: guarantee.reference,
          dueAt: guarantee.dueAt,
          kind: guarantee.kind,
          amount: money(guarantee.amount),
          currency: guarantee.currency,
          notes: guarantee.notes,
        },
        after: {
          guestName: row.guestName,
          roomNumber: row.roomNumber,
          reference: row.reference,
          dueAt: row.dueAt,
          kind: row.kind,
          amount: money(row.amount),
          currency: row.currency,
          notes: row.notes,
          linkedCashInAdjusted: Boolean(cashIn && (amountChanged || currencyChanged)),
        },
      },
      tx,
    );

    return row;
  });

  return { id: updated.id };
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
    removeSettledCash?: boolean;
    settlementConcept?: string | null;
  },
  expectedRevision?:string,
): Promise<{ id: string }> {
  const shift = await getMyOpenShift(user.id);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${input.id} FOR UPDATE`;
    if(expectedRevision)assertAuthorizedRevision(expectedRevision,await tx.guarantee.findUnique({where:{id:input.id}}));
    const guarantee = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        kind: true,
        state: true,
        amount: true,
        appliedAmount: true,
        penaltyAmount: true,
        returnedAmount: true,
        currency: true,
        reservationReferenceId: true,
        stayId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        notes: true,
        reservationReference: { select: { code: true } },
      },
    });
    if (!guarantee) throw new NotFoundError('Esa garantía no existe.');

    const partialSettlements = await tx.guaranteeSettlement.count({
      where: { guaranteeId: guarantee.id },
    });

    const from = guarantee.state as GuaranteeStateValue;
    const to = input.state as GuaranteeStateValue;
    if (from === to) throw new RuleError('La garantía ya está en ese estado.');
    if (!canTransition(from, to)) {
      throw new RuleError(
        `No se puede pasar de «${GUARANTEE_STATE_LABELS[from]}» a «${GUARANTEE_STATE_LABELS[to]}».`,
      );
    }
    if (
      guarantee.kind === GuaranteeKind.EFECTIVO &&
      partialSettlements > 0 &&
      (to === 'DEVUELTA' || to === 'MULTA')
    ) {
      throw new RuleError(
        'Esta garantía ya tiene devoluciones o cobros parciales. Continúa desde Caja para resolver únicamente el saldo restante.',
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

    const devuelto = money(guarantee.returnedAmount) ?? 0;
    if (aplicado + multa + devuelto > total) {
      throw new RuleError(
        `Lo aplicado, cobrado y devuelto (${aplicado + multa + devuelto}) supera la garantía tomada (${total}).`,
      );
    }

    const refundable = outstandingAmount({
      amount: total,
      appliedAmount: aplicado,
      penaltyAmount: multa,
      returnedAmount: devuelto,
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
    const settledOutsideCash = input.removeSettledCash
      ? Math.min(total, aplicado + multa)
      : 0;

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

      if (settledOutsideCash > 0) {
        await recordGuaranteeChargeOut(tx, {
          user,
          guaranteeId: guarantee.id,
          reservationReferenceId: guarantee.reservationReferenceId,
          reservationCode: guarantee.reservationReference?.code ?? null,
          reference: `Cobro garantía · ${input.settlementConcept?.trim() || input.applicationReason?.trim() || reference}`,
          roomNumber: guarantee.roomNumber,
          stayId: guarantee.stayId,
          currency: guarantee.currency,
          amount: settledOutsideCash,
          shiftId: shift?.id ?? null,
          notes:
            input.notes ??
            'Garantía cobrada/aplicada: se registra para reportería y deja de formar parte de Caja viva.',
        });
      }
    }

    await syncReservationSummary(tx, guarantee.reservationReferenceId);

    if ((returnsRemainder && refundable > 0) || settledOutsideCash > 0) {
      const isCharge = settledOutsideCash > 0;
      await queueOperationalMail(tx, {
        eventKey: isCharge
          ? `guarantee-charge:${guarantee.id}:${to}`
          : `guarantee-return:${guarantee.id}:${to}`,
        recipients: [SUPERVISION_BACKUP_EMAIL],
        subject: isCharge
          ? `[AROH Central IA] GARANTÍA COBRADA · ${guaranteeLabel(guarantee)} · ${guarantee.currency} ${settledOutsideCash}`
          : `[AROH Central IA] DEVOLUCIÓN GARANTÍA · ${guaranteeLabel(guarantee)} · ${guarantee.currency} ${refundable}`,
        text: [
          isCharge ? 'COBRO / CIERRE DE GARANTÍA' : 'DEVOLUCIÓN / CIERRE DE GARANTÍA',
          `ID: ${guarantee.id}`,
          `Fecha/hora: ${operationalMailTimestamp(new Date())}`,
          `Procesado por: ${user.name} (ID ${user.id})`,
          `Turno: ${shift?.id ?? 'sin turno asociado'}`,
          `Tipo: ${guarantee.kind}`,
          `Estado anterior: ${GUARANTEE_STATE_LABELS[from]}`,
          `Estado nuevo: ${GUARANTEE_STATE_LABELS[to]}`,
          `Monto original: ${guarantee.currency} ${total}`,
          `Monto aplicado: ${guarantee.currency} ${aplicado}`,
          `Multa: ${guarantee.currency} ${multa}`,
          `Monto devuelto: ${guarantee.currency} ${refundable}`,
          `Monto cobrado/aplicado fuera de Caja viva: ${guarantee.currency} ${settledOutsideCash}`,
          `Concepto de cobro: ${input.settlementConcept ?? input.applicationReason ?? 'no aplica'}`,
          `Referencia: ${guarantee.reference ?? guarantee.reservationReference?.code ?? 'sin referencia'}`,
          `Huésped: ${guarantee.guestName ?? 'sin huésped'}`,
          `Habitación: ${guarantee.roomNumber ?? 'sin habitación'}`,
          `Motivo de aplicación: ${input.applicationReason ?? 'no aplica'}`,
          `Notas: ${input.notes ?? guarantee.notes ?? 'sin observaciones'}`,
        ].join('\n'),
      });
    }

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
      applicationReason: input.applicationReason ?? null,
      settlementConcept: input.settlementConcept ?? null,
      removeSettledCash: input.removeSettledCash ?? false,
      notes: input.notes ?? null,
    },
  });

  return { id: result.guarantee.id };
}

export async function settleGuarantee(
  user: CurrentUser,
  input: {
    id: string;
    requestKey: string;
    kind: GuaranteeSettlementKind;
    amount: number;
    reason: string;
    notes?: string | null;
  },
  expectedRevision?: string,
): Promise<{
  id: string;
  settlementId: string;
  remaining: number;
  state: GuaranteeState;
  eventKey: string;
  repeated: boolean;
}> {
  const reason = input.reason.trim();
  const notes = input.notes?.trim() || null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey)) {
    throw new RuleError('La referencia de la operación no es válida.');
  }
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) {
    throw new RuleError('El monto debe ser mayor que cero.');
  }
  if (reason.length < 3) throw new RuleError('Indica el motivo de la devolución o cobro.');

  const shift = await getMyOpenShift(user.id);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;
    const previous = await tx.guaranteeSettlement.findUnique({
      where: { requestKey: input.requestKey },
      include: { guarantee: true },
    });
    if (previous) {
      const same =
        previous.guaranteeId === input.id &&
        previous.createdById === user.id &&
        previous.kind === input.kind &&
        previous.amount.toNumber() === input.amount &&
        previous.reason === reason &&
        previous.notes === notes;
      if (!same) {
        throw new RuleError('Esta operación ya fue guardada con otro contenido. Recarga antes de continuar.');
      }
      return {
        id: previous.guaranteeId,
        settlementId: previous.id,
        remaining: outstandingAmount({
          amount: previous.guarantee.amount.toNumber(),
          appliedAmount: money(previous.guarantee.appliedAmount),
          penaltyAmount: money(previous.guarantee.penaltyAmount),
          returnedAmount: money(previous.guarantee.returnedAmount),
        }),
        state: previous.guarantee.state,
        eventKey: `guarantee-settlement:${previous.id}`,
        repeated: true,
      };
    }

    await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${input.id} FOR UPDATE`;
    if (expectedRevision) {
      assertAuthorizedRevision(
        expectedRevision,
        await tx.guarantee.findUnique({ where: { id: input.id } }),
      );
    }
    const guarantee = await tx.guarantee.findFirst({
      where: { id: input.id, deletedAt: null },
      select: {
        id: true,
        kind: true,
        state: true,
        amount: true,
        appliedAmount: true,
        penaltyAmount: true,
        returnedAmount: true,
        currency: true,
        reservationReferenceId: true,
        stayId: true,
        guestName: true,
        roomNumber: true,
        reference: true,
        notes: true,
        reservationReference: { select: { code: true } },
      },
    });
    if (!guarantee) throw new NotFoundError('Esa garantía no existe.');
    if (!CASH_SETTLEMENT_GUARANTEE_STATES.includes(guarantee.state)) {
      throw new RuleError('Esa garantía no admite otra devolución o cobro.');
    }

    const total = guarantee.amount.toNumber();
    const applied = money(guarantee.appliedAmount) ?? 0;
    const penalty = money(guarantee.penaltyAmount) ?? 0;
    const returned = money(guarantee.returnedAmount) ?? 0;
    const available = outstandingAmount({
      amount: total,
      appliedAmount: applied,
      penaltyAmount: penalty,
      returnedAmount: returned,
    });
    if (input.amount > available) {
      throw new RuleError(
        `El monto supera el saldo disponible de la garantía (${guarantee.currency} ${available}).`,
      );
    }

    const settlement = await tx.guaranteeSettlement.create({
      data: {
        requestKey: input.requestKey,
        guaranteeId: guarantee.id,
        kind: input.kind,
        amount: new Prisma.Decimal(input.amount),
        currency: guarantee.currency,
        reason,
        notes,
        createdById: user.id,
        shiftId: shift?.id ?? null,
      },
    });

    let cashMovementId: string | null = null;
    if (guarantee.kind === GuaranteeKind.EFECTIVO) {
      cashMovementId = await insertCashMovement(tx, {
        userId: user.id,
        kind:
          input.kind === GuaranteeSettlementKind.DEVOLUCION
            ? 'GARANTIA_DEVOLUCION'
            : 'GARANTIA_COBRO',
        direction: 'SALIDA',
        currency: guarantee.currency,
        amount: input.amount,
        shiftId: shift?.id ?? null,
        stayId: guarantee.stayId,
        reservationReferenceId: guarantee.reservationReferenceId,
        guaranteeId: guarantee.id,
        reference:
          input.kind === GuaranteeSettlementKind.DEVOLUCION
            ? `Devolución parcial · ${guaranteeLabel(guarantee)}`
            : `Cobro parcial · ${reason} · ${guaranteeLabel(guarantee)}`,
        notes:
          notes ??
          (input.kind === GuaranteeSettlementKind.DEVOLUCION
            ? 'Devolución física parcial o total de garantía.'
            : 'Cobro parcial o total aplicado desde la garantía.'),
      });
      await tx.guaranteeSettlement.update({
        where: { id: settlement.id },
        data: { cashMovementId },
      });
    }

    const nextReturned =
      returned + (input.kind === GuaranteeSettlementKind.DEVOLUCION ? input.amount : 0);
    const nextPenalty =
      penalty + (input.kind === GuaranteeSettlementKind.COBRO ? input.amount : 0);
    const remaining = outstandingAmount({
      amount: total,
      appliedAmount: applied,
      penaltyAmount: nextPenalty,
      returnedAmount: nextReturned,
    });
    const nextState =
      remaining > 0
        ? GuaranteeState.APLICADA_PARCIALMENTE
        : input.kind === GuaranteeSettlementKind.DEVOLUCION && applied + nextPenalty === 0
          ? GuaranteeState.DEVUELTA
          : GuaranteeState.CERRADA;

    await tx.guarantee.update({
      where: { id: guarantee.id },
      data: {
        state: nextState,
        returnedAmount: new Prisma.Decimal(nextReturned),
        penaltyAmount: nextPenalty > 0 ? new Prisma.Decimal(nextPenalty) : null,
        ...(input.kind === GuaranteeSettlementKind.COBRO ? { applicationReason: reason } : {}),
        ...(input.kind === GuaranteeSettlementKind.DEVOLUCION
          ? { returnedAt: new Date(), returnedById: user.id }
          : {}),
      },
    });

    await syncReservationSummary(tx, guarantee.reservationReferenceId);

    const eventKey = `guarantee-settlement:${settlement.id}`;
    await queueOperationalMail(tx, {
      eventKey,
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject:
        `[AROH Central IA] GARANTÍA ${input.kind === GuaranteeSettlementKind.DEVOLUCION ? 'DEVUELTA' : 'COBRADA'} · ` +
        `${guaranteeLabel(guarantee)} · ${guarantee.currency} ${input.amount}`,
      text: [
        input.kind === GuaranteeSettlementKind.DEVOLUCION ? 'DEVOLUCIÓN DE GARANTÍA' : 'COBRO SOBRE GARANTÍA',
        `Garantía: #${guarantee.id}`,
        `Operación: ${settlement.id}`,
        `Fecha/hora: ${operationalMailTimestamp(new Date())}`,
        `Procesado por: ${user.name} (ID ${user.id})`,
        `Turno: ${shift?.id ?? 'sin turno asociado'}`,
        `Moneda: ${guarantee.currency}`,
        `Monto de esta operación: ${input.amount}`,
        `Saldo restante: ${remaining}`,
        `Motivo: ${reason}`,
        `Referencia: ${guarantee.reference ?? guarantee.reservationReference?.code ?? 'sin referencia'}`,
        `Huésped: ${guarantee.guestName ?? 'sin huésped'}`,
        `Habitación: ${guarantee.roomNumber ?? 'sin habitación'}`,
        `Notas: ${notes ?? 'sin observaciones'}`,
      ].join('\n'),
    });

    await recordAudit(
      {
        entity: 'GuaranteeSettlement',
        entityId: settlement.id,
        action: AuditAction.CREAR,
        user,
        summary:
          `${input.kind === GuaranteeSettlementKind.DEVOLUCION ? 'Devolución' : 'Cobro'} ` +
          `${guarantee.currency} ${input.amount} sobre ${guaranteeLabel(guarantee)} · saldo ${remaining}`,
        before: { state: guarantee.state, remaining: available },
        after: {
          kind: input.kind,
          amount: input.amount,
          currency: guarantee.currency,
          reason,
          remaining,
          state: nextState,
          cashMovementId,
        },
      },
      tx,
    );

    return {
      id: guarantee.id,
      settlementId: settlement.id,
      remaining,
      state: nextState,
      eventKey,
      repeated: false,
    };
  });
}

export async function softDeleteGuarantee(
  user: CurrentUser,
  input: { id: string; reason: string },
  expectedRevision?:string,
): Promise<void> {
  await assertGuaranteeCanBeDeleted(input.id);

  const guarantee = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Guarantee" WHERE "id"=${input.id} FOR UPDATE`;
    if(expectedRevision)assertAuthorizedRevision(expectedRevision,await tx.guarantee.findUnique({where:{id:input.id}}));
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
