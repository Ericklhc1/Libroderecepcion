import 'server-only';
import {
  AuditAction,
  SupervisionShiftStatus,
  SupervisionVisibility,
  TaskStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import { TASK_OPEN_STATUSES } from '@/domain/labels';

const OPEN_SUPERVISION_STATUSES = [
  SupervisionShiftStatus.ACTIVO,
  SupervisionShiftStatus.ENTREGADO,
] as const;

function assertSupervisor(user: CurrentUser) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('El turno de Supervisión sólo puede ser operado por el rol Supervisor.');
  }
}

export async function getMyOpenSupervisionShift(userId: string) {
  return prisma.supervisionShift.findFirst({
    where: { supervisorId: userId, status: { in: [...OPEN_SUPERVISION_STATUSES] } },
    include: { handover: true },
    orderBy: { startedAt: 'desc' },
  });
}

export async function startSupervisionShift(
  user: CurrentUser,
  input: { priorities: string[] },
) {
  assertSupervisor(user);
  const priorities = input.priorities.map((item) => item.trim()).filter(Boolean).slice(0, 12);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.supervisionShift.findFirst({
      where: { supervisorId: user.id, status: { in: [...OPEN_SUPERVISION_STATUSES] } },
      select: { id: true },
    });
    if (existing) throw new RuleError('Ya tienes un turno de Supervisión abierto.');

    const shift = await tx.supervisionShift.create({
      data: { supervisorId: user.id, priorities },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_INICIAR,
        summary: `Turno de Supervisión iniciado por ${user.name}`,
        user,
        after: { startedAt: shift.startedAt, priorities },
      },
      tx,
    );
    return shift;
  });
}

async function buildSupervisionSnapshot(
  shiftId: string,
  client: Prisma.TransactionClient,
): Promise<Prisma.InputJsonObject> {
  const shift = await client.supervisionShift.findUnique({
    where: { id: shiftId },
    include: { supervisor: { select: { id: true, name: true } } },
  });
  if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');

  const [tasks, followUps, audits, correctiveMeasures, decisions] = await Promise.all([
    client.task.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        seq: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.followUp.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        action: true,
        status: true,
        priority: true,
        scheduledAt: true,
        owner: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.checklistRun.findMany({
      where: { supervisionShiftId: shift.id, deletedAt: null },
      select: {
        id: true,
        templateName: true,
        status: true,
        severity: true,
        finishedAt: true,
        _count: { select: { findings: true } },
      },
      orderBy: { startedAt: 'asc' },
    }),
    client.correctiveMeasure.findMany({
      where: {
        deletedAt: null,
        finding: { audit: { supervisionShiftId: shift.id } },
      },
      select: {
        id: true,
        title: true,
        status: true,
        dueAt: true,
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    client.auditLog.findMany({
      where: { userId: shift.supervisorId, createdAt: { gte: shift.startedAt } },
      select: { id: true, entity: true, entityId: true, action: true, summary: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
  ]);

  return JSON.parse(
    JSON.stringify({
      version: 1,
      capturedAt: new Date(),
      shift: {
        id: shift.id,
        startedAt: shift.startedAt,
        supervisor: shift.supervisor,
        priorities: shift.priorities,
      },
      tasks,
      followUps,
      audits,
      correctiveMeasures,
      decisions,
      summary: {
        tasksCompleted: tasks.filter((task) =>
          new Set<TaskStatus>([
            TaskStatus.REALIZADA,
            TaskStatus.VALIDADA,
            TaskStatus.COMPLETADA,
          ]).has(task.status),
        ).length,
        tasksPending: tasks.filter((task) => TASK_OPEN_STATUSES.includes(task.status)).length,
        tasksBlocked: tasks.filter((task) => task.status === TaskStatus.BLOQUEADA).length,
        tasksReturned: tasks.filter((task) => task.status === TaskStatus.DEVUELTA).length,
        followUpsOpen: followUps.filter((followUp) =>
          ['PENDIENTE', 'VENCIDO'].includes(followUp.status),
        ).length,
        auditsOpen: audits.filter((audit) => audit.status !== 'CERRADA').length,
        correctiveMeasuresOpen: correctiveMeasures.filter(
          (measure) => !['VALIDADA', 'CANCELADA'].includes(measure.status),
        ).length,
      },
    }),
  ) as Prisma.InputJsonObject;
}

export async function deliverSupervisionShift(
  user: CurrentUser,
  input: { shiftId: string; note?: string | null },
) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findUnique({ where: { id: input.shiftId } });
    if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');
    if (shift.supervisorId !== user.id) throw new RuleError('Ese turno pertenece a otro supervisor.');
    if (shift.status !== SupervisionShiftStatus.ACTIVO) {
      throw new RuleError('Sólo un turno de Supervisión activo puede entregarse.');
    }

    const snapshot = await buildSupervisionSnapshot(shift.id, tx);
    const handover = await tx.supervisionShiftHandover.create({
      data: {
        supervisionShiftId: shift.id,
        issuedById: user.id,
        note: input.note?.trim() || null,
        snapshot,
      },
    });
    await tx.supervisionShift.update({
      where: { id: shift.id },
      data: { status: SupervisionShiftStatus.ENTREGADO, deliveredAt: handover.issuedAt },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_ENTREGAR,
        summary: `Turno de Supervisión entregado por ${user.name}`,
        user,
        after: { handoverId: handover.id, issuedAt: handover.issuedAt },
      },
      tx,
    );
    return handover;
  });
}

export async function finishSupervisionShift(user: CurrentUser, shiftId: string) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findUnique({
      where: { id: shiftId },
      include: { handover: { select: { id: true } } },
    });
    if (!shift) throw new NotFoundError('El turno de Supervisión no existe.');
    if (shift.supervisorId !== user.id) throw new RuleError('Ese turno pertenece a otro supervisor.');
    if (shift.status !== SupervisionShiftStatus.ENTREGADO || !shift.handover) {
      throw new RuleError('Entrega el turno de Supervisión antes de finalizarlo.');
    }

    const finished = await tx.supervisionShift.update({
      where: { id: shift.id },
      data: { status: SupervisionShiftStatus.CERRADO, finishedAt: new Date() },
    });
    await recordAudit(
      {
        entity: 'SupervisionShift',
        entityId: shift.id,
        action: AuditAction.TURNO_CERRAR,
        summary: `Turno de Supervisión finalizado por ${user.name}`,
        user,
        after: { finishedAt: finished.finishedAt },
      },
      tx,
    );
    return finished;
  });
}

export async function receiveSupervisionHandover(user: CurrentUser, handoverId: string) {
  assertSupervisor(user);
  return prisma.$transaction(async (tx) => {
    const handover = await tx.supervisionShiftHandover.findUnique({
      where: { id: handoverId },
      include: { issuedBy: { select: { name: true } } },
    });
    if (!handover) throw new NotFoundError('La entrega de Supervisión no existe.');
    if (handover.issuedById === user.id) {
      throw new RuleError('No puedes recibir tu propia entrega de Supervisión.');
    }
    if (handover.receivedAt) throw new RuleError('Esta entrega ya fue recibida.');
    const receivedAt = new Date();
    const received = await tx.supervisionShiftHandover.update({
      where: { id: handover.id },
      data: { receivedById: user.id, receivedAt },
    });
    await recordAudit(
      {
        entity: 'SupervisionShiftHandover',
        entityId: handover.id,
        action: AuditAction.TURNO_RECIBIR,
        summary: `Entrega de Supervisión de ${handover.issuedBy.name} recibida por ${user.name}`,
        user,
        after: { receivedById: user.id, receivedAt },
      },
      tx,
    );
    return received;
  });
}

export async function createSupervisionNote(
  user: CurrentUser,
  input: {
    title: string;
    body: string;
    visibility: SupervisionVisibility;
    sourceEntity?: string | null;
    sourceId?: string | null;
  },
) {
  assertSupervisor(user);
  if (
    input.visibility !== SupervisionVisibility.PRIVADO &&
    !user.permissions.includes('supervision.note.share')
  ) {
    throw new RuleError('No tienes permiso para compartir notas.');
  }
  const shift = await getMyOpenSupervisionShift(user.id);
  const note = await prisma.supervisionNote.create({
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      visibility: input.visibility,
      authorId: user.id,
      supervisionShiftId: shift?.id ?? null,
      sourceEntity: input.sourceEntity ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.CREAR,
    summary: `Nota de Supervisión creada: ${note.title}`,
    user,
    after: { visibility: note.visibility, sourceEntity: note.sourceEntity, sourceId: note.sourceId },
  });
  return note;
}

export async function listVisibleSupervisionNotes(user: CurrentUser, take = 30) {
  if (!user.isSystemAdmin && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError('Las notas de Supervisión no forman parte del Libro operativo.');
  }
  return prisma.supervisionNote.findMany({
    where: {
      deletedAt: null,
      OR: [
        { visibility: SupervisionVisibility.PRIVADO, authorId: user.id },
        { visibility: SupervisionVisibility.SUPERVISION },
        { visibility: SupervisionVisibility.OPERATIVO },
      ],
    },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/** Acceso técnico excepcional: nunca se usa para alimentar listados. */
export async function readSupervisionNote(user: CurrentUser, noteId: string) {
  const note = await prisma.supervisionNote.findFirst({ where: { id: noteId, deletedAt: null } });
  if (!note) throw new NotFoundError('La nota no existe.');
  if (!user.isSystemAdmin && user.roleKey !== ROLE_KEYS.SUPERVISOR) {
    throw new RuleError('Las notas de Supervisión no forman parte del Libro operativo.');
  }
  if (note.visibility === SupervisionVisibility.PRIVADO && note.authorId !== user.id) {
    if (!user.isSystemAdmin) throw new RuleError('Esta nota es privada.');
    await recordAudit({
      entity: 'SupervisionNote',
      entityId: note.id,
      action: AuditAction.EDITAR,
      summary: 'Acceso técnico excepcional a una nota privada',
      user,
      reason: 'Consulta técnica auditada',
    });
  }
  return note;
}

export async function softDeleteSupervisionNote(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const note = await prisma.supervisionNote.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!note) throw new NotFoundError('La nota no existe o ya fue eliminada.');
  if (note.authorId !== user.id && !user.isSystemAdmin) {
    throw new RuleError('Sólo el autor puede eliminar esta nota.');
  }
  const deleted = await prisma.supervisionNote.update({
    where: { id: note.id },
    data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.ELIMINAR,
    summary: `Nota de Supervisión eliminada lógicamente: ${note.title}`,
    user,
    reason: input.reason,
  });
  return deleted;
}

export async function restoreSupervisionNote(user: CurrentUser, noteId: string) {
  if (!user.isSystemAdmin) throw new RuleError('Sólo el Administrador de sistema puede restaurar notas.');
  const note = await prisma.supervisionNote.findFirst({
    where: { id: noteId, deletedAt: { not: null } },
  });
  if (!note) throw new NotFoundError('La nota no está eliminada.');
  const restored = await prisma.supervisionNote.update({
    where: { id: note.id },
    data: { deletedAt: null, deletedById: null, deletionReason: null },
  });
  await recordAudit({
    entity: 'SupervisionNote',
    entityId: note.id,
    action: AuditAction.RESTAURAR,
    summary: `Nota de Supervisión restaurada: ${note.title}`,
    user,
  });
  return restored;
}

export async function getSupervisionCenterSummary(user: CurrentUser) {
  if (!user.permissions.includes('supervision.center.view')) {
    throw new RuleError('No tienes permiso para consultar el Centro de Supervisión.');
  }
  const currentShift = await getMyOpenSupervisionShift(user.id);
  const now = new Date();
  const noteWhere: Prisma.SupervisionNoteWhereInput = {
    deletedAt: null,
    OR: [
      { visibility: SupervisionVisibility.PRIVADO, authorId: user.id },
      { visibility: { in: [SupervisionVisibility.SUPERVISION, SupervisionVisibility.OPERATIVO] } },
    ],
  };
  const [tasks, followUps, notes, audits, measures, priorHandovers] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      include: { assignee: { select: { name: true } } },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 20,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDIENTE', 'VENCIDO'] },
        OR: [
          { visibility: SupervisionVisibility.SUPERVISION },
          { visibility: SupervisionVisibility.OPERATIVO },
          { visibility: SupervisionVisibility.PRIVADO, authorId: user.id },
        ],
      },
      include: { owner: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    }),
    prisma.supervisionNote.findMany({
      where: noteWhere,
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
    prisma.checklistRun.findMany({
      where: {
        deletedAt: null,
        status: { not: 'CERRADA' },
        ...(user.isSystemAdmin
          ? {}
          : {
              OR: [
                { status: { not: 'PREPARACION' } },
                { status: 'PREPARACION', runById: user.id },
              ],
            }),
      },
      include: { runBy: { select: { name: true } }, _count: { select: { findings: true } } },
      orderBy: { startedAt: 'asc' },
      take: 12,
    }),
    prisma.correctiveMeasure.findMany({
      where: { deletedAt: null, status: { notIn: ['VALIDADA', 'CANCELADA'] } },
      include: { assignee: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 12,
    }),
    prisma.supervisionShiftHandover.findMany({
      where: { issuedById: { not: user.id }, receivedAt: null },
      include: { issuedBy: { select: { name: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 5,
    }),
  ]);
  return {
    now,
    currentShift,
    tasks,
    followUps,
    notes,
    audits,
    measures,
    priorHandovers,
  };
}
