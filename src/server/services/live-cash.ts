import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  EntryStatus,
  EntryType,
  GuaranteeKind,
  GuaranteeState,
  Priority,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { getMyOpenShift } from './shifts';
import { getSettingNumber } from './settings';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type CashDirection = 'ENTRADA' | 'SALIDA';
export type CashMovementKind =
  | 'GARANTIA_INGRESO'
  | 'GARANTIA_DEVOLUCION'
  | 'VENTA_GIMNASIO'
  | 'ANULACION_GIMNASIO'
  | 'TESORERIA'
  | 'AJUSTE_ENTRADA'
  | 'AJUSTE_SALIDA';
export type GymPaymentMethod = 'EFECTIVO' | 'TARJETA' | 'OTRO';

export type LiveCashMovement = {
  id: string;
  kind: CashMovementKind;
  direction: CashDirection;
  currency: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  roomNumber: string | null;
  reservationCode: string | null;
  stayId: string | null;
  guestName: string | null;
  createdByName: string;
  createdAt: Date;
};

export type GymPassRow = {
  id: string;
  folio: number;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
  receptionistName: string;
  currency: string;
  amount: number;
  paymentMethod: GymPaymentMethod;
  status: 'EMITIDO' | 'ANULADO';
  issuedAt: Date;
  voidReason: string | null;
};

export type CashAuditRow = {
  id: string;
  currency: string;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
  countedByName: string;
  notes: string | null;
  createdAt: Date;
};

export type LiveCashState = {
  denominations: Array<{
    id: string;
    currency: string;
    value: number;
    medium: 'BILLETE' | 'MONEDA';
  }>;
  currencies: Array<{
    currency: string;
    fund: number;
    netMovements: number;
    expected: number;
  }>;
  movements: LiveCashMovement[];
  cashGuarantees: Array<{
    id: string;
    reservationCode: string;
    roomNumber: string | null;
    guestName: string | null;
    currency: string;
    amount: number;
    state: string;
    createdAt: Date;
  }>;
  gymPasses: GymPassRow[];
  audits: CashAuditRow[];
};

function decimal(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function formatGymFolio(folio: number): string {
  return String(folio).padStart(6, '0');
}

export async function gymPrices() {
  const [clp, usd] = await Promise.all([
    getSettingNumber('gym.passPriceCLP', 6000),
    getSettingNumber('gym.passPriceUSD', 6),
  ]);
  return { CLP: clp, USD: usd };
}

async function cashMovementExists(
  client: Db,
  params: { guaranteeId?: string; gymPassId?: string; kind: CashMovementKind },
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS(
      SELECT 1
      FROM "CashMovement"
      WHERE "voidedAt" IS NULL
        AND "kind" = ${params.kind}
        AND (${params.guaranteeId ?? null}::text IS NULL OR "guaranteeId" = ${params.guaranteeId ?? null})
        AND (${params.gymPassId ?? null}::text IS NULL OR "gymPassId" = ${params.gymPassId ?? null})
    ) AS "exists"
  `;
  return Boolean(rows[0]?.exists);
}

export async function insertCashMovement(
  client: Db,
  params: {
    userId: string;
    kind: CashMovementKind;
    direction: CashDirection;
    currency: string;
    amount: number;
    shiftId?: string | null;
    roomId?: string | null;
    stayId?: string | null;
    guestId?: string | null;
    reservationReferenceId?: string | null;
    guaranteeId?: string | null;
    gymPassId?: string | null;
    cashTransferId?: string | null;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  if (!(params.amount > 0)) throw new RuleError('El movimiento de caja debe ser mayor que cero.');
  const currency = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new RuleError('La moneda debe tener tres letras.');
  const id = randomUUID();
  await client.$executeRaw`
    INSERT INTO "CashMovement" (
      "id", "kind", "direction", "currency", "amount", "shiftId", "roomId",
      "stayId", "guestId", "reservationReferenceId", "guaranteeId", "gymPassId",
      "cashTransferId", "createdById", "reference", "notes"
    ) VALUES (
      ${id}, ${params.kind}, ${params.direction}, ${currency}, ${params.amount},
      ${params.shiftId ?? null}, ${params.roomId ?? null},
      ${params.stayId ?? null}, ${params.guestId ?? null},
      ${params.reservationReferenceId ?? null}, ${params.guaranteeId ?? null},
      ${params.gymPassId ?? null}, ${params.cashTransferId ?? null},
      ${params.userId}, ${params.reference ?? null}, ${params.notes ?? null}
    )
  `;
  return id;
}

export async function recordGuaranteeCashIn(
  tx: Tx,
  params: {
    user: CurrentUser;
    guaranteeId: string;
    reservationReferenceId: string;
    reservationCode: string;
    roomId?: string | null;
    stayId?: string | null;
    guestId?: string | null;
    currency: string;
    amount: number;
    shiftId?: string | null;
  },
): Promise<void> {
  if (
    await cashMovementExists(tx, {
      guaranteeId: params.guaranteeId,
      kind: 'GARANTIA_INGRESO',
    })
  ) return;

  await insertCashMovement(tx, {
    userId: params.user.id,
    kind: 'GARANTIA_INGRESO',
    direction: 'ENTRADA',
    currency: params.currency,
    amount: params.amount,
    shiftId: params.shiftId ?? null,
    roomId: params.roomId ?? null,
    stayId: params.stayId ?? null,
    guestId: params.guestId ?? null,
    reservationReferenceId: params.reservationReferenceId,
    guaranteeId: params.guaranteeId,
    reference: `Garantía reserva ${params.reservationCode}`,
    notes: 'Garantía en efectivo ingresada a caja.',
  });
}

export async function recordGuaranteeCashOut(
  tx: Tx,
  params: {
    user: CurrentUser;
    guaranteeId: string;
    reservationReferenceId: string;
    reservationCode: string;
    roomId?: string | null;
    stayId?: string | null;
    guestId?: string | null;
    currency: string;
    amount: number;
    shiftId?: string | null;
  },
): Promise<void> {
  const hasIn = await cashMovementExists(tx, {
    guaranteeId: params.guaranteeId,
    kind: 'GARANTIA_INGRESO',
  });
  if (!hasIn) return;
  if (
    await cashMovementExists(tx, {
      guaranteeId: params.guaranteeId,
      kind: 'GARANTIA_DEVOLUCION',
    })
  ) return;

  const originalContext = await tx.cashMovement.findFirst({
    where: {
      guaranteeId: params.guaranteeId,
      kind: 'GARANTIA_INGRESO',
      voidedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: { roomId: true, stayId: true, guestId: true },
  });

  await insertCashMovement(tx, {
    userId: params.user.id,
    kind: 'GARANTIA_DEVOLUCION',
    direction: 'SALIDA',
    currency: params.currency,
    amount: params.amount,
    shiftId: params.shiftId ?? null,
    roomId: originalContext?.roomId ?? params.roomId ?? null,
    stayId: originalContext?.stayId ?? params.stayId ?? null,
    guestId: originalContext?.guestId ?? params.guestId ?? null,
    reservationReferenceId: params.reservationReferenceId,
    guaranteeId: params.guaranteeId,
    reference: `Devolución garantía ${params.reservationCode}`,
    notes: 'Garantía en efectivo devuelta al huésped.',
  });
}

export async function assertGuaranteeCanBeDeleted(guaranteeId: string): Promise<void> {
  const hasIn = await cashMovementExists(prisma, { guaranteeId, kind: 'GARANTIA_INGRESO' });
  const hasOut = await cashMovementExists(prisma, { guaranteeId, kind: 'GARANTIA_DEVOLUCION' });
  if (hasIn && !hasOut) {
    throw new RuleError(
      'Esta garantía tiene efectivo en caja. Devuélvela o resuélvela antes de eliminarla.',
    );
  }
}

export async function findGymReservation(params: {
  roomNumber?: string | null;
  reservationCode?: string | null;
}) {
  const code = params.reservationCode?.trim();
  const roomNumber = params.roomNumber?.trim();
  if (!code && !roomNumber) return null;

  return prisma.reservationReference.findFirst({
    where: {
      deletedAt: null,
      ...(code ? { code } : { roomNumber }),
    },
    include: { guest: { select: { fullName: true } } },
    orderBy: [{ checkIn: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createGymPass(
  user: CurrentUser,
  params: {
    reservationReferenceId: string;
    currency: 'CLP' | 'USD';
    paymentMethod: GymPaymentMethod;
  },
): Promise<{ id: string; folio: number; formattedFolio: string }> {
  const [reservation, prices, shift] = await Promise.all([
    prisma.reservationReference.findFirst({
      where: { id: params.reservationReferenceId, deletedAt: null },
      include: { guest: { select: { id: true, fullName: true } } },
    }),
    gymPrices(),
    getMyOpenShift(user.id),
  ]);
  if (!reservation) throw new NotFoundError('La reserva ya no existe.');
  if (!reservation.roomNumber) throw new RuleError('La reserva no tiene habitación asociada.');
  if (!reservation.guest?.fullName) throw new RuleError('La reserva no tiene huésped asociado.');
  if (!shift) throw new RuleError('Debes estar asignado al turno vigente para vender un pase.');

  const room = await prisma.room.findUnique({
    where: { number: reservation.roomNumber },
    select: { id: true },
  });
  if (!room) throw new NotFoundError(`No existe la habitación ${reservation.roomNumber}.`);

  const amount = params.currency === 'CLP' ? prices.CLP : prices.USD;
  if (!(amount > 0)) throw new RuleError('El precio del pase no está configurado correctamente.');

  const created = await prisma.$transaction(async (tx) => {
    const seq = await tx.$queryRaw<Array<{ folio: bigint }>>`
      SELECT nextval('"gym_pass_folio_seq"') AS "folio"
    `;
    const folio = Number(seq[0]?.folio);
    if (!Number.isSafeInteger(folio) || folio < 1 || folio > 999999) {
      throw new RuleError('No quedan folios de gimnasio disponibles.');
    }
    const formatted = formatGymFolio(folio);

    const entry = await tx.operationalEntry.create({
      data: {
        type: EntryType.CAJA,
        status: EntryStatus.RESUELTO,
        title: `Pase gimnasio ${formatted}`,
        description:
          `Pase de gimnasio emitido. Folio ${formatted}. ` +
          `Reserva ${reservation.code}. Huésped ${reservation.guest!.fullName}. ` +
          `Habitación ${reservation.roomNumber}. ${params.currency} ${amount}. ` +
          `Pago: ${params.paymentMethod.toLowerCase()}.`,
        category: 'PASE_GIMNASIO',
        roomId: room.id,
        reservationId: reservation.id,
        guestId: reservation.guestId,
        priority: Priority.BAJA,
        ownerId: user.id,
        shiftId: shift.id,
        occurredAt: new Date(),
        tags: ['gimnasio', `folio-${formatted}`],
        requiresFollowUp: false,
        resolution: `Folio ${formatted} emitido.`,
        createdById: user.id,
      },
      select: { id: true },
    });

    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO "GymPass" (
        "id", "folio", "reservationReferenceId", "roomId", "guestName",
        "receptionistId", "shiftId", "operationalEntryId", "currency", "amount",
        "paymentMethod"
      ) VALUES (
        ${id}, ${folio}, ${reservation.id}, ${room.id}, ${reservation.guest!.fullName},
        ${user.id}, ${shift.id}, ${entry.id}, ${params.currency}, ${amount},
        ${params.paymentMethod}
      )
    `;

    if (params.paymentMethod === 'EFECTIVO') {
      await insertCashMovement(tx, {
        userId: user.id,
        kind: 'VENTA_GIMNASIO',
        direction: 'ENTRADA',
        currency: params.currency,
        amount,
        shiftId: shift.id,
        roomId: room.id,
        reservationReferenceId: reservation.id,
        gymPassId: id,
        reference: `Folio ${formatted}`,
        notes: `Pase de gimnasio · ${reservation.guest!.fullName}`,
      });
    }

    await recordAudit(
      {
        entity: 'GymPass',
        entityId: id,
        action: AuditAction.CREAR,
        user,
        summary: `Pase de gimnasio ${formatted} · hab. ${reservation.roomNumber} · ${params.currency} ${amount}`,
        after: {
          folio: formatted,
          roomNumber: reservation.roomNumber,
          reservationCode: reservation.code,
          guestName: reservation.guest!.fullName,
          currency: params.currency,
          amount,
          paymentMethod: params.paymentMethod,
        },
      },
      tx,
    );

    return { id, folio, formattedFolio: formatted };
  });

  return created;
}

export async function voidGymPass(
  user: CurrentUser,
  params: { id: string; reason: string },
): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      folio: number;
      status: string;
      currency: string;
      amount: Prisma.Decimal;
      paymentMethod: GymPaymentMethod;
      roomId: string;
      reservationReferenceId: string;
      shiftId: string | null;
      operationalEntryId: string;
    }>
  >`
    SELECT "id", "folio", "status", "currency", "amount", "paymentMethod",
           "roomId", "reservationReferenceId", "shiftId", "operationalEntryId"
    FROM "GymPass"
    WHERE "id" = ${params.id}
    LIMIT 1
  `;
  const pass = rows[0];
  if (!pass) throw new NotFoundError('Ese folio no existe.');
  if (pass.status === 'ANULADO') throw new RuleError('Ese folio ya está anulado.');
  if (params.reason.trim().length < 5) throw new RuleError('Indica el motivo de anulación.');

  const folio = formatGymFolio(pass.folio);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "GymPass"
      SET "status" = 'ANULADO', "voidedAt" = CURRENT_TIMESTAMP,
          "voidedById" = ${user.id}, "voidReason" = ${params.reason.trim()}
      WHERE "id" = ${pass.id}
    `;

    await tx.operationalEntry.update({
      where: { id: pass.operationalEntryId },
      data: {
        status: EntryStatus.CERRADO,
        resolution: `Folio ${folio} anulado: ${params.reason.trim()}`,
        closedAt: new Date(),
        closedById: user.id,
        tags: { push: 'anulado' },
      },
    });

    if (pass.paymentMethod === 'EFECTIVO') {
      const already = await cashMovementExists(tx, {
        gymPassId: pass.id,
        kind: 'ANULACION_GIMNASIO',
      });
      if (!already) {
        await insertCashMovement(tx, {
          userId: user.id,
          kind: 'ANULACION_GIMNASIO',
          direction: 'SALIDA',
          currency: pass.currency,
          amount: decimal(pass.amount),
          shiftId: pass.shiftId,
          roomId: pass.roomId,
          reservationReferenceId: pass.reservationReferenceId,
          gymPassId: pass.id,
          reference: `Anulación folio ${folio}`,
          notes: params.reason.trim(),
        });
      }
    }

    await recordAudit(
      {
        entity: 'GymPass',
        entityId: pass.id,
        action: AuditAction.CAMBIO_ESTADO,
        user,
        summary: `Folio de gimnasio ${folio} anulado: ${params.reason.trim()}`,
        before: { status: 'EMITIDO' },
        after: { status: 'ANULADO', reason: params.reason.trim() },
      },
      tx,
    );
  });
}

export async function getExpectedCash(): Promise<Map<string, number>> {
  const [funds, totals] = await Promise.all([
    prisma.cashFund.findMany({ where: { active: true }, select: { currency: true, amount: true } }),
    prisma.$queryRaw<Array<{ currency: string; net: Prisma.Decimal }>>`
      SELECT "currency",
             COALESCE(SUM(CASE WHEN "direction" = 'ENTRADA' THEN "amount" ELSE -"amount" END), 0) AS "net"
      FROM "CashMovement"
      WHERE "voidedAt" IS NULL
      GROUP BY "currency"
    `,
  ]);
  const map = new Map<string, number>();
  for (const fund of funds) map.set(fund.currency, decimal(fund.amount));
  for (const row of totals) map.set(row.currency, (map.get(row.currency) ?? 0) + decimal(row.net));
  return map;
}

export async function saveLiveCashAudit(
  user: CurrentUser,
  params: { currency: string; countedAmount: number; notes?: string | null },
): Promise<{ expected: number; difference: number }> {
  if (params.countedAmount < 0 || !Number.isFinite(params.countedAmount)) {
    throw new RuleError('El monto contado no es válido.');
  }
  const currency = params.currency.toUpperCase();
  const expectedMap = await getExpectedCash();
  const expected = expectedMap.get(currency) ?? 0;
  const difference = params.countedAmount - expected;
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "CashAudit" (
      "id", "currency", "expectedAmount", "countedAmount", "difference",
      "countedById", "notes"
    ) VALUES (
      ${id}, ${currency}, ${expected}, ${params.countedAmount}, ${difference},
      ${user.id}, ${params.notes?.trim() || null}
    )
  `;
  await recordAudit({
    entity: 'CashAudit',
    entityId: id,
    action: AuditAction.CREAR,
    user,
    summary: `Auditoría de caja ${currency}: esperado ${expected}, contado ${params.countedAmount}, diferencia ${difference}`,
  });
  return { expected, difference };
}

export async function getLiveCashState(limit = 30): Promise<LiveCashState> {
  const [denominations, funds, totals, movementRows, guarantees, gymRows, auditRows] = await Promise.all([
    prisma.cashDenomination.findMany({
      where: { active: true, currency: { in: ['CLP', 'USD'] } },
      select: { id: true, currency: true, value: true, medium: true },
      orderBy: [{ currency: 'asc' }, { value: 'desc' }],
    }),
    prisma.cashFund.findMany({
      where: { active: true },
      select: { currency: true, amount: true },
      orderBy: { currency: 'asc' },
    }),
    prisma.$queryRaw<Array<{ currency: string; net: Prisma.Decimal }>>`
      SELECT "currency",
             COALESCE(SUM(CASE WHEN "direction" = 'ENTRADA' THEN "amount" ELSE -"amount" END), 0) AS "net"
      FROM "CashMovement"
      WHERE "voidedAt" IS NULL
      GROUP BY "currency"
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        kind: CashMovementKind;
        direction: CashDirection;
        currency: string;
        amount: Prisma.Decimal;
        reference: string | null;
        notes: string | null;
        roomNumber: string | null;
        reservationCode: string | null;
        stayId: string | null;
        guestName: string | null;
        createdByName: string;
        createdAt: Date;
      }>
    >`
      SELECT m."id", m."kind", m."direction", m."currency", m."amount",
             m."reference", m."notes", r."number" AS "roomNumber",
             rr."code" AS "reservationCode", m."stayId",
             g."fullName" AS "guestName", u."name" AS "createdByName",
             m."createdAt"
      FROM "CashMovement" m
      JOIN "User" u ON u."id" = m."createdById"
      LEFT JOIN "Room" r ON r."id" = m."roomId"
      LEFT JOIN "ReservationReference" rr ON rr."id" = m."reservationReferenceId"
      LEFT JOIN "GuestReference" g ON g."id" = m."guestId"
      WHERE m."voidedAt" IS NULL
      ORDER BY m."createdAt" DESC
      LIMIT ${limit}
    `,
    prisma.guarantee.findMany({
      where: {
        deletedAt: null,
        kind: GuaranteeKind.EFECTIVO,
        state: {
          in: [
            GuaranteeState.VIGENTE,
            GuaranteeState.APLICADA_PARCIALMENTE,
            GuaranteeState.MULTA,
          ],
        },
      },
      include: {
        reservationReference: {
          select: {
            code: true,
            roomNumber: true,
            guest: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.$queryRaw<
      Array<{
        id: string;
        folio: number;
        reservationCode: string;
        roomNumber: string;
        guestName: string;
        receptionistName: string;
        currency: string;
        amount: Prisma.Decimal;
        paymentMethod: GymPaymentMethod;
        status: 'EMITIDO' | 'ANULADO';
        issuedAt: Date;
        voidReason: string | null;
      }>
    >`
      SELECT g."id", g."folio", rr."code" AS "reservationCode", r."number" AS "roomNumber",
             g."guestName", u."name" AS "receptionistName", g."currency", g."amount",
             g."paymentMethod", g."status", g."issuedAt", g."voidReason"
      FROM "GymPass" g
      JOIN "ReservationReference" rr ON rr."id" = g."reservationReferenceId"
      JOIN "Room" r ON r."id" = g."roomId"
      JOIN "User" u ON u."id" = g."receptionistId"
      ORDER BY g."issuedAt" DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        currency: string;
        expectedAmount: Prisma.Decimal;
        countedAmount: Prisma.Decimal;
        difference: Prisma.Decimal;
        countedByName: string;
        notes: string | null;
        createdAt: Date;
      }>
    >`
      SELECT a."id", a."currency", a."expectedAmount", a."countedAmount", a."difference",
             u."name" AS "countedByName", a."notes", a."createdAt"
      FROM "CashAudit" a
      JOIN "User" u ON u."id" = a."countedById"
      ORDER BY a."createdAt" DESC
      LIMIT 12
    `,
  ]);

  const fundsMap = new Map(funds.map((row) => [row.currency, decimal(row.amount)]));
  const netMap = new Map(totals.map((row) => [row.currency, decimal(row.net)]));
  const currencies = Array.from(new Set([...fundsMap.keys(), ...netMap.keys()]))
    .sort()
    .map((currency) => ({
      currency,
      fund: fundsMap.get(currency) ?? 0,
      netMovements: netMap.get(currency) ?? 0,
      expected: (fundsMap.get(currency) ?? 0) + (netMap.get(currency) ?? 0),
    }));

  return {
    denominations: denominations.map((row) => ({
      id: row.id,
      currency: row.currency,
      value: decimal(row.value),
      medium: row.medium,
    })),
    currencies,
    movements: movementRows.map((row) => ({ ...row, amount: decimal(row.amount) })),
    cashGuarantees: guarantees.map((row) => ({
      id: row.id,
      reservationCode: row.reservationReference.code,
      roomNumber: row.reservationReference.roomNumber,
      guestName: row.reservationReference.guest?.fullName ?? null,
      currency: row.currency,
      amount: decimal(row.amount),
      state: row.state,
      createdAt: row.createdAt,
    })),
    gymPasses: gymRows.map((row) => ({ ...row, amount: decimal(row.amount) })),
    audits: auditRows.map((row) => ({
      ...row,
      expectedAmount: decimal(row.expectedAmount),
      countedAmount: decimal(row.countedAmount),
      difference: decimal(row.difference),
    })),
  };
}
