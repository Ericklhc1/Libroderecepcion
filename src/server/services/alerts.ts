import 'server-only';
import { AlertStatus, AuditAction } from '@prisma/client';
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

  if (
    alert.dedupeKey?.startsWith('cash-transfer:') &&
    user.roleKey !== ROLE_KEYS.SUPERVISOR
  ) {
    throw new RuleError(
      'Los egresos a tesorería sólo pueden ser validados por un Supervisor desde su cuenta.',
    );
  }

  if (
    alert.dedupeKey?.startsWith('handover-elements-none:') &&
    user.roleKey !== ROLE_KEYS.SUPERVISOR
  ) {
    throw new RuleError(
      'Una entrega sin elementos físicos sólo puede ser validada por un Supervisor.',
    );
  }

  if (
    alert.dedupeKey?.startsWith('shift-validation:') &&
    user.roleKey !== ROLE_KEYS.SUPERVISOR &&
    !user.isSystemAdmin
  ) {
    throw new RuleError(
      'Los cierres de turno sólo pueden ser validados por Supervisión o por el Administrador de sistema.',
    );
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
      /*
        Un check-out marcado explícitamente como «Resuelto» desde el centro de
        notificaciones es una decisión humana sobre ESE aviso. Se conserva el
        dedupeKey pero deja de ser una alerta automática para que el motor no
        lo reabra en el siguiente refresco mientras la ficha física se termina
        de actualizar. La restricción única del dedupeKey impide recrearlo.
      */
      ...(checkoutDismissed ? { auto: false } : {}),
    },
    include: alertInclude,
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.CERRAR,
    summary: alert.dedupeKey?.startsWith('cash-transfer:')
      ? `Egreso a tesorería validado por Supervisor: ${alert.title}`
      : alert.dedupeKey?.startsWith('handover-elements-none:')
        ? `Entrega sin elementos validada por Supervisor: ${alert.title}`
        : alert.dedupeKey?.startsWith('shift-validation:')
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
  const alert = await loadAlert(input.id);
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
