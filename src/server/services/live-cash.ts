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
import {
  SUPERVISION_BACKUP_EMAIL,
  operationalMailTimestamp,
  queueOperationalMail,
} from '@/server/services/operational-mail';

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
  humanId: number;
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
  /** False cuando el movimiento sólo regulariza una diferencia física previa. */
  affectsExpected: boolean;
};

export type CashAuditRow = {
  id: string;
  humanId: number;
  currency: string;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
  countedByName: string;
  notes: string | null;
  guaranteeCount: number;
  guaranteeAmount: number;
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
    humanId: number;
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
  movementTotal: number;
  auditTotal: number;
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
    /**
     * True para ingresos/egresos operativos que cambian lo esperado.
     * False para regularizaciones que explican una diferencia física previa.
     */
    affectsExpected?: boolean;
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
      "cashTransferId", "createdById", "reference", "notes", "effectiveAt",
      "affectsExpected"
    ) VALUES (
      ${id}, ${params.kind}, ${params.direction}, ${currency}, ${params.amount},
      ${params.shiftId ?? null}, ${params.roomId ?? null},
      ${params.stayId ?? null}, ${params.guestId ?? null},
      ${params.reservationReferenceId ?? null}, ${params.guaranteeId ?? null},
      ${params.gymPassId ?? null}, ${params.cashTransferId ?? null},
      ${params.userId}, ${params.reference ?? null}, ${params.notes ?? null},
      ${params.effectiveAt ?? new Date()}, ${params.affectsExpected ?? true}
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
        AND "affectsExpected" = TRUE
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
  params: {
    currency: string;
    countedAmount: number;
    guaranteeIds: string[];
    notes?: string | null;
  },
): Promise<{ expected: number; difference: number; guaranteeCount: number }> {
  if (params.countedAmount < 0 || !Number.isFinite(params.countedAmount)) {
    throw new RuleError('El monto contado no es válido.');
  }
  const currency = params.currency.toUpperCase();
  const [fund, guarantees] = await Promise.all([
    prisma.cashFund.findFirst({
      where: { active: true, currency },
      select: { amount: true },
    }),
    prisma.guarantee.findMany({
      where: {
        deletedAt: null,
        kind: GuaranteeKind.EFECTIVO,
        currency,
        state: {
          in: [
            GuaranteeState.VIGENTE,
            GuaranteeState.APLICADA_PARCIALMENTE,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const selected = new Set(params.guaranteeIds);
  const current = new Set(guarantees.map((row) => row.id));
  if ([...selected].some((id) => !current.has(id))) {
    throw new RuleError(
      'El arqueo incluye una garantía que ya no está vigente. Actualiza la pantalla y vuelve a validar.',
    );
  }
  const missing = guarantees.filter((row) => !selected.has(row.id));
  if (missing.length > 0) {
    const labels = missing.slice(0, 3).map(
      (row) => row.guestName ?? row.reference ?? row.roomNumber ?? row.id,
    );
    throw new RuleError(
      `Debes validar físicamente todas las garantías vigentes antes de guardar el arqueo: ${labels.join(', ')}${missing.length > 3 ? '…' : ''}.`,
    );
  }

  // La denominación representa exclusivamente el fondo fijo.
  const expected = decimal(fund?.amount);
  const difference = params.countedAmount - expected;
  const id = randomUUID();
  const guaranteeSnapshot = guarantees.map((row) => ({
    id: row.id,
    currency: row.currency,
    amount: outstandingAmount({
      amount: decimal(row.amount),
      appliedAmount: decimal(row.appliedAmount),
      penaltyAmount: decimal(row.penaltyAmount),
    }),
    state: row.state,
    reference: row.reference ?? null,
    roomNumber: row.roomNumber ?? null,
    guestName: row.guestName ?? null,
  }));
  const guaranteeSnapshotJson = JSON.stringify(guaranteeSnapshot);

  await prisma.$executeRaw`
    INSERT INTO "CashAudit" (
      "id", "currency", "expectedAmount", "countedAmount", "difference",
      "countedById", "notes", "guaranteeSnapshot"
    ) VALUES (
      ${id}, ${currency}, ${expected}, ${params.countedAmount}, ${difference},
      ${user.id}, ${params.notes?.trim() || null}, ${guaranteeSnapshotJson}::jsonb
    )
  `;
  await recordAudit({
    entity: 'CashAudit',
    entityId: id,
    action: AuditAction.CREAR,
    user,
    summary:
      `Arqueo de fondo fijo ${currency}: esperado ${expected}, contado ${params.countedAmount}, diferencia ${difference}` +
      ` · ${guaranteeSnapshot.length} garantía(s) en efectivo validadas por separado`,
    after: {
      fundExpected: expected,
      fundCounted: params.countedAmount,
      difference,
      guarantees: guaranteeSnapshot,
    },
  });
  return { expected, difference, guaranteeCount: guaranteeSnapshot.length };
}

export async function getLiveCashState(
  input:
    | number
    | {
        query?: string;
        currency?: string;
        from?: Date;
        to?: Date;
        movementLimit?: number;
        auditLimit?: number;
      } = {},
): Promise<LiveCashState> {
  // Compatibilidad con Fronti y llamadas internas antiguas que pasaban sólo un límite.
  const options =
    typeof input === 'number'
      ? { movementLimit: input, auditLimit: input }
      : input;
  const query = options.query?.trim().replace(/^#/, '') ?? '';
  const humanId = /^\d+$/.test(query) ? Number(query) : null;
  const currency = options.currency?.trim().toUpperCase() || undefined;
  const movementLimit = Math.min(Math.max(options.movementLimit ?? 50, 1), 200);
  const auditLimit = Math.min(Math.max(options.auditLimit ?? 50, 1), 200);

  const effectiveAt =
    options.from || options.to
      ? {
          ...(options.from ? { gte: options.from } : {}),
          ...(options.to ? { lte: options.to } : {}),
        }
      : undefined;
  const createdAt =
    options.from || options.to
      ? {
          ...(options.from ? { gte: options.from } : {}),
          ...(options.to ? { lte: options.to } : {}),
        }
      : undefined;

  const movementWhere: Prisma.CashMovementWhereInput = {
    voidedAt: null,
    ...(currency ? { currency } : {}),
    ...(effectiveAt ? { effectiveAt } : {}),
    ...(query
      ? {
          OR: [
            ...(humanId !== null ? [{ humanId }] : []),
            { kind: { contains: query, mode: 'insensitive' } },
            { direction: { contains: query, mode: 'insensitive' } },
            { reference: { contains: query, mode: 'insensitive' } },
            { notes: { contains: query, mode: 'insensitive' } },
            { createdBy: { name: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const auditWhere: Prisma.CashAuditWhereInput = {
    ...(currency ? { currency } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(query
      ? {
          OR: [
            ...(humanId !== null ? [{ humanId }] : []),
            { notes: { contains: query, mode: 'insensitive' } },
            { countedBy: { name: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [
    denominations,
    funds,
    totals,
    movementRows,
    movementTotal,
    guarantees,
    auditRows,
    auditTotal,
  ] = await Promise.all([
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
        AND "affectsExpected" = TRUE
      GROUP BY "currency"
    `,
    prisma.cashMovement.findMany({
      where: movementWhere,
      select: {
        id: true,
        humanId: true,
        kind: true,
        direction: true,
        currency: true,
        amount: true,
        reference: true,
        notes: true,
        createdAt: true,
        effectiveAt: true,
        affectsExpected: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: movementLimit,
    }),
    prisma.cashMovement.count({ where: movementWhere }),
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
    prisma.cashAudit.findMany({
      where: auditWhere,
      select: {
        id: true,
        humanId: true,
        currency: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        notes: true,
        guaranteeSnapshot: true,
        createdAt: true,
        countedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: auditLimit,
    }),
    prisma.cashAudit.count({ where: auditWhere }),
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
    .map((itemCurrency) => {
      const fund = fundsMap.get(itemCurrency) ?? 0;
      const netMovements = netMap.get(itemCurrency) ?? 0;
      const guaranteeCustody = custodyMap.get(itemCurrency) ?? 0;
      const operational = netMovements - guaranteeCustody;
      return {
        currency: itemCurrency,
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
    movements: movementRows.map((row) => ({
      id: row.id,
      humanId: row.humanId,
      kind: row.kind as CashMovementKind,
      direction: row.direction as CashDirection,
      currency: row.currency,
      amount: decimal(row.amount),
      reference: row.reference,
      notes: row.notes,
      roomNumber: null,
      reservationCode: null,
      stayId: null,
      guestName: null,
      createdByName: row.createdBy.name,
      createdAt: row.createdAt,
      effectiveAt: row.effectiveAt,
      affectsExpected: row.affectsExpected,
    })),
    movementTotal,
    cashGuarantees: guarantees.map((row) => ({
      id: row.id,
      humanId: row.humanId,
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
    audits: auditRows.map((row) => {
      const guaranteeRows = Array.isArray(row.guaranteeSnapshot)
        ? row.guaranteeSnapshot.filter(
            (item): item is Prisma.JsonObject =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
      const guaranteeAmount = guaranteeRows.reduce(
        (sum, item) => sum + Number(item.amount ?? 0),
        0,
      );
      return {
        id: row.id,
        humanId: row.humanId,
        currency: row.currency,
        expectedAmount: decimal(row.expectedAmount),
        countedAmount: decimal(row.countedAmount),
        difference: decimal(row.difference),
        countedByName: row.countedBy.name,
        notes: row.notes,
        guaranteeCount: guaranteeRows.length,
        guaranteeAmount,
        createdAt: row.createdAt,
      };
    }),
    auditTotal,
  };
}

/**
 * Reclasifica un ingreso/egreso manual ya registrado como regularización de una
 * diferencia física previa. No borra ni altera monto, dirección, fecha o autor:
 * únicamente evita que vuelva a modificar el efectivo esperado.
 */
export async function markCashMovementAsRegularization(
  user: CurrentUser,
  params: { movementId: string; reason: string },
): Promise<void> {
  const movement = await prisma.cashMovement.findUnique({
    where: { id: params.movementId },
    select: {
      id: true,
      humanId: true,
      kind: true,
      direction: true,
      currency: true,
      amount: true,
      reference: true,
      notes: true,
      shiftId: true,
      shift: { select: { humanId: true } },
      effectiveAt: true,
      createdAt: true,
      affectsExpected: true,
      voidedAt: true,
    },
  });
  if (!movement) throw new RuleError('El movimiento de Caja no existe.');
  if (movement.voidedAt) throw new RuleError('Un movimiento anulado no puede regularizarse.');
  if (!['AJUSTE_ENTRADA', 'AJUSTE_SALIDA'].includes(movement.kind)) {
    throw new RuleError('Sólo un ingreso o egreso manual puede reclasificarse como regularización.');
  }
  if (!movement.affectsExpected) {
    throw new RuleError('Ese movimiento ya está marcado como regularización de diferencia.');
  }

  const reason = params.reason.trim();
  if (reason.length < 5) throw new RuleError('Indica el motivo de la regularización.');

  await prisma.$transaction(async (tx) => {
    await tx.cashMovement.update({
      where: { id: movement.id },
      data: { affectsExpected: false },
    });

    await recordAudit(
      {
        entity: 'CashMovement',
        entityId: movement.id,
        action: AuditAction.EDITAR,
        user,
        summary:
          `Movimiento ${movement.direction === 'ENTRADA' ? 'de ingreso' : 'de egreso'} ${movement.currency} ${Number(movement.amount)} reclasificado como regularización de diferencia`,
        before: { affectsExpected: true, reference: movement.reference },
        after: { affectsExpected: false, reason },
        reason,
      },
      tx,
    );

    await queueOperationalMail(tx, {
      eventKey: `cash-movement-regularized:${movement.id}`,
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject:
        `[Libro Operativo] CORRECCIÓN CAJA #${movement.humanId} · ${movement.currency} ${Number(movement.amount)} · ` +
        `${movement.reference ?? 'sin concepto'}`,
      text: [
        'MOVIMIENTO DE CAJA RECLASIFICADO COMO REGULARIZACIÓN',
        `Movimiento: #${movement.humanId}`,
        `Fecha/hora del movimiento: ${operationalMailTimestamp(movement.effectiveAt)}`,
        `Fecha/hora de corrección: ${operationalMailTimestamp(new Date())}`,
        `Corregido por: ${user.name} (@${user.username})`,
        `Dirección original: ${movement.direction}`,
        `Monto: ${movement.currency} ${Number(movement.amount)}`,
        `Concepto: ${movement.reference ?? 'sin referencia'}`,
        `Turno: ${movement.shift ? `#${movement.shift.humanId}` : 'sin turno asociado'}`,
        `Observaciones originales: ${movement.notes ?? 'sin observaciones'}`,
        `Motivo de corrección: ${reason}`,
        'Efecto: el movimiento se conserva, pero deja de modificar el efectivo esperado.',
      ].join('\n'),
    });
  });
}
