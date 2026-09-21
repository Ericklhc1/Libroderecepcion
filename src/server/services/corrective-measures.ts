import 'server-only';
import {
  AuditAction,
  CorrectiveMeasureStatus,
  NotificationType,
  Priority,
  TaskParticipantRole,
  TaskStatus,
  TaskTargetType,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import { assertAssignable } from './users';

function assertOperationalSupervisor(user: CurrentUser) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('Las medidas correctivas sólo pueden ser gestionadas por el rol Supervisor.');
  }
}

export async function createCorrectiveMeasureFromFinding(
  user: CurrentUser,
  input: {
    findingId: string;
    title: string;
    action: string;
    assigneeId: string;
    dueAt?: Date | null;
    evidenceRequired?: string | null;
  },
) {
  assertOperationalSupervisor(user);
  await assertAssignable(input.assigneeId);
  const finding = await prisma.auditFinding.findFirst({
    where: { id: input.findingId, deletedAt: null },
    include: { audit: { select: { id: true, templateName: true, supervisionShiftId: true } } },
  });
  if (!finding) throw new NotFoundError('El hallazgo no existe.');

  return prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: input.title.trim(),
        description: input.action.trim(),
        fulfillmentCriteria: `Corregir el hallazgo confirmado: ${finding.description}`,
        evidenceRequired: input.evidenceRequired?.trim() || 'Evidencia verificable de la corrección.',
        priority:
          finding.severity === 'CRITICA'
            ? Priority.CRITICA
            : finding.severity === 'ALTA'
              ? Priority.ALTA
              : Priority.MEDIA,
        dueAt: input.dueAt ?? null,
        assigneeId: input.assigneeId,
        targetType: TaskTargetType.PERSONA,
        createdById: user.id,
        supervisionShiftId: finding.audit.supervisionShiftId,
        participants: {
          create: {
            userId: input.assigneeId,
            assignedById: user.id,
            role: TaskParticipantRole.PRINCIPAL,
          },
        },
      },
    });
    const measure = await tx.correctiveMeasure.create({
      data: {
        findingId: finding.id,
        taskId: task.id,
        title: input.title.trim(),
        action: input.action.trim(),
        assigneeId: input.assigneeId,
        dueAt: input.dueAt ?? null,
        createdById: user.id,
      },
      include: { task: true, assignee: { select: { id: true, name: true } } },
    });
    await recordAudit(
      {
        entity: 'CorrectiveMeasure',
        entityId: measure.id,
        action: AuditAction.CREAR,
        summary: `Medida correctiva creada desde «${finding.audit.templateName}»: ${measure.title}`,
        user,
        after: {
          findingId: finding.id,
          taskId: task.id,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
        },
      },
      tx,
    );
    if (input.assigneeId !== user.id) {
      await notify(
        {
          userId: input.assigneeId,
          type: NotificationType.TAREA_ASIGNADA,
          title: `Medida correctiva asignada: ${measure.title}`,
          body: input.evidenceRequired?.trim() || 'Requiere evidencia verificable.',
          link: `/tareas/${task.id}`,
          entity: 'CorrectiveMeasure',
          entityId: measure.id,
        },
        tx,
      );
    }
    return measure;
  });
}

const MEASURE_TRANSITIONS: Record<CorrectiveMeasureStatus, CorrectiveMeasureStatus[]> = {
  PENDIENTE: ['EN_CURSO', 'BLOQUEADA', 'REALIZADA', 'CANCELADA'],
  EN_CURSO: ['BLOQUEADA', 'REALIZADA', 'CANCELADA'],
  BLOQUEADA: ['EN_CURSO', 'REALIZADA', 'CANCELADA'],
  REALIZADA: ['VALIDADA', 'EN_CURSO'],
  VALIDADA: ['EN_CURSO'],
  CANCELADA: ['PENDIENTE'],
};

export async function changeCorrectiveMeasureStatus(
  user: CurrentUser,
  input: {
    id: string;
    status: CorrectiveMeasureStatus;
    evidence?: string | null;
    reason?: string | null;
  },
) {
  assertOperationalSupervisor(user);
  const current = await prisma.correctiveMeasure.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!current) throw new NotFoundError('La medida correctiva no existe.');
  if (!MEASURE_TRANSITIONS[current.status].includes(input.status)) {
    throw new RuleError(`La medida no puede pasar de ${current.status} a ${input.status}.`);
  }
  if (input.status === CorrectiveMeasureStatus.REALIZADA && !input.evidence?.trim()) {
    throw new RuleError('La medida correctiva requiere evidencia antes de marcarla como realizada.');
  }
  if (input.status === CorrectiveMeasureStatus.VALIDADA) {
    if (!user.permissions.includes('supervision.corrective.manage')) {
      throw new RuleError('No tienes permiso para validar medidas correctivas.');
    }
    if (current.status !== CorrectiveMeasureStatus.REALIZADA) {
      throw new RuleError('Sólo una medida realizada puede validarse.');
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.correctiveMeasure.update({
      where: { id: current.id },
      data: {
        status: input.status,
        evidence: input.evidence?.trim() || current.evidence,
        blockedReason:
          input.status === CorrectiveMeasureStatus.BLOQUEADA
            ? input.reason?.trim() || 'Sin motivo informado'
            : null,
        validatedAt: input.status === CorrectiveMeasureStatus.VALIDADA ? new Date() : null,
        validatedById: input.status === CorrectiveMeasureStatus.VALIDADA ? user.id : null,
      },
    });
    if (current.taskId) {
      const taskStatus =
        input.status === CorrectiveMeasureStatus.REALIZADA
          ? TaskStatus.REALIZADA
          : input.status === CorrectiveMeasureStatus.VALIDADA
            ? TaskStatus.VALIDADA
            : input.status === CorrectiveMeasureStatus.EN_CURSO
              ? TaskStatus.EN_CURSO
              : input.status === CorrectiveMeasureStatus.BLOQUEADA
                ? TaskStatus.BLOQUEADA
                : input.status === CorrectiveMeasureStatus.CANCELADA
                  ? TaskStatus.CANCELADA
                  : TaskStatus.PENDIENTE;
      await tx.task.update({
        where: { id: current.taskId },
        data: {
          status: taskStatus,
          evidenceProvided: input.evidence?.trim() || undefined,
          validatedAt: taskStatus === TaskStatus.VALIDADA ? new Date() : null,
          validatedById: taskStatus === TaskStatus.VALIDADA ? user.id : null,
        },
      });
    }
    await recordAudit(
      {
        entity: 'CorrectiveMeasure',
        entityId: updated.id,
        action:
          input.status === CorrectiveMeasureStatus.VALIDADA
            ? AuditAction.CERRAR
            : AuditAction.CAMBIO_ESTADO,
        summary: `Medida correctiva: ${current.status} → ${input.status}`,
        user,
        before: { status: current.status },
        after: { status: input.status, evidence: input.evidence },
        reason: input.reason ?? null,
      },
      tx,
    );
    return updated;
  });
}

export async function softDeleteCorrectiveMeasure(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  assertOperationalSupervisor(user);
  const measure = await prisma.correctiveMeasure.findFirst({
    where: { id: input.id, deletedAt: null },
  });
  if (!measure) throw new NotFoundError('La medida correctiva no existe o ya fue eliminada.');
  const deleted = await prisma.correctiveMeasure.update({
    where: { id: measure.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
  });
  await recordAudit({
    entity: 'CorrectiveMeasure',
    entityId: measure.id,
    action: AuditAction.ELIMINAR,
    summary: `Medida correctiva eliminada lógicamente: ${measure.title}`,
    user,
    reason: input.reason,
  });
  return deleted;
}

export async function restoreCorrectiveMeasure(user: CurrentUser, id: string) {
  if (!user.isSystemAdmin) {
    throw new RuleError('Sólo el Administrador de sistema puede restaurar medidas correctivas.');
  }
  const measure = await prisma.correctiveMeasure.findFirst({
    where: { id, deletedAt: { not: null } },
  });
  if (!measure) throw new NotFoundError('La medida correctiva no está eliminada.');
  const restored = await prisma.correctiveMeasure.update({
    where: { id: measure.id },
    data: { deletedAt: null, deletedById: null, deletionReason: null },
  });
  await recordAudit({
    entity: 'CorrectiveMeasure',
    entityId: measure.id,
    action: AuditAction.RESTAURAR,
    summary: `Medida correctiva restaurada: ${measure.title}`,
    user,
  });
  return restored;
}
