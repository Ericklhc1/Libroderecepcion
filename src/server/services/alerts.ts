import 'server-only';
import { randomUUID } from 'node:crypto';
import { AlertStatus, AuditAction, EntryStatus } from '@prisma/client';
import type { AlertLevel, AlertType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { ALERT_STATUS_LABEL, ALERT_TYPE_LABEL } from '@/domain/labels';
import { ROLE_KEYS } from '@/lib/permissions';

export const alertInclude = {
  entry: { select: { id: true, seq: true, title: true, type: true } },
  task: { select: { id: true, seq: true, title: true } },
  followUp: { select: { id: true, action: true } },
  handover: { select: { id: true, fromShift: { select: { type: true, date: true } } } },
  guest: { select: { id: true, fullName: true, roomNumber: true } },
  reservation: { select: { id: true, code: true, roomNumber: true } },
  department: { select: { id: true, name: true } },
  acknowledgedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  _count: { select: { comments: true, tasks: true } },
} satisfies Prisma.AlertInclude;

export type AlertWithRelations = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;

export async function createManualAlert(
  user: CurrentUser,
  input: {
    type: AlertType;
    level: AlertLevel;
    title: string;
    message?: string | null;
    dueAt?: Date | null;
    entryId?: string | null;
    taskId?: string | null;
    reservationId?: string | null;
    guestId?: string | null;
    departmentId?: string | null;
  },
) {
  const created = await prisma.alert.create({
    data: {
      type: input.type,
      level: input.level,
      title: input.title,
      message: input.message ?? null,
      dueAt: input.dueAt ?? null,
      entryId: input.entryId ?? null,
      taskId: input.taskId ?? null,
      reservationId: input.reservationId ?? null,
      guestId: input.guestId ?? null,
      departmentId: input.departmentId ?? null,
      createdById: user.id,
      auto: false,
    },
    include: alertInclude,
  });
  await recordAudit({
    entity: 'Alert',
    entityId: created.id,
    action: AuditAction.CREAR,
    summary: `Alerta manual (${ALERT_TYPE_LABEL[created.type]}): ${created.title}`,
    user,
    after: { type: created.type, level: created.level, title: created.title },
  });
  return created;
}

async function loadAlert(id: string) {
  const alert = await prisma.alert.findFirst({ where: { id, deletedAt: null } });
  if (!alert) throw new NotFoundError('La alerta no existe o fue eliminada.');
  return alert;
}

function tagValue(tags: string[], prefix: string): string | null {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function decodeTag(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Una solicitud manual de Caja no modifica dinero hasta que Supervisión pulsa
 * «Autorizar». La propia alerta es la compuerta y el registro operativo guarda
 * los datos estructurados de la solicitud. La actualización condicional de la
 * entrada actúa como candado para que dos clics concurrentes no dupliquen el
 * movimiento.
 */
async function applyCashManualApproval(user: CurrentUser, entryId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.operationalEntry.findFirst({
      where: { id: entryId, deletedAt: null, category: 'AJUSTE_CAJA_SOLICITADO' },
      select: { id: true, status: true, shiftId: true, tags: true, title: true },
    });
    if (!entry) throw new RuleError('La solicitud de Caja vinculada ya no existe.');
    if (entry.tags.includes('ajuste-aplicado')) return;
    if (!entry.shiftId) throw new RuleError('La solicitud no está vinculada a un turno.');

    const direction = tagValue(entry.tags, 'direccion-');
    const currency = tagValue(entry.tags, 'moneda-');
    const amount = Number(tagValue(entry.tags, 'monto-'));
    const reference = decodeTag(tagValue(entry.tags, 'referencia-')) ?? entry.title;
    const notes = decodeTag(tagValue(entry.tags, 'notas-'));
    if (
      (direction !== 'ENTRADA' && direction !== 'SALIDA') ||
      (currency !== 'CLP' && currency !== 'USD') ||
      !(amount > 0)
    ) {
      throw new RuleError('La solicitud de Caja no contiene datos válidos para autorizarse.');
    }

    const claimed = await tx.operationalEntry.updateMany({
      where: { id: entry.id, status: EntryStatus.PENDIENTE },
      data: {
        status: EntryStatus.RESUELTO,
        resolution: `Movimiento autorizado por Supervisor ${user.name}.`,
        requiresFollowUp: false,
        closedAt: new Date(),
        closedById: user.id,
        tags: { push: 'ajuste-aplicado' },
      },
    });
    if (claimed.count === 0) {
      const refreshed = await tx.operationalEntry.findUnique({
        where: { id: entry.id },
        select: { tags: true },
      });
      if (refreshed?.tags.includes('ajuste-aplicado')) return;
      throw new RuleError('La solicitud de Caja ya no está pendiente de autorización.');
    }

    const movementId = randomUUID();
    const kind = direction === 'ENTRADA' ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
    await tx.$executeRaw`
      INSERT INTO "CashMovement" (
        "id", "kind", "direction", "currency", "amount", "shiftId",
        "createdById", "reference", "notes"
      ) VALUES (
        ${movementId}, ${kind}, ${direction}, ${currency}, ${amount},
        ${entry.shiftId}, ${user.id}, ${reference}, ${notes}
      )
    `;

    await recordAudit(
      {
        entity: 'CashMovement',
        entityId: movementId,
        action: AuditAction.CREAR,
        summary: `Movimiento de Caja autorizado por Supervisor: ${direction} ${amount} ${currency} · ${reference}`,
        user,
        after: {
          direction,
          currency,
          amount,
          reference,
          requestEntryId: entry.id,
          shiftId: entry.shiftId,
        },
      },
      tx,
    );
  });
}

export async function acknowledgeAlert(user: CurrentUser, id: string) {
  const alert = await loadAlert(id);
  if (alert.status === AlertStatus.RESUELTA) {
    throw new RuleError('La alerta ya está resuelta.');
  }
  const updated = await prisma.alert.update({
    where: { id },
    data: {
      status: AlertStatus.VISTA,
      acknowledgedById: user.id,
      acknowledgedAt: new Date(),
      snoozedUntil: null,
    },
    include: alertInclude,
  });
  await recordAudit({
    entity: 'Alert',
    entityId: id,
    action: AuditAction.CAMBIO_ESTADO,
    summary: `Alerta marcada como vista: ${alert.title}`,
    user,
    before: { status: alert.status },
    after: { status: AlertStatus.VISTA },
  });
  return updated;
}

export async function snoozeAlert(
  user: CurrentUser,
  input: { id: string; snoozeMinutes?: number; note?: string | null },
) {
  const alert = await loadAlert(input.id);
  if (alert.status === AlertStatus.RESUELTA) {
    throw new RuleError('La alerta ya está resuelta.');
  }
  const minutes = input.snoozeMinutes ?? 60;
  const until = new Date(Date.now() + minutes * 60_000);
  const updated = await prisma.alert.update({
    where: { id: input.id },
    data: {
      status: AlertStatus.POSPUESTA,
      snoozedUntil: until,
      acknowledgedById: user.id,
      acknowledgedAt: new Date(),
    },
    include: alertInclude,
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.CAMBIO_ESTADO,
    summary: `Alerta pospuesta ${minutes} minutos: ${alert.title}`,
    user,
    before: { status: alert.status },
    after: { status: AlertStatus.POSPUESTA, snoozedUntil: until },
    reason: input.note ?? null,
  });
  return updated;
}

export async function resolveAlert(
  user: CurrentUser,
  input: { id: string; note?: string | null },
) {
  const alert = await loadAlert(input.id);
  if (alert.status === AlertStatus.RESUELTA) return alert;

  const cashTransfer = alert.dedupeKey?.startsWith('cash-transfer:') === true;
  const cashManual = alert.dedupeKey?.startsWith('cash-manual:') === true;
  const noElements = alert.dedupeKey?.startsWith('handover-elements-none:') === true;
  const shiftValidation = alert.dedupeKey?.startsWith('shift-validation:') === true;

  if ((cashTransfer || cashManual) && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError(
      'Los movimientos de Caja sólo pueden ser autorizados por un Supervisor desde su cuenta.',
    );
  }

  if (noElements && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError(
      'Una entrega sin elementos físicos sólo puede ser validada por un Supervisor.',
    );
  }

  if (shiftValidation && user.roleKey !== ROLE_KEYS.SUPERVISOR && !user.isSystemAdmin) {
    throw new RuleError(
      'Los cierres de turno sólo pueden ser validados por Supervisión o por el Administrador de sistema.',
    );
  }

  if (cashManual) {
    if (!alert.entryId) throw new RuleError('La solicitud de Caja no tiene un registro vinculado.');
    await applyCashManualApproval(user, alert.entryId);
  }

  const checkoutDismissed = alert.dedupeKey?.startsWith('checkout-unconfirmed:') === true;
  const updated = await prisma.alert.update({
    where: { id: input.id },
    data: {
      status: AlertStatus.RESUELTA,
      resolvedById: user.id,
      resolvedAt: new Date(),
      resolutionNote: input.note ?? null,
      snoozedUntil: null,
      ...(checkoutDismissed ? { auto: false } : {}),
    },
    include: alertInclude,
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.CERRAR,
    summary: cashTransfer
      ? `Egreso a tesorería validado por Supervisor: ${alert.title}`
      : cashManual
        ? `Movimiento manual de Caja autorizado por Supervisor: ${alert.title}`
        : noElements
          ? `Entrega sin elementos validada por Supervisor: ${alert.title}`
          : shiftValidation
            ? `Cierre de turno validado por ${user.isSystemAdmin ? 'Administrador de sistema' : 'Supervisión'}: ${alert.title}`
            : `Alerta resuelta: ${alert.title}`,
    user,
    before: { status: alert.status },
    after: { status: AlertStatus.RESUELTA, ...(checkoutDismissed ? { auto: false } : {}) },
    reason: input.note ?? null,
  });
  return updated;
}

export async function softDeleteAlert(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const alert = await loadAlert(id);
  const deleted = await prisma.alert.update({
    where: { id: input.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.ELIMINAR,
    summary: `Eliminación lógica de la alerta: ${alert.title}`,
    user,
    after: { deletedAt: deleted.deletedAt },
    reason: input.reason,
  });
  return deleted;
}

export async function restoreAlert(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
) {
  const alert = await prisma.alert.findFirst({
    where: { id: input.id, NOT: { deletedAt: null } },
  });
  if (!alert) throw new NotFoundError('La alerta no está eliminada.');
  const restored = await prisma.alert.update({
    where: { id: input.id },
    data: { deletedAt: null, deletedById: null, deletionReason: null },
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.RESTAURAR,
    summary: `Alerta restaurada: ${alert.title} (${ALERT_STATUS_LABEL[alert.status]})`,
    user,
    before: { deletedAt: alert.deletedAt },
    after: { deletedAt: null },
    reason: input.reason ?? null,
  });
  return restored;
}
