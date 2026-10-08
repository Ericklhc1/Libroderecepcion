import {alertReadWhere,taskFollowUpReadWhere} from './followup-access';
import 'server-only';
import { AlertLevel, AlertStatus, AlertType, AuditAction, EntryStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { hasPermission, type CurrentUser } from '@/server/auth/current-user';
import { ALERT_STATUS_LABEL, ALERT_TYPE_LABEL } from '@/domain/labels';
import { ROLE_KEYS } from '@/lib/permissions';
import { applyCashTransferToLiveCash } from '@/server/services/cash';
import { insertCashMovement } from '@/server/services/live-cash';
import { finishSupervisionTrackingForSource } from '@/server/services/followups';
import {
  SUPERVISION_BACKUP_EMAIL,
  operationalMailTimestamp,
  queueOperationalMail,
} from '@/server/services/operational-mail';

export const alertInclude = {
  entry: { select: { id: true, humanId: true, title: true, type: true } },
  task: { select: { id: true, humanId: true, title: true } },
  followUp: { select: { id: true, action: true } },
  handover: { select: { id: true, fromShift: { select: { type: true, date: true } } } },
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
  if(input.taskId&&!await prisma.task.findFirst({where:{id:input.taskId,deletedAt:null,AND:[taskFollowUpReadWhere(user)]},select:{id:true}}))throw new NotFoundError('La tarea de origen no existe.');
  const created = await prisma.alert.create({
    data: {
      type: input.type,
      level: input.level,
      title: input.title,
      message: input.message ?? null,
      dueAt: input.dueAt ?? null,
      entryId: input.entryId ?? null,
      taskId: input.taskId ?? null,
      // Campos aceptados sólo para compatibilidad de llamadas antiguas.
      // El runtime v1.4.0 no persiste contexto PMS en alertas nuevas.
      reservationId: null,
      guestId: null,
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
    summary: `Alerta #${created.humanId} manual (${ALERT_TYPE_LABEL[created.type]}): ${created.title}`,
    user,
    after: { type: created.type, level: created.level, title: created.title },
  });
  return created;
}

async function loadAlert(user: CurrentUser,id: string) {
  const alert = await prisma.alert.findFirst({ where: { id, deletedAt: null,AND:[alertReadWhere(user)] } });
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
 * Autoriza una solicitud de movimiento sin permitir doble aplicación.
 * EN_ESPERA → EN_CURSO funciona como un candado transaccional; sólo el proceso
 * que reclama la fila inserta el movimiento. Después queda RESUELTO y marcado
 * con `ajuste-aplicado` para que un reintento sea idempotente.
 */
async function applyCashManualApproval(user: CurrentUser, entryId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const entry = await tx.operationalEntry.findFirst({
      where: { id: entryId, deletedAt: null, category: 'AJUSTE_CAJA_SOLICITADO' },
      select: {
        id: true,
        status: true,
        shiftId: true,
        tags: true,
        title: true,
        createdById: true,
        createdBy: { select: { name: true, username: true } },
      },
    });
    if (!entry) throw new RuleError('La solicitud de Caja vinculada ya no existe.');
    if (entry.tags.includes('ajuste-aplicado')) return;

    const direction = tagValue(entry.tags, 'direccion-');
    const currency = tagValue(entry.tags, 'moneda-');
    const amount = Number(tagValue(entry.tags, 'monto-'));
    const reference = decodeTag(tagValue(entry.tags, 'referencia-')) ?? entry.title;
    const notes = decodeTag(tagValue(entry.tags, 'notas-'));
    const effectiveAtIso = decodeTag(tagValue(entry.tags, 'efectiva-'));
    const effectiveAt = effectiveAtIso ? new Date(effectiveAtIso) : new Date();
    if (Number.isNaN(effectiveAt.getTime())) {
      throw new RuleError('La solicitud de Caja contiene una fecha efectiva inválida.');
    }
    if (
      (direction !== 'ENTRADA' && direction !== 'SALIDA') ||
      (currency !== 'CLP' && currency !== 'USD') ||
      !(amount > 0)
    ) {
      throw new RuleError('La solicitud de Caja no contiene datos válidos para autorizarse.');
    }

    const claimed = await tx.operationalEntry.updateMany({
      where: { id: entry.id, status: EntryStatus.EN_ESPERA },
      data: { status: EntryStatus.EN_CURSO },
    });
    if (claimed.count === 0) {
      const refreshed = await tx.operationalEntry.findUnique({
        where: { id: entry.id },
        select: { status: true, tags: true },
      });
      if (refreshed?.tags.includes('ajuste-aplicado')) return;
      throw new RuleError('La solicitud de Caja ya no está pendiente de autorización.');
    }

    const kind = direction === 'ENTRADA' ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
    const movementId = await insertCashMovement(tx, {
      userId: entry.createdById,
      kind,
      direction,
      currency,
      amount,
      shiftId: entry.shiftId,
      reference,
      notes,
      effectiveAt,
    });

    if (!entry.shiftId) {
      await tx.alert.create({
        data: {
          type: AlertType.OTRO,
          level: AlertLevel.CRITICA,
          status: AlertStatus.NUEVA,
          title: 'MOVIMIENTO SIN SESIÓN DE CAJA',
          message:
            `${direction === 'ENTRADA' ? 'Ingreso' : 'Egreso'} de ${currency} ${amount.toLocaleString('es-CL')} · ${reference}. ` +
            'Fue autorizado sin turno operativo abierto. Supervisión debe revisar y regularizar la trazabilidad.',
          entryId: entry.id,
          dedupeKey: `cash-no-session:${movementId}`,
          auto: false,
          createdById: user.id,
        },
      });
    }

    await tx.operationalEntry.update({
      where: { id: entry.id },
      data: {
        status: EntryStatus.RESUELTO,
        resolution: `Movimiento autorizado por ${user.name}.`,
        requiresFollowUp: false,
        closedAt: new Date(),
        closedById: user.id,
        tags: { push: 'ajuste-aplicado' },
      },
    });

    await recordAudit(
      {
        entity: 'CashMovement',
        entityId: movementId,
        action: AuditAction.CREAR,
        summary: `Movimiento de Caja autorizado por ${user.name}: ${direction} ${amount} ${currency} · ${reference}`,
        user,
        after: {
          direction,
          currency,
          amount,
          reference,
          requestEntryId: entry.id,
          shiftId: entry.shiftId,
          effectiveAt: effectiveAt.toISOString(),
          requestedById: entry.createdById,
          approvedById: user.id,
          withoutCashSession: !entry.shiftId,
        },
      },
      tx,
    );

    await queueOperationalMail(tx, {
      eventKey: `cash-movement:${movementId}`,
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: `[Libro Operativo] ${direction === 'ENTRADA' ? 'INGRESO' : 'EGRESO'} CAJA AUTORIZADO · ${currency} ${amount} · ${reference}`,
      text: [
        `${direction === 'ENTRADA' ? 'INGRESO' : 'EGRESO'} DE CAJA AUTORIZADO`,
        `ID movimiento: ${movementId}`,
        `Solicitud: ${entry.id}`,
        `Fecha/hora efectiva: ${operationalMailTimestamp(effectiveAt)}`,
        `Solicitado por: ${entry.createdBy.name} (@${entry.createdBy.username})`,
        `Autorizado por: ${user.name} (ID ${user.id})`,
        `Dirección: ${direction}`,
        `Monto: ${currency} ${amount}`,
        `Concepto: ${reference}`,
        `Turno: ${entry.shiftId ?? 'sin turno asociado'}`,
        `Observaciones: ${notes ?? 'sin observaciones'}`,
      ].join('\n'),
    });
  });
}

export async function acknowledgeAlert(user: CurrentUser, id: string) {
  const alert = await loadAlert(user,id);
  if (alert.status === AlertStatus.RESUELTA) {
    throw new RuleError('La alerta ya está resuelta.');
  }
  const updated = await prisma.alert.update({
    where: { id,AND:[alertReadWhere(user)] },
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
    summary: `Alerta #${alert.humanId} marcada como vista: ${alert.title}`,
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
  const alert = await loadAlert(user,input.id);
  if (alert.status === AlertStatus.RESUELTA) {
    throw new RuleError('La alerta ya está resuelta.');
  }
  const minutes = input.snoozeMinutes ?? 60;
  const until = new Date(Date.now() + minutes * 60_000);
  const updated = await prisma.alert.update({
    where: { id: input.id,AND:[alertReadWhere(user)] },
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
    summary: `Alerta #${alert.humanId} pospuesta ${minutes} minutos: ${alert.title}`,
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
  const alert = await loadAlert(user,input.id);
  if (alert.status === AlertStatus.RESUELTA) return alert;

  const cashTransfer = alert.dedupeKey?.startsWith('cash-transfer:') === true;
  const cashManual = alert.dedupeKey?.startsWith('cash-manual:') === true;
  const noElements = alert.dedupeKey?.startsWith('handover-elements-none:') === true;
  const shiftValidation = alert.dedupeKey?.startsWith('shift-validation:') === true;

  if ((cashTransfer || cashManual) && !hasPermission(user, 'cash.approve')) {
    throw new RuleError('Tu rol no tiene habilitado autorizar operaciones de Caja.');
  }

  if (noElements && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError(
      'Una entrega sin elementos físicos sólo puede ser validada por un Supervisor.',
    );
  }

  if (shiftValidation) {
    throw new RuleError('Valida u observa este cierre desde el Centro de Supervisión, con evidencia y revisión vigente.');
  }

  if (cashManual) {
    if (!alert.entryId) throw new RuleError('La solicitud de Caja no tiene un registro vinculado.');
    await applyCashManualApproval(user, alert.entryId);
  }
  if (cashTransfer) {
    const transferId = alert.dedupeKey?.replace('cash-transfer:', '');
    if (!transferId) {
      throw new RuleError('La solicitud de Tesorería no contiene la transferencia vinculada.');
    }
    await prisma.$transaction(async (tx) => {
      await applyCashTransferToLiveCash(tx, transferId);
      await recordAudit(
        {
          entity: 'CashTransfer',
          entityId: transferId,
          action: AuditAction.CAMBIO_ESTADO,
          summary: `Egreso a tesorería autorizado por ${user.name}.`,
          user,
          after: { approvedById: user.id },
        },
        tx,
      );
    });
  }

  const checkoutDismissed = alert.dedupeKey?.startsWith('checkout-unconfirmed:') === true;
  return prisma.$transaction(async (tx) => {
    const resolvedAt = new Date();
    const updated = await tx.alert.update({
      where: { id: input.id,AND:[alertReadWhere(user)] },
      data: {
        status: AlertStatus.RESUELTA,
        resolvedById: user.id,
        resolvedAt,
        resolutionNote: input.note ?? null,
        snoozedUntil: null,
        ...(checkoutDismissed ? { auto: false } : {}),
      },
      include: alertInclude,
    });

    await finishSupervisionTrackingForSource(tx, user, 'Alert', alert.id, 'RESUELTO');
    await recordAudit(
      {
        entity: 'Alert',
        entityId: input.id,
        action: AuditAction.CERRAR,
        summary: cashTransfer
          ? `Egreso a tesorería validado por ${user.name}: ${alert.title}`
          : cashManual
            ? `Movimiento manual de Caja autorizado por ${user.name}: ${alert.title}`
            : noElements
              ? `Entrega sin elementos validada por Supervisor: ${alert.title}`
              : `Alerta #${alert.humanId} resuelta: ${alert.title}`,
        user,
        before: { status: alert.status },
        after: { status: AlertStatus.RESUELTA, ...(checkoutDismissed ? { auto: false } : {}) },
        reason: input.note ?? null,
      },
      tx,
    );
    return updated;
  });
}

export async function softDeleteAlert(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const alert = await loadAlert(user,input.id);
  if(alert.dedupeKey?.startsWith('shift-validation:'))throw new RuleError('Las alertas históricas de cierre se conservan como evidencia. Revisa el cierre en el Centro de Supervisión.');
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.alert.update({
      where: { id: input.id,AND:[alertReadWhere(user)] },
      data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
    });
    await finishSupervisionTrackingForSource(tx, user, 'Alert', alert.id, 'CANCELADO');
    await recordAudit(
      {
        entity: 'Alert',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica de la alerta #${alert.humanId}: ${alert.title}`,
        user,
        after: { deletedAt: deleted.deletedAt },
        reason: input.reason,
      },
      tx,
    );
    return deleted;
  });
}

export async function restoreAlert(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
) {
  const alert = await prisma.alert.findFirst({
    where: { id: input.id, NOT: { deletedAt: null },AND:[alertReadWhere(user)] },
  });
  if (!alert) throw new NotFoundError('La alerta no está eliminada.');
  const restored = await prisma.alert.update({
    where: { id: input.id,AND:[alertReadWhere(user)] },
    data: { deletedAt: null, deletedById: null, deletionReason: null },
  });
  await recordAudit({
    entity: 'Alert',
    entityId: input.id,
    action: AuditAction.RESTAURAR,
    summary: `Alerta #${alert.humanId} restaurada: ${alert.title} (${ALERT_STATUS_LABEL[alert.status]})`,
    user,
    before: { deletedAt: alert.deletedAt },
    after: { deletedAt: null },
    reason: input.reason ?? null,
  });
  return restored;
}
