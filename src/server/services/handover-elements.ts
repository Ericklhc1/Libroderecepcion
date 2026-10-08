import 'server-only';
import { AuditAction, HandoverStatus, NotificationType, ShiftStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';

export async function lockHandover(tx: Prisma.TransactionClient, handoverId: string) {
  await tx.$queryRaw`SELECT id FROM "ShiftHandover" WHERE id = ${handoverId} FOR UPDATE`;
}

export async function assertElementActor(tx: Prisma.TransactionClient, user: CurrentUser, handoverId: string, field: 'declared' | 'confirmed') {
  const handover = await tx.shiftHandover.findUnique({
    where: { id: handoverId },
    include: { fromShift: true, toShift: true },
  });
  if (!handover) throw new NotFoundError('La entrega indicada no existe.');
  const permission = field === 'declared' ? 'shift.handover' : 'shift.receive';
  if (!user.permissions.includes(permission)) throw new ForbiddenError();
  const shiftId = field === 'declared' ? handover.fromShiftId : handover.toShiftId;
  const assignment = shiftId ? await tx.shiftAssignment.findFirst({
    where: { shiftId, userId: user.id, activatedAt: { not: null }, leftAt: null },
  }) : null;
  if (!assignment) throw new ForbiddenError('Sólo quien entrega o recibe este turno puede declarar su custodia.');
  if (field === 'declared') {
    if (handover.status !== HandoverStatus.BORRADOR || handover.fromShift.status !== ShiftStatus.PREPARANDO_ENTREGA) {
      throw new RuleError('La entrega ya no admite cambiar los elementos declarados.');
    }
  } else if (handover.status !== HandoverStatus.ENVIADA || handover.receivedAt ||
    handover.fromShift.status !== ShiftStatus.CERRADO ||
    !handover.toShift || ![ShiftStatus.INICIADO, ShiftStatus.ACTIVO].includes(handover.toShift.status as 'INICIADO' | 'ACTIVO')) {
    throw new RuleError('Esta entrega ya no admite cambios en la recepción.');
  }
  return handover;
}

export const clearMissingElement = {
  missingReason: null, missingReportedById: null, missingReportedAt: null,
  missingApprovedById: null, missingApprovedByName: null, missingApprovedAt: null, missingApprovalNote: null,
};

async function invalidateCustody(tx: Prisma.TransactionClient, handoverId: string) {
  await tx.shiftHandover.update({ where: { id: handoverId }, data: {
    receiverCustodyReviewedAt: null, receiverFinalReviewAt: null, receiverFinalSummaryKey:null, receiverUrgentAcknowledgedAt: null,
  } });
}

export async function reportHandoverElementMissing(user: CurrentUser, input: {
  handoverId: string; elementId: string; reason: string; revision: string;
}) {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new RuleError('Explica qué falta y cómo se localizará (5 a 500 caracteres).');
  return prisma.$transaction(async tx => {
    await lockHandover(tx, input.handoverId);
    await assertElementActor(tx, user, input.handoverId, 'confirmed');
    const element = await tx.handoverElement.findFirst({ where: { id: input.elementId, handoverId: input.handoverId }, include: { elementType: true } });
    if (!element) throw new NotFoundError();
    if (!element.declared || element.confirmed) throw new RuleError('Sólo puedes informar un elemento declarado que aún no has recibido.');
    if (element.missingReason === reason && element.missingReportedById === user.id) return element;
    if (element.updatedAt.toISOString() !== input.revision) throw new RuleError('La custodia cambió. Actualiza antes de informar la diferencia.');
    const updated = await tx.handoverElement.update({ where: { id: element.id }, data: {
      ...clearMissingElement, missingReason: reason, missingReportedById: user.id, missingReportedAt: new Date(),
    } });
    await invalidateCustody(tx, input.handoverId);
    await recordAudit({ user, entity: 'ShiftHandover', entityId: input.handoverId, action: AuditAction.EDITAR,
      summary: `No recibido: ${element.elementType.name}. Excepción pendiente de Supervisión.`,
      before: { elementId: element.id, confirmed: element.confirmed, missingReason: element.missingReason },
      after: { elementId: element.id, confirmed: false, missingReason: reason, responsibleId: user.id }, reason,
    }, tx);
    const supervisors = await tx.user.findMany({ where: { active: true, deletedAt: null, id: { not: user.id },
      role: { permissions: { some: { permission: { key: 'shift.manage' } } } } }, select: { id: true } });
    await notify(supervisors.map(supervisor => ({ userId: supervisor.id, type: NotificationType.ACCION_REQUERIDA,
      title: 'Elemento no recibido en el relevo', body: `${element.elementType.name}: revisar la diferencia y autorizar o mantener el bloqueo.`,
      link: `/turno/entrega/${input.handoverId}`, entity: 'ShiftHandover', entityId: input.handoverId,
    })), tx);
    return updated;
  });
}

export async function approveHandoverElementException(user: CurrentUser, input: {
  handoverId: string; elementId: string; reason: string; revision: string;
}) {
  if (!user.permissions.includes('shift.manage')) throw new ForbiddenError();
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new RuleError('Indica el tratamiento de la diferencia (5 a 500 caracteres).');
  return prisma.$transaction(async tx => {
    await lockHandover(tx, input.handoverId);
    const handover = await tx.shiftHandover.findUnique({ where: { id: input.handoverId }, include: { fromShift: true } });
    if (!handover || handover.status !== HandoverStatus.ENVIADA || handover.receivedAt || handover.fromShift.status !== ShiftStatus.CERRADO) {
      throw new RuleError('La recepción ya no está pendiente.');
    }
    const element = await tx.handoverElement.findFirst({ where: { id: input.elementId, handoverId: input.handoverId }, include: { elementType: true } });
    if (!element?.missingReason || element.confirmed) throw new RuleError('No hay una diferencia pendiente para revisar.');
    if (element.missingReportedById === user.id) throw new RuleError('Otra persona de Supervisión debe revisar tu declaración.');
    if (element.missingApprovedAt) return element;
    if (element.updatedAt.toISOString() !== input.revision) throw new RuleError('La diferencia cambió. Actualiza antes de autorizar.');
    const updated = await tx.handoverElement.update({ where: { id: element.id }, data: {
      missingApprovedById: user.id, missingApprovedByName: user.name, missingApprovedAt: new Date(), missingApprovalNote: reason,
    } });
    await invalidateCustody(tx, input.handoverId);
    await recordAudit({ user, entity: 'ShiftHandover', entityId: input.handoverId, action: AuditAction.EDITAR,
      summary: `Continuidad autorizada con ${element.elementType.name} no recibido; no acredita posesión.`,
      after: { elementId: element.id, confirmed: false, missingReason: element.missingReason, approvedById: user.id, treatment: reason }, reason,
    }, tx);
    await notify({ userId: element.missingReportedById!, type: NotificationType.ACCION_REQUERIDA,
      title: 'Puedes continuar la recepción con diferencia', body: `${element.elementType.name} sigue no recibido. Revisa el tratamiento autorizado por ${user.name}.`,
      link: `/turno/entrega/${input.handoverId}`, entity: 'ShiftHandover', entityId: input.handoverId,
    }, tx);
    return updated;
  });
}
