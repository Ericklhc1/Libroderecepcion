import 'server-only';
import { AuditAction, CashCountKind, GuaranteeState, Prisma } from '@prisma/client';
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

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

/**
 * Caja del turno.
 *
 * Las reglas viven en `domain/cash.ts`; acá sólo se leen y escriben filas. La
 * diferencia entre el arqueo declarado y el confirmado **no se guarda nunca**:
 * se calcula al leer, igual que los conflictos de importación.
 *
 * La exigencia de arqueo se activa sola: si el hotel no configuró ningún
 * `CashFund`, `isCashEnabled` devuelve false y la entrega funciona exactamente
 * como antes de que este módulo existiera. Eso es lo que permite que las
 * pruebas del ciclo de turno sigan pasando sin tocarlas y que un despliegue
 * nuevo no quede bloqueado el primer día.
 */

export async function isCashEnabled(client: Client = prisma): Promise<boolean> {
  const count = await client.cashFund.count({ where: { active: true } });
  return count > 0;
}

export async function listDenominations(client: Client = prisma) {
  return client.cashDenomination.findMany({
    where: { active: true },
    orderBy: [{ currency: 'asc' }, { value: 'desc' }],
  });
}

export async function listFunds(client: Client = prisma) {
  return client.cashFund.findMany({
    where: { active: true },
    orderBy: { currency: 'asc' },
  });
}

/** Convierte las filas de fondo a la forma que entiende el dominio. */
function fundTargets(funds: Array<{ currency: string; amount: Prisma.Decimal }>) {
  return funds.map((fund) => ({
    currency: fund.currency,
    minorAmount: toMinor(Number(fund.amount), fund.currency),
  }));
}

/** Convierte las líneas de un arqueo a la forma que entiende el dominio. */
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
  /** Calculada, nunca almacenada. Vacía cuando los dos conteos coinciden. */
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
  /** Garantías abiertas: se ENLAZAN desde FASE B, no se duplican acá. */
  openGuarantees: number;
};

export async function getHandoverCashState(
  handoverId: string,
  client: Client = prisma,
): Promise<HandoverCashState> {
  const [funds, counts, transfers, elements, guarantees] = await Promise.all([
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
    // Sólo el número: traer las filas para contarlas sería trabajo de más.
    client.guarantee.count({
      where: {
        deletedAt: null,
        state: { in: OPEN_GUARANTEE_STATES.map((state) => GuaranteeState[state]) },
      },
    }),
  ]);

  const targets = fundTargets(funds);
  const byKind = (kind: CashCountKind) => counts.find((count) => count.kind === kind);

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
    openGuarantees: guarantees,
  };
}

/**
 * Guarda un arqueo. Único camino de escritura de `CashCount`.
 *
 * Es idempotente por entrega y tipo: volver a contar reemplaza el conteo
 * anterior en lugar de acumular dos, porque contar mal y recontar es normal.
 * El reemplazo va en transacción, de modo que nunca queda un arqueo a medias.
 */
export async function saveCashCount(
  user: CurrentUser,
  params: {
    handoverId: string;
    kind: CashCountKindValue;
    /** denominationId → cantidad. Las ausentes valen cero. */
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
    where: { id: { in: entries.map(([id]) => id) } },
  });
  if (denominations.length !== entries.length) {
    throw new RuleError('El arqueo incluye una denominación que no existe.');
  }

  const funds = await listFunds();
  const lines = entries.map(([denominationId, quantity]) => {
    const denomination = denominations.find((row) => row.id === denominationId)!;
    return { denominationId, quantity, denomination };
  });
  const statuses = fundStatuses(fundTargets(funds), countedLines(lines));

  await prisma.$transaction(async (tx) => {
    // Reemplazo, no acumulación: un recuento corrige el anterior.
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

/** Egreso a tesorería del excedente sobre el fondo fijo. */
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
  if (!(params.amount > 0)) {
    throw new RuleError('El monto del egreso debe ser mayor que cero.');
  }
  const handover = await prisma.shiftHandover.findUnique({
    where: { id: params.handoverId },
    select: { id: true },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');

  const currency = params.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RuleError('El código de divisa debe tener tres letras.');
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
    await recordAudit(
      {
        entity: 'CashTransfer',
        entityId: transfer.id,
        action: AuditAction.CREAR,
        summary: `Egreso a tesorería de ${params.amount} ${currency}${
          transfer.reference ? ` (comprobante ${transfer.reference})` : ''
        }`,
        user,
      },
      tx,
    );
    return transfer;
  });
}

/**
 * Materializa los elementos configurados en una entrega concreta.
 *
 * Idempotente: `skipDuplicates` deja intactas las marcas que alguien ya puso,
 * así que regenerar el borrador de la entrega no borra lo confirmado.
 */
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

/** Marca elementos como declarados (quien entrega) o confirmados (quien recibe). */
export async function markHandoverElements(
  user: CurrentUser,
  params: {
    handoverId: string;
    field: 'declared' | 'confirmed';
    /** elementId → marcado. */
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

/**
 * Qué impide ENVIAR la entrega. Lista vacía = se puede enviar.
 *
 * Si el hotel no configuró fondo, no impide nada: la caja es opcional hasta
 * que alguien decide que existe.
 */
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

  problems.push(
    ...cashHandoverProblems({
      statuses: state.declared.statuses,
      hasNotes: Boolean(state.declared.notes),
    }),
  );

  const missing = state.elements.filter((element) => element.required && !element.declared);
  if (missing.length > 0) {
    problems.push(
      `Falta declarar: ${missing.map((element) => element.name).join(', ')}.`,
    );
  }
  return problems;
}

/** Qué impide CONFIRMAR la recepción. Lista vacía = se puede recibir. */
export async function cashBlockersForReceiving(handoverId: string): Promise<string[]> {
  if (!(await isCashEnabled())) return [];

  const state = await getHandoverCashState(handoverId);
  const problems: string[] = [];

  if (!state.confirmed) {
    problems.push(
      'Cuenta la caja y confirma el fondo fijo antes de recibir el turno. Si no coincide con lo declarado, la diferencia queda registrada.',
    );
  }

  const missing = state.elements.filter((element) => element.required && !element.confirmed);
  if (missing.length > 0) {
    problems.push(
      `Confirma que recibes: ${missing.map((element) => element.name).join(', ')}.`,
    );
  }
  return problems;
}
