import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditAction,
  CashCountKind,
  ShiftStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { NotFoundError, RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS } from '@/lib/permissions';
import { fromMinor } from '@/domain/cash';
import { getHandoverCashState } from './cash';

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
      'Antes de cerrar o enviar el turno debes completar el cierre formal de Caja desde la preparación de entrega.',
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
    include: {
      assignments: { select: { userId: true } },
      handoverOut: { select: { id: true } },
    },
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

  if (!shift.handoverOut) {
    throw new RuleError(
      'Primero inicia la preparación de entrega. El cierre formal de Caja pertenece a esa entrega.',
    );
  }

  const state = await getHandoverCashState(shift.handoverOut.id);
  if (state.enabled && !state.declared) {
    throw new RuleError(
      'Falta el arqueo formal por denominación. Cuenta CLP y USD dentro de la preparación de entrega.',
    );
  }

  const declaredCount = state.enabled
    ? await prisma.cashCount.findUnique({
        where: {
          handoverId_kind: {
            handoverId: shift.handoverOut.id,
            kind: CashCountKind.DECLARADO,
          },
        },
        select: { id: true, countedAt: true },
      })
    : null;

  const unbalanced = state.declared?.statuses.filter((status) => !status.balanced) ?? [];
  if (unbalanced.length > 0 && !state.declared?.notes?.trim() && !params.notes?.trim()) {
    throw new RuleError(
      'La Caja tiene una diferencia. Explica el descuadre antes de confirmar el cierre formal; no requiere autorización de Supervisión.',
    );
  }

  const snapshot: CashSnapshot = {
    shiftId: shift.id,
    capturedAt: new Date().toISOString(),
    currencies: (state.declared?.statuses ?? []).map((status) => ({
      currency: status.currency,
      fund: fromMinor(status.fundMinor, status.currency),
      netMovements: fromMinor(status.differenceMinor, status.currency),
      expected: fromMinor(status.fundMinor, status.currency),
      counted: fromMinor(status.countedMinor, status.currency),
      difference: fromMinor(status.differenceMinor, status.currency),
      auditId: declaredCount?.id ?? `handover:${shift.handoverOut!.id}`,
      auditedAt: (declaredCount?.countedAt ?? new Date()).toISOString(),
    })),
    openCashGuarantees: state.cashGuarantees.length,
  };

  const id = randomUUID();
  const snapshotJson = JSON.stringify(snapshot);
  const notes = params.notes?.trim() || state.declared?.notes?.trim() || null;
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

    if (unbalanced.length > 0) {
      const detail = unbalanced
        .map((status) => {
          const diff = fromMinor(status.differenceMinor, status.currency);
          return `${status.currency} ${diff > 0 ? '+' : ''}${diff}`;
        })
        .join(' · ');

      await tx.alert.upsert({
        where: { dedupeKey: `cash-formal-close:${shift.id}` },
        create: {
          type: AlertType.OTRO,
          level: AlertLevel.ALTA,
          status: AlertStatus.NUEVA,
          title: 'Revisar diferencia en cierre formal de Caja',
          message: `${detail}. El turno puede continuar; la diferencia quedó declarada y auditada.`,
          handoverId: shift.handoverOut.id,
          dedupeKey: `cash-formal-close:${shift.id}`,
          auto: true,
          createdById: user.id,
        },
        update: {
          status: AlertStatus.NUEVA,
          message: `${detail}. El turno puede continuar; la diferencia quedó declarada y auditada.`,
          deletedAt: null,
        },
      });
    }

    await recordAudit(
      {
        entity: 'ShiftCashClosure',
        entityId: shift.id,
        action: AuditAction.CERRAR,
        user,
        summary:
          `Cierre formal de Caja confirmado: ${snapshot.currencies
            .map((currency) => `${currency.currency} ${currency.counted}`)
            .join(' · ') || 'sin divisas activas'}` +
          (unbalanced.length > 0 ? ' · con diferencia informada a Supervisión.' : ' · sin diferencias.'),
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
