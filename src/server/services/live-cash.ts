import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  GuaranteeKind,
  GuaranteeState,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { outstandingAmount } from '@/domain/guarantees';

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
  effectiveAt: Date;
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
    guaranteeCustody: number;
    operational: number;
    transferable: number;
    netMovements: number;
    expected: number;
  }>;
  movements: LiveCashMovement[];
  cashGuarantees: Array<{
    id: string;
    reservationCode: string | null;
    roomNumber: string | null;
    guestName: string | null;
    reference: string | null;
    dueAt: Date | null;
    currency: string;
    amount: number;
    originalAmount: number;
    appliedAmount: number;
    penaltyAmount: number;
    state: string;
    createdAt: Date;
  }>;
  audits: CashAuditRow[];
};

function decimal(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
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
    effectiveAt?: Date | null;
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
      "cashTransferId", "createdById", "reference", "notes", "effectiveAt"
    ) VALUES (
      ${id}, ${params.kind}, ${params.direction}, ${currency}, ${params.amount},
      ${params.shiftId ?? null}, ${params.roomId ?? null},
      ${params.stayId ?? null}, ${params.guestId ?? null},
      ${params.reservationReferenceId ?? null}, ${params.guaranteeId ?? null},
      ${params.gymPassId ?? null}, ${params.cashTransferId ?? null},
      ${params.userId}, ${params.reference ?? null}, ${params.notes ?? null},
      ${params.effectiveAt ?? new Date()}
    )
  `;
  return id;
}

export async function recordGuaranteeCashIn(
  tx: Tx,
  params: {
    user: CurrentUser;
    guaranteeId: string;
    reservationReferenceId?: string | null;
    reservationCode?: string | null;
    reference?: string | null;
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
    reservationReferenceId: params.reservationReferenceId ?? null,
    guaranteeId: params.guaranteeId,
    reference:
      params.reference?.trim() ||
      (params.reservationCode ? `Garantía reserva ${params.reservationCode}` : 'Garantía en efectivo'),
    notes: 'Garantía en efectivo ingresada a Caja.',
  });
}

export async function recordGuaranteeCashOut(
  tx: Tx,
  params: {
    user: CurrentUser;
    guaranteeId: string;
    reservationReferenceId?: string | null;
    reservationCode?: string | null;
    reference?: string | null;
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
    reservationReferenceId: params.reservationReferenceId ?? null,
    guaranteeId: params.guaranteeId,
    reference:
      params.reference?.trim() ||
      (params.reservationCode ? `Devolución garantía ${params.reservationCode}` : 'Devolución de garantía'),
    notes: 'Garantía en efectivo devuelta.',
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
  const [denominations, funds, totals, movementRows, guarantees, auditRows] = await Promise.all([
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
        effectiveAt: Date;
      }>
    >`
      SELECT m."id", m."kind", m."direction", m."currency", m."amount",
             m."reference", m."notes", NULL::text AS "roomNumber",
             NULL::text AS "reservationCode", NULL::text AS "stayId",
             NULL::text AS "guestName", u."name" AS "createdByName",
             m."createdAt", m."effectiveAt"
      FROM "CashMovement" m
      JOIN "User" u ON u."id" = m."createdById"
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
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
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
  const custodyMap = new Map<string, number>();
  for (const row of guarantees) {
    const custody = outstandingAmount({
      amount: decimal(row.amount),
      appliedAmount: decimal(row.appliedAmount),
      penaltyAmount: decimal(row.penaltyAmount),
    });
    custodyMap.set(row.currency, (custodyMap.get(row.currency) ?? 0) + custody);
  }
  const currencies = Array.from(
    new Set([...fundsMap.keys(), ...netMap.keys(), ...custodyMap.keys()]),
  )
    .sort()
    .map((currency) => {
      const fund = fundsMap.get(currency) ?? 0;
      const netMovements = netMap.get(currency) ?? 0;
      const guaranteeCustody = custodyMap.get(currency) ?? 0;
      const operational = netMovements - guaranteeCustody;
      return {
        currency,
        fund,
        guaranteeCustody,
        operational,
        transferable: Math.max(operational, 0),
        netMovements,
        expected: fund + netMovements,
      };
    });

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
      reservationCode: null,
      roomNumber: row.roomNumber ?? null,
      guestName: row.guestName ?? null,
      reference: row.reference ?? null,
      dueAt: row.dueAt ?? null,
      currency: row.currency,
      amount: outstandingAmount({
        amount: decimal(row.amount),
        appliedAmount: decimal(row.appliedAmount),
        penaltyAmount: decimal(row.penaltyAmount),
      }),
      originalAmount: decimal(row.amount),
      appliedAmount: decimal(row.appliedAmount),
      penaltyAmount: decimal(row.penaltyAmount),
      state: row.state,
      createdAt: row.createdAt,
    })),
    audits: auditRows.map((row) => ({
      ...row,
      expectedAmount: decimal(row.expectedAmount),
      countedAmount: decimal(row.countedAmount),
      difference: decimal(row.difference),
    })),
  };
}
