import 'server-only';

import { randomUUID } from 'node:crypto';
import { AuditAction, ShiftStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS } from '@/lib/permissions';
import { getLiveCashState } from './live-cash';

type CashSnapshot = {
  shiftId: string;
  capturedAt: string;
  currencies: Array<{
    currency: string;
    fund: number;
    netMovements: number;
    expected: number;
    counted: number;
    difference: number;
    auditId: string;
    auditedAt: string;
  }>;
  openCashGuarantees: number;
};

export type ShiftCashClosure = {
  id: string;
  shiftId: string;
  closedById: string;
  closedByName: string;
  closedAt: Date;
  notes: string | null;
  reopenedAt: Date | null;
  snapshot: CashSnapshot;
};

type ClosureRow = {
  id: string;
  shiftId: string;
  closedById: string;
  closedByName: string;
  closedAt: Date;
  notes: string | null;
  reopenedAt: Date | null;
  snapshot: CashSnapshot;
};

type AuditRow = {
  id: string;
  currency: string;
  countedAmount: Prisma.Decimal;
  difference: Prisma.Decimal;
  createdAt: Date;
};

const CLOSEABLE_SHIFT_STATUSES = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
  ShiftStatus.ENTREGA_ENVIADA,
  ShiftStatus.RECIBIDO,
] as const;

export async function getShiftCashClosure(shiftId: string): Promise<ShiftCashClosure | null> {
  const rows = await prisma.$queryRaw<ClosureRow[]>`
    SELECT c."id", c."shiftId", c."closedById", u."name" AS "closedByName",
           c."closedAt", c."notes", c."reopenedAt", c."snapshot"
    FROM "ShiftCashClosure" c
    JOIN "User" u ON u."id" = c."closedById"
    WHERE c."shiftId" = ${shiftId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function assertShiftCashClosed(shiftId: string): Promise<ShiftCashClosure> {
  const closure = await getShiftCashClosure(shiftId);
  if (!closure || closure.reopenedAt) {
    throw new RuleError(
      'Antes de cerrar o enviar el turno debes cerrar Caja. Audita cada divisa, resuelve cualquier diferencia y confirma el cierre de Caja.',
    );
  }
  return closure;
}

export async function closeShiftCash(
  user: CurrentUser,
  params: { shiftId: string; notes?: string | null },
): Promise<ShiftCashClosure> {
  const shift = await prisma.shift.findUnique({
    where: { id: params.shiftId },
    include: { assignments: { select: { userId: true } } },
  });
  if (!shift) throw new NotFoundError('El turno no existe.');
  if (!CLOSEABLE_SHIFT_STATUSES.includes(shift.status as (typeof CLOSEABLE_SHIFT_STATUSES)[number])) {
    throw new RuleError(`El turno está en estado ${shift.status} y su Caja no puede cerrarse ahora.`);
  }

  const assigned = shift.assignments.some((assignment) => assignment.userId === user.id);
  const supervisor = user.roleKey === ROLE_KEYS.SUPERVISOR;
  if (!assigned && !supervisor && !user.isSystemAdmin) {
    throw new RuleError('Sólo el personal del turno, Supervisión o el Administrador de sistema puede cerrar su Caja.');
  }

  const state = await getLiveCashState(100);
  const since = shift.actualStart ?? shift.createdAt;
  const latestAudits = await prisma.$queryRaw<AuditRow[]>`
    SELECT DISTINCT ON ("currency")
      "id", "currency", "countedAmount", "difference", "createdAt"
    FROM "CashAudit"
    WHERE "createdAt" >= ${since}
    ORDER BY "currency", "createdAt" DESC
  `;
  const auditByCurrency = new Map(latestAudits.map((audit) => [audit.currency, audit]));

  const missing = state.currencies
    .filter((currency) => !auditByCurrency.has(currency.currency))
    .map((currency) => currency.currency);
  if (missing.length > 0) {
    throw new RuleError(
      `Falta auditar la Caja de ${missing.join(', ')} durante este turno. Haz el conteo físico antes de cerrarla.`,
    );
  }

  const differences = state.currencies.flatMap((currency) => {
    const audit = auditByCurrency.get(currency.currency);
    if (!audit) return [];
    const difference = Number(audit.difference);
    return difference === 0 ? [] : [`${currency.currency} ${difference > 0 ? '+' : ''}${difference}`];
  });
  if (differences.length > 0) {
    throw new RuleError(
      `Caja todavía tiene diferencias (${differences.join(' · ')}). Supervisión debe reconciliarlas o volver a auditar antes del cierre.`,
    );
  }

  const snapshot: CashSnapshot = {
    shiftId: shift.id,
    capturedAt: new Date().toISOString(),
    currencies: state.currencies.map((currency) => {
      const audit = auditByCurrency.get(currency.currency)!;
      return {
        ...currency,
        counted: Number(audit.countedAmount),
        difference: Number(audit.difference),
        auditId: audit.id,
        auditedAt: audit.createdAt.toISOString(),
      };
    }),
    openCashGuarantees: state.cashGuarantees.length,
  };
  const id = randomUUID();
  const snapshotJson = JSON.stringify(snapshot);
  const notes = params.notes?.trim() || null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "ShiftCashClosure" (
        "id", "shiftId", "closedById", "closedAt", "snapshot", "notes",
        "reopenedAt", "reopenedById", "reopenReason"
      ) VALUES (
        ${id}, ${shift.id}, ${user.id}, ${now}, ${snapshotJson}::jsonb, ${notes},
        NULL, NULL, NULL
      )
      ON CONFLICT ("shiftId") DO UPDATE SET
        "closedById" = EXCLUDED."closedById",
        "closedAt" = EXCLUDED."closedAt",
        "snapshot" = EXCLUDED."snapshot",
        "notes" = EXCLUDED."notes",
        "reopenedAt" = NULL,
        "reopenedById" = NULL,
        "reopenReason" = NULL
    `;

    await recordAudit(
      {
        entity: 'ShiftCashClosure',
        entityId: shift.id,
        action: AuditAction.CERRAR,
        user,
        summary: `Caja del turno cerrada y cuadrada: ${snapshot.currencies.map((currency) => `${currency.currency} ${currency.counted}`).join(' · ') || 'sin divisas activas'}.`,
        after: snapshot,
        reason: notes,
      },
      tx,
    );
  });

  const closure = await getShiftCashClosure(shift.id);
  if (!closure) throw new RuleError('Caja se cerró, pero no fue posible recuperar su comprobante.');
  return closure;
}

export async function reopenShiftCash(
  user: CurrentUser,
  params: { shiftId: string; reason: string },
): Promise<void> {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR && !user.isSystemAdmin) {
    throw new RuleError('Sólo Supervisión o el Administrador de sistema puede reabrir una Caja cerrada.');
  }
  const reason = params.reason.trim();
  if (reason.length < 5) throw new RuleError('Indica por qué se reabre la Caja.');
  const closure = await getShiftCashClosure(params.shiftId);
  if (!closure) throw new NotFoundError('Ese turno no tiene un cierre de Caja.');
  if (closure.reopenedAt) return;

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "ShiftCashClosure"
      SET "reopenedAt" = ${now}, "reopenedById" = ${user.id}, "reopenReason" = ${reason}
      WHERE "shiftId" = ${params.shiftId}
    `;
    await recordAudit(
      {
        entity: 'ShiftCashClosure',
        entityId: params.shiftId,
        action: AuditAction.REABRIR,
        user,
        summary: 'Caja del turno reabierta para corrección.',
        reason,
      },
      tx,
    );
  });
}
