import 'server-only';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditAction,
  CashCountKind,
  GuaranteeKind,
  GuaranteeState,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  assertValidQuantities,
  cashHandoverProblems,
  countDiscrepancies,
  fundStatuses,
  fromMinor,
  toMinor,
  type CountedDenomination,
  type CashCountKindValue,
  type FundStatus,
} from '@/domain/cash';
import { OPEN_GUARANTEE_STATES } from '@/domain/guarantees';
import { getSettingBool } from '@/server/services/settings';

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

const CASH_CURRENCIES = ['CLP', 'USD'] as const;

/** Caja del turno: CLP y USD son las únicas divisas operativas. */
export async function isCashEnabled(client: Client = prisma): Promise<boolean> {
  const count = await client.cashFund.count({
    where: { active: true, currency: { in: [...CASH_CURRENCIES] } },
  });
  return count > 0;
}

export async function listDenominations(client: Client = prisma) {
  return client.cashDenomination.findMany({
    where: { active: true, currency: { in: [...CASH_CURRENCIES] } },
    orderBy: [{ currency: 'asc' }, { value: 'desc' }],
  });
}

export async function listFunds(client: Client = prisma) {
  return client.cashFund.findMany({
    where: { active: true, currency: { in: [...CASH_CURRENCIES] } },
    orderBy: { currency: 'asc' },
  });
}

function fundTargets(funds: Array<{ currency: string; amount: Prisma.Decimal }>) {
  return funds.map((fund) => ({
    currency: fund.currency,
    minorAmount: toMinor(Number(fund.amount), fund.currency),
  }));
}

function countedLines(
  lines: Array<{ quantity: number; denomination: { currency: string; value: Prisma.Decimal } }>,
): CountedDenomination[] {
  return lines.map((line) => ({
    currency: line.denomination.currency,
    minorValue: toMinor(Number(line.denomination.value), line.denomination.currency),
    quantity: line.quantity,
  }));
}

const countInclude = {
  countedBy: { select: { id: true, name: true, username: true } },
  lines: { include: { denomination: true } },
} satisfies Prisma.CashCountInclude;

export type HandoverCashState = {
  enabled: boolean;
  funds: Array<{ currency: string; amount: number }>;
  declared: {
    countedByName: string;
    countedAt: Date;
    notes: string | null;
    statuses: FundStatus[];
  } | null;
  confirmed: {
    countedByName: string;
    countedAt: Date;
    notes: string | null;
    statuses: FundStatus[];
  } | null;
  discrepancies: Array<{
    currency: string;
    declaredMinor: number;
    confirmedMinor: number;
    differenceMinor: number;
  }>;
  transfers: Array<{
    id: string;
    currency: string;
    amount: number;
    reference: string | null;
    createdByName: string;
    approved: boolean;
  }>;
  elements: Array<{
    id: string;
    name: string;
    detail: string | null;
    required: boolean;
    declared: boolean;
    confirmed: boolean;
    notes: string | null;
  }>;
  cashGuarantees: Array<{
    id: string;
    currency: string;
    amount: number;
    state: string;
    reservationCode: string;
    roomNumber: string | null;
    guestName: string | null;
  }>;
};

export async function getHandoverCashState(
  handoverId: string,
  client: Client = prisma,
): Promise<HandoverCashState> {
  const [funds, counts, transfers, elements, guarantees, approvalAlerts] = await Promise.all([
    listFunds(client),
    client.cashCount.findMany({ where: { handoverId }, include: countInclude }),
    client.cashTransfer.findMany({
      where: { handoverId },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    client.handoverElement.findMany({
      where: { handoverId },
      include: { elementType: true },
      orderBy: { elementType: { order: 'asc' } },
    }),
    client.guarantee.findMany({
      where: {
        deletedAt: null,
        kind: GuaranteeKind.EFECTIVO,
        state: { in: OPEN_GUARANTEE_STATES.map((state) => GuaranteeState[state]) },
      },
      include: {
        reservationReference: {
          include: { guest: { select: { fullName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.alert.findMany({
      where: {
        handoverId,
        deletedAt: null,
        dedupeKey: { startsWith: 'cash-transfer:' },
      },
      select: { dedupeKey: true, status: true },
    }),
  ]);

  const targets = fundTargets(funds);
  const byKind = (kind: CashCountKind) => counts.find((count) => count.kind === kind);
  const approvalByTransfer = new Map(
    approvalAlerts.map((alert) => [
      alert.dedupeKey?.replace('cash-transfer:', ''),
      alert.status === AlertStatus.RESUELTA,
    ]),
  );

  const shape = (count: (typeof counts)[number] | undefined) =>
    count
      ? {
          countedByName: count.countedBy.name,
          countedAt: count.countedAt,
          notes: count.notes,
          statuses: fundStatuses(targets, countedLines(count.lines)),
        }
      : null;

  const declaredCount = byKind(CashCountKind.DECLARADO);
  const confirmedCount = byKind(CashCountKind.CONFIRMADO);

  return {
    enabled: funds.length > 0,
    funds: funds.map((fund) => ({ currency: fund.currency, amount: Number(fund.amount) })),
    declared: shape(declaredCount),
    confirmed: shape(confirmedCount),
    discrepancies:
      declaredCount && confirmedCount
        ? countDiscrepancies(
            countedLines(declaredCount.lines),
            countedLines(confirmedCount.lines),
          )
        : [],
    transfers: transfers.map((transfer) => ({
      id: transfer.id,
      currency: transfer.currency,
      amount: Number(transfer.amount),
      reference: transfer.reference,
      createdByName: transfer.createdBy.name,
      approved: approvalByTransfer.get(transfer.id) === true,
    })),
    elements: elements.map((element) => ({
      id: element.id,
      name: element.elementType.name,
      detail: element.elementType.detail,
      required: element.elementType.required,
      declared: element.declared,
      confirmed: element.confirmed,
      notes: element.notes,
    })),
    cashGuarantees: guarantees.map((guarantee) => ({
      id: guarantee.id,
      currency: guarantee.currency,
      amount: Number(guarantee.amount),
      state: guarantee.state,
      reservationCode: guarantee.reservationReference.code,
      roomNumber: guarantee.reservationReference.roomNumber,
      guestName: guarantee.reservationReference.guest?.fullName ?? null,
    })),
  };
}

export async function saveCashCount(
  user: CurrentUser,
  params: {
    handoverId: string;
    kind: CashCountKindValue;
    quantities: Record<string, number>;
    notes?: string | null;
  },
): Promise<{ statuses: FundStatus[] }> {
  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    select: { id: true, status: true },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');

  const entries = Object.entries(params.quantities).filter(([, quantity]) => quantity > 0);
  assertValidQuantities(entries.map(([, quantity]) => ({ quantity })));

  const denominations = await prisma.cashDenomination.findMany({
    where: {
      id: { in: entries.map(([id]) => id) },
      currency: { in: [...CASH_CURRENCIES] },
    },
  });
  if (denominations.length !== entries.length) {
    throw new RuleError('El arqueo incluye una denominación que no existe o una divisa no habilitada.');
  }

  const funds = await listFunds();
  const lines = entries.map(([denominationId, quantity]) => {
    const denomination = denominations.find((row) => row.id === denominationId)!;
    return { denominationId, quantity, denomination };
  });
  const statuses = fundStatuses(fundTargets(funds), countedLines(lines));

  await prisma.$transaction(async (tx) => {
    await tx.cashCount.deleteMany({
      where: { handoverId: params.handoverId, kind: params.kind as CashCountKind },
    });
    await tx.cashCount.create({
      data: {
        handoverId: params.handoverId,
        kind: params.kind as CashCountKind,
        countedById: user.id,
        notes: params.notes?.trim() || null,
        lines: {
          createMany: {
            data: lines.map((line) => ({
              denominationId: line.denominationId,
              quantity: line.quantity,
            })),
          },
        },
      },
    });

    await recordAudit(
      {
        entity: 'CashCount',
        entityId: params.handoverId,
        action: AuditAction.CREAR,
        summary: `Arqueo de caja ${params.kind === 'DECLARADO' ? 'declarado' : 'confirmado'}: ${statuses
          .map((status) => `${fromMinor(status.countedMinor, status.currency)} ${status.currency}`)
          .join(', ')}`,
        user,
      },
      tx,
    );
  });

  return { statuses };
}

/**
 * Confirma el arqueo recibido dentro de la misma transacción que reclama la Caja.
 *
 * A diferencia de saveCashCount, usa create sin borrar el conteo anterior: el
 * @@unique([handoverId, kind]) se convierte así en una segunda barrera contra
 * una doble recepción concurrente.
 */
export async function confirmHandoverCash(
  tx: Tx,
  user: CurrentUser,
  params: {
    handoverId: string;
    quantities: Record<string, number>;
    notes?: string | null;
  },
): Promise<{
  statuses: FundStatus[];
  discrepancies: ReturnType<typeof countDiscrepancies>;
}> {
  const entries = Object.entries(params.quantities).filter(([, quantity]) => quantity > 0);
  assertValidQuantities(entries.map(([, quantity]) => ({ quantity })));

  const denominations = await tx.cashDenomination.findMany({
    where: {
      id: { in: entries.map(([id]) => id) },
      currency: { in: [...CASH_CURRENCIES] },
    },
  });
  if (denominations.length !== entries.length) {
    throw new RuleError(
      'El arqueo incluye una denominación que no existe o una divisa no habilitada.',
    );
  }

  const declared = await tx.cashCount.findFirst({
    where: { handoverId: params.handoverId, kind: CashCountKind.DECLARADO },
    include: { lines: { include: { denomination: true } } },
  });
  if (!declared) {
    throw new RuleError(
      'El turno saliente todavía no hizo su arqueo de caja. No hay una Caja declarada para recibir.',
    );
  }

  const lines = entries.map(([denominationId, quantity]) => {
    const denomination = denominations.find((row) => row.id === denominationId)!;
    return { denominationId, quantity, denomination };
  });
  const funds = await listFunds(tx);
  const statuses = fundStatuses(fundTargets(funds), countedLines(lines));

  await tx.cashCount.create({
    data: {
      handoverId: params.handoverId,
      kind: CashCountKind.CONFIRMADO,
      countedById: user.id,
      notes: params.notes?.trim() || null,
      lines: {
        createMany: {
          data: lines.map((line) => ({
            denominationId: line.denominationId,
            quantity: line.quantity,
          })),
        },
      },
    },
  });

  const discrepancies = countDiscrepancies(
    countedLines(declared.lines),
    countedLines(lines),
  );

  await recordAudit(
    {
      entity: 'CashCount',
      entityId: params.handoverId,
      action: AuditAction.CREAR,
      summary:
        `Caja recibida por ${user.name}: ` +
        statuses
          .map((status) => `${fromMinor(status.countedMinor, status.currency)} ${status.currency}`)
          .join(', ') +
        (discrepancies.length
          ? ` · diferencia ${discrepancies
              .map(
                (row) =>
                  `${row.differenceMinor > 0 ? '+' : ''}${fromMinor(
                    row.differenceMinor,
                    row.currency,
                  )} ${row.currency}`,
              )
              .join(', ')}`
          : ' · sin diferencias'),
      user,
    },
    tx,
  );

  return { statuses, discrepancies };
}

export function isCashAlreadyReceived(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('handoverId')
  );
}

/** Egreso a tesorería. Queda registrado y auditado; Supervisión revisa después. */
export async function recordCashTransfer(
  user: CurrentUser,
  params: {
    handoverId: string;
    currency: string;
    amount: number;
    reference?: string | null;
    notes?: string | null;
  },
) {
  if (!(await getSettingBool('cash.treasuryTransfersEnabled', true))) {
    throw new RuleError('Los egresos a tesorería están desactivados en la configuración de Caja.');
  }
  if (!(params.amount > 0)) {
    throw new RuleError('El monto del egreso debe ser mayor que cero.');
  }
  if (
    (await getSettingBool('cash.transferReceiptRequired', false)) &&
    !params.reference?.trim()
  ) {
    throw new RuleError('La configuración de Caja exige indicar el comprobante del egreso.');
  }

  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    select: { id: true },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');

  const currency = params.currency.trim().toUpperCase();
  if (!CASH_CURRENCIES.includes(currency as (typeof CASH_CURRENCIES)[number])) {
    throw new RuleError('Caja sólo admite CLP o USD.');
  }

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.cashTransfer.create({
      data: {
        handoverId: params.handoverId,
        currency,
        amount: new Prisma.Decimal(params.amount),
        reference: params.reference?.trim() || null,
        notes: params.notes?.trim() || null,
        createdById: user.id,
      },
    });

    await tx.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Revisar egreso a tesorería',
        message: `Revisar egreso de ${params.amount} ${currency}${transfer.reference ? ` · comprobante ${transfer.reference}` : ''}.`,
        handoverId: params.handoverId,
        dedupeKey: `cash-transfer:${transfer.id}`,
        auto: false,
        createdById: user.id,
      },
    });

    await recordAudit(
      {
        entity: 'CashTransfer',
        entityId: transfer.id,
        action: AuditAction.CREAR,
        summary: `Egreso a tesorería de ${params.amount} ${currency}${
          transfer.reference ? ` (comprobante ${transfer.reference})` : ''
        }; pendiente de revisión de Supervisión.`,
        user,
      },
      tx,
    );
    return transfer;
  });
}

export async function ensureHandoverElements(
  handoverId: string,
  client: Client = prisma,
): Promise<number> {
  const types = await client.handoverElementType.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (types.length === 0) return 0;

  const result = await client.handoverElement.createMany({
    data: types.map((type) => ({ handoverId, elementTypeId: type.id })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function markHandoverElements(
  user: CurrentUser,
  params: {
    handoverId: string;
    field: 'declared' | 'confirmed';
    marks: Record<string, boolean>;
    notes?: Record<string, string | null>;
  },
) {
  const elements = await prisma.handoverElement.findMany({
    where: { handoverId: params.handoverId },
    select: { id: true },
  });
  const known = new Set(elements.map((element) => element.id));

  const updates = Object.entries(params.marks).filter(([id]) => known.has(id));
  if (updates.length === 0) return { updated: 0 };

  await prisma.$transaction(
    updates.map(([id, value]) =>
      prisma.handoverElement.update({
        where: { id },
        data: {
          [params.field]: value,
          ...(params.notes && id in params.notes
            ? { notes: params.notes[id]?.trim() || null }
            : {}),
        },
      }),
    ),
  );

  await recordAudit({
    entity: 'HandoverElement',
    entityId: params.handoverId,
    action: AuditAction.EDITAR,
    summary: `Elementos de la entrega ${
      params.field === 'declared' ? 'declarados' : 'confirmados'
    }: ${updates.filter(([, value]) => value).length} de ${elements.length}`,
    user,
  });

  return { updated: updates.length };
}

export async function cashBlockersForSending(handoverId: string): Promise<string[]> {
  if (!(await isCashEnabled())) return [];

  const state = await getHandoverCashState(handoverId);
  const problems: string[] = [];

  if (!state.declared) {
    problems.push(
      'Falta el arqueo de caja. Cuenta el efectivo por denominación antes de entregar el turno.',
    );
    return problems;
  }

  const requireDifferenceNote = await getSettingBool('cash.requireDifferenceNote', true);
  problems.push(
    ...cashHandoverProblems({
      statuses: state.declared.statuses,
      hasNotes: !requireDifferenceNote || Boolean(state.declared.notes),
    }),
  );

  /*
    El catálogo distingue elementos obligatorios de elementos opcionales.
    - Si falta un elemento obligatorio y todavía no se registró una ausencia
      justificada, se conserva el bloqueo histórico: obliga al usuario a pasar
      por el formulario y declarar qué ocurrió.
    - Cuando el usuario declara explícitamente «ningún elemento» con una
      justificación, esa nota queda en los elementos, Supervisión recibe una
      alerta y el cierre deja de bloquearse aunque la validación siga pendiente.
    - Si el catálogo sólo contiene elementos opcionales, omitirlos no bloquea.
  */
  if (state.elements.length > 0 && !state.elements.some((element) => element.declared)) {
    const hasJustification = state.elements.some((element) => Boolean(element.notes?.trim()));
    const requiredMissing = state.elements.filter((element) => element.required);
    if (!hasJustification && requiredMissing.length > 0) {
      problems.push(`Falta declarar: ${requiredMissing.map((element) => element.name).join(', ')}.`);
    }
  }

  // Los egresos pendientes siguen visibles y auditados, pero Supervisión los
  // revisa después: nunca paralizan la entrega ni el cierre.
  return problems;
}

export async function cashBlockersForReceiving(handoverId: string): Promise<string[]> {
  if (!(await isCashEnabled())) return [];

  const state = await getHandoverCashState(handoverId);
  const problems: string[] = [];

  if (!state.confirmed) {
    problems.push(
      'Cuenta la caja y confirma el fondo fijo antes de recibir el turno. Si no coincide con lo declarado, la diferencia queda registrada.',
    );
  }

  // Sólo Caja bloquea la continuidad. Los elementos físicos quedan visibles
  // como pendientes, pero se revisan después y no detienen al turno entrante.
  return problems;
}

export async function pendingHandoverElements(handoverId: string): Promise<string[]> {
  const state = await getHandoverCashState(handoverId);
  return state.elements
    .filter((element) => element.declared && !element.confirmed)
    .map((element) => element.name);
}
