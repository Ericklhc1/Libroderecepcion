import type { Prisma } from '@prisma/client';
import 'server-only';
import { AlertStatus, AuditAction, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { ROLE_KEYS } from '@/lib/permissions';

export function assertClosureReviewer(user: CurrentUser) {
  if (!user.permissions.includes('shift.manage') || (!user.isSystemAdmin && user.roleKey !== ROLE_KEYS.SUPERVISOR)) throw new ForbiddenError();
}

/** Canonical live legacy evidence; archived alerts remain history only. */
export function legacyClosureAlertWhere(shiftId?:string): Prisma.AlertWhereInput {
  return {deletedAt:null,dedupeKey:shiftId?`shift-validation:${shiftId}`:{startsWith:'shift-validation:'}};
}
export function closureReviewState(shift:{status:ShiftStatus;archivedAt:Date|null;closureReviewDecision:string|null;closureReviewRequestedAt:Date|null},legacy:{status:AlertStatus}|null) {
  const pending=shift.status===ShiftStatus.CERRADO&&!shift.archivedAt&&shift.closureReviewDecision!=='VALIDADA'&&Boolean(shift.closureReviewRequestedAt||legacy&&legacy.status!==AlertStatus.RESUELTA);
  return {pending,decision:shift.closureReviewDecision??(legacy?.status===AlertStatus.RESUELTA?'VALIDADA (histórica)':pending?'Pendiente':'Sin solicitud vigente')};
}

/** Existing closed Shift is the action; legacy alerts remain immutable evidence. */
export async function listPendingClosureReviews(user: CurrentUser) {
  assertClosureReviewer(user);
  const legacy = await prisma.alert.findMany({
    where: { ...legacyClosureAlertWhere(), status: { not: AlertStatus.RESUELTA } },
    select: { dedupeKey: true },
  });
  return prisma.shift.findMany({
    where: { status: ShiftStatus.CERRADO, archivedAt: null, ...(user.isSystemAdmin ? {} : { isDemo: false }),
      AND: [
        { OR: [{ closureReviewDecision: null }, { closureReviewDecision: { not: 'VALIDADA' } }] },
        { OR: [{ closureReviewRequestedAt: { not: null } }, { id: { in: legacy.map(a => a.dedupeKey!.slice('shift-validation:'.length)) } }] },
      ],
    },
    include: { handoverOut: { select: { id: true } } },
    orderBy: [{ date: 'asc' }, { actualEnd: 'asc' }, { id: 'asc' }],
  });
}

export async function reviewShiftClosure(user: CurrentUser, input: { shiftId: string; decision: 'VALIDADA' | 'OBSERVADA'; note: string; revision: string }) {
  assertClosureReviewer(user);
  const note = input.note.trim();
  if (!note || note.length > 2000 || !['VALIDADA', 'OBSERVADA'].includes(input.decision)) throw new RuleError('Indica la evidencia revisada o la observación (hasta 2000 caracteres).');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id" = ${input.shiftId} FOR UPDATE`;
    const shift = await tx.shift.findUnique({ where: { id: input.shiftId } });
    if (!shift || (shift.isDemo && !user.isSystemAdmin)) throw new NotFoundError('El turno no existe.');
    if (shift.status !== ShiftStatus.CERRADO || shift.archivedAt || shift.closureReviewDecision === 'VALIDADA') throw new RuleError('Este cierre no tiene una validación pendiente.');
    if (shift.updatedAt.toISOString() !== input.revision) throw new RuleError('El cierre cambió. Actualiza antes de decidir.');
    const legacy = shift.closureReviewRequestedAt ? null : await tx.alert.findFirst({ where: { ...legacyClosureAlertWhere(shift.id), status: { not: AlertStatus.RESUELTA } } });
    if (!shift.closureReviewRequestedAt && !legacy) throw new RuleError('Este cierre no tiene una validación pendiente.');
    const updated = await tx.shift.update({ where: { id: shift.id }, data: {
      closureReviewRequestedAt: shift.closureReviewRequestedAt ?? new Date(),
      closureReviewDecision: input.decision, closureReviewNote: note,
      closureReviewedAt: new Date(), closureReviewedById: user.id,
    } });
    // Mandatory audit in the same transaction (no best-effort write).
    await tx.auditLog.create({ data: {
      entity: 'Shift', entityId: shift.id, action: AuditAction.CAMBIO_ESTADO,
      summary: `Cierre ${input.decision === 'VALIDADA' ? 'validado' : 'observado'} por ${user.name}`,
      userId: user.id, sessionId: user.sessionId, isDemo: shift.isDemo, reason: note,
      before: { closureReviewDecision: shift.closureReviewDecision, closureReviewRequestedAt:shift.closureReviewRequestedAt?.toISOString()??null },
      after: { closureReviewRequestedAt:updated.closureReviewRequestedAt?.toISOString(), closureReviewDecision: updated.closureReviewDecision, closureReviewedAt: updated.closureReviewedAt?.toISOString(), legacyAlertId: legacy?.id ?? null } as Prisma.InputJsonObject,
    } });
    return updated;
  });
}
