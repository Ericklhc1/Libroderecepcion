import 'server-only';
import {
  AuditAction,
  NotificationType,
  TaskOrigin,
  TaskParticipantRole,
  TaskStatus,
  TaskTargetType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formatDateTime } from '@/lib/format';
import { NotFoundError, RuleError } from '@/server/errors';
import { diffFields, recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import { TASK_OPEN_STATUSES, TASK_STATUS_LABEL } from '@/domain/labels';
import { normalizeTags } from '@/domain/tags';
import { getMyOpenShift } from './shifts';
import { assertAssignable } from './users';
import { finishSupervisionTrackingForSource } from './followups';

export const taskInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  entry: { select: { id: true, seq: true, title: true, type: true } },
  followUp: { select: { id: true, action: true } },
  sourceAlert: { select: { id: true, title: true, type: true } },
  participants: {
    where: { removedAt: null },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { assignedAt: 'asc' },
  },
  checklist: { orderBy: { order: 'asc' } },
  _count: { select: { comments: true, followUps: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export type TaskCreateInput = {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  priority: Prisma.TaskCreateInput['priority'];
  dueAt?: Date | null;
  departmentId?: string | null;
  entryId?: string | null;
  followUpId?: string | null;
  alertId?: string | null;
  handoverId?: string | null;
  fulfillmentCriteria?: string | null;
  evidenceRequired?: string | null;
  evidenceProvided?: string | null;
  targetType?: TaskTargetType;
  collaboratorIds?: string[];
  targetShiftId?: string | null;
  roomId?: string | null;
  guestId?: string | null;
  reservationId?: string | null;
  stayId?: string | null;
  tags: string[];
  checklist: string[];
};

/** Deduce el origen de la tarea a partir del registro que la motivó. */
function inferOrigin(input: TaskCreateInput): TaskOrigin {
  if (input.entryId) return TaskOrigin.REGISTRO;
  if (input.followUpId) return TaskOrigin.SEGUIMIENTO;
  if (input.alertId) return TaskOrigin.ALERTA;
  if (input.handoverId) return TaskOrigin.ENTREGA_TURNO;
  return TaskOrigin.MANUAL;
}

export async function createTask(user: CurrentUser, input: TaskCreateInput) {
  const targetType = input.targetType ?? TaskTargetType.PERSONA;
  const participantIds = new Set<string>(input.collaboratorIds ?? []);
  let assigneeId = input.assigneeId ?? null;

  if (targetType === TaskTargetType.PROPIO) assigneeId = user.id;
  if (targetType === TaskTargetType.EQUIPO) {
    const team = await prisma.user.findMany({
      where: { active: true, deletedAt: null, role: { operational: true } },
      select: { id: true },
    });
    for (const member of team) participantIds.add(member.id);
  }
  if (targetType === TaskTargetType.TURNO) {
    if (!input.targetShiftId) throw new RuleError('Selecciona el turno al que se asigna la tarea.');
    const assignments = await prisma.shiftAssignment.findMany({
      where: { shiftId: input.targetShiftId, leftAt: null },
      select: { userId: true },
    });
    if (assignments.length === 0) throw new RuleError('Ese turno no tiene participantes activos.');
    for (const assignment of assignments) participantIds.add(assignment.userId);
  }
  if (assigneeId) participantIds.add(assigneeId);
  if (targetType === TaskTargetType.MULTIPLES && participantIds.size < 2) {
    throw new RuleError('Una tarea para varias personas requiere al menos dos participantes.');
  }
  for (const participantId of participantIds) await assertAssignable(participantId);
  if (!assigneeId && participantIds.size > 0) assigneeId = [...participantIds][0] ?? null;

  let origin = inferOrigin(input);
  if (input.entryId) {
    const entry = await prisma.operationalEntry.findFirst({
      where: { id: input.entryId, deletedAt: null },
      select: { type: true },
    });
    if (!entry) throw new NotFoundError('El registro de origen no existe.');
    if (entry.type === 'INCIDENCIA') origin = TaskOrigin.INCIDENCIA;
  }

  const shift = await getMyOpenShift(user.id);
  const supervisionShift = await prisma.supervisionShift.findFirst({
    where: { supervisorId: user.id, status: 'ACTIVO' },
    select: { id: true },
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        assigneeId,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        departmentId: input.departmentId ?? null,
        entryId: input.entryId ?? null,
        followUpId: input.followUpId ?? null,
        alertId: input.alertId ?? null,
        handoverId: input.handoverId ?? null,
        fulfillmentCriteria: input.fulfillmentCriteria ?? null,
        evidenceRequired: input.evidenceRequired ?? null,
        evidenceProvided: input.evidenceProvided ?? null,
        targetType,
        targetShiftId: input.targetShiftId ?? null,
        supervisionShiftId: supervisionShift?.id ?? null,
        roomId: input.roomId ?? null,
        guestId: input.guestId ?? null,
        reservationId: input.reservationId ?? null,
        stayId: input.stayId ?? null,
        shiftId: shift?.id ?? null,
        tags: normalizeTags(input.tags),
        origin,
        createdById: user.id,
        participants:
          participantIds.size > 0
            ? {
                create: [...participantIds].map((participantId) => ({
                  userId: participantId,
                  assignedById: user.id,
                  role:
                    participantId === assigneeId
                      ? TaskParticipantRole.PRINCIPAL
                      : TaskParticipantRole.COLABORADOR,
                })),
              }
            : undefined,
        checklist:
          input.checklist.length > 0
            ? {
                create: input.checklist.map((text, index) => ({ text, order: index })),
              }
            : undefined,
      },
      include: taskInclude,
    });

    await recordAudit(
      {
        entity: 'Task',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `Tarea #${created.seq}: ${created.title}`,
        user,
        after: {
          title: created.title,
          assigneeId: created.assigneeId,
          priority: created.priority,
          dueAt: created.dueAt,
          origin: created.origin,
          targetType: created.targetType,
          participantIds: created.participants.map((participant) => participant.userId),
        },
      },
      tx,
    );

    const recipients = created.participants
      .map((participant) => participant.userId)
      .filter((participantId) => participantId !== user.id);
    if (recipients.length > 0) {
      await notify(
        recipients.map((userId) => ({
          userId,
          type: NotificationType.TAREA_ASIGNADA,
          title: `Nueva tarea asignada: ${created.title}`,
          body: created.dueAt
            ? `Vence el ${formatDateTime(created.dueAt)}.`
            : 'Sin fecha límite.',
          link: `/tareas/${created.id}`,
          entity: 'Task',
          entityId: created.id,
        })),
        tx,
      );
    }

    return created;
  });
}

export async function getTask(id: string): Promise<TaskWithRelations> {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw new NotFoundError('La tarea no existe.');
  return task;
}

const TASK_EDITABLE = [
  'title',
  'description',
  'priority',
  'dueAt',
  'departmentId',
  'tags',
  'blockedReason',
  'fulfillmentCriteria',
  'evidenceRequired',
  'evidenceProvided',
] as const;

export async function updateTask(
  user: CurrentUser,
  input: { id: string } & Partial<TaskCreateInput> & { blockedReason?: string | null },
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  if (
    current.status === TaskStatus.VALIDADA ||
    current.status === TaskStatus.COMPLETADA ||
    current.status === TaskStatus.CANCELADA
  ) {
    throw new RuleError(
      `La tarea está ${TASK_STATUS_LABEL[current.status].toLowerCase()} y no admite edición.`,
    );
  }

  const data: Prisma.TaskUpdateInput = {};
  const after: Record<string, unknown> = {};
  for (const field of TASK_EDITABLE) {
    if (!(field in input)) continue;
    const raw = (input as Record<string, unknown>)[field];
    if (raw === undefined) continue;
    const value = field === 'tags' ? normalizeTags(raw as string[]) : raw;
    (data as Record<string, unknown>)[field] = value;
    after[field] = value;
  }
  if (Object.keys(data).length === 0) return current;

  const changes = diffFields(
    current as unknown as Record<string, unknown>,
    after,
    Object.keys(after),
  );
  if (changes.changed.length === 0) return current;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: input.id },
      data,
      include: taskInclude,
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: updated.id,
        action: changes.changed.includes('priority')
          ? AuditAction.CAMBIO_PRIORIDAD
          : AuditAction.EDITAR,
        summary: `Tarea #${updated.seq} actualizada (${changes.changed.join(', ')})`,
        user,
        before: changes.before,
        after: changes.after,
      },
      tx,
    );
    return updated;
  });
}

export async function assignTask(
  user: CurrentUser,
  input: { id: string; assigneeId?: string | null; reason?: string | null },
) {
  const current = await prisma.task.findFirst({
    where: { id: input.id, deletedAt: null },
    include: { assignee: { select: { name: true } } },
  });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  if (input.assigneeId) await assertAssignable(input.assigneeId);
  if ((current.assigneeId ?? null) === (input.assigneeId ?? null)) return current;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: input.id },
      data: { assigneeId: input.assigneeId ?? null },
      include: taskInclude,
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: updated.id,
        action: AuditAction.CAMBIO_RESPONSABLE,
        summary: `Tarea #${updated.seq} reasignada a ${updated.assignee?.name ?? 'sin asignar'}`,
        user,
        before: { assigneeId: current.assigneeId, assignee: current.assignee?.name ?? null },
        after: { assigneeId: updated.assigneeId, assignee: updated.assignee?.name ?? null },
        reason: input.reason ?? null,
      },
      tx,
    );

    await tx.taskAssignment.updateMany({
      where: { taskId: input.id, role: TaskParticipantRole.PRINCIPAL, removedAt: null },
      data: { removedAt: new Date(), removalReason: input.reason ?? 'Reasignación' },
    });
    if (input.assigneeId) {
      await tx.taskAssignment.upsert({
        where: { taskId_userId: { taskId: input.id, userId: input.assigneeId } },
        create: {
          taskId: input.id,
          userId: input.assigneeId,
          role: TaskParticipantRole.PRINCIPAL,
          assignedById: user.id,
        },
        update: {
          role: TaskParticipantRole.PRINCIPAL,
          assignedById: user.id,
          assignedAt: new Date(),
          removedAt: null,
          removalReason: null,
        },
      });
    }

    const targets = new Set<string>();
    if (updated.assigneeId) targets.add(updated.assigneeId);
    if (current.assigneeId) targets.add(current.assigneeId);
    targets.delete(user.id);
    await notify(
      Array.from(targets).map((userId) => ({
        userId,
        type:
          userId === updated.assigneeId
            ? NotificationType.TAREA_ASIGNADA
            : NotificationType.RESPONSABLE_CAMBIADO,
        title:
          userId === updated.assigneeId
            ? `Te asignaron la tarea: ${updated.title}`
            : `Ya no eres responsable de: ${updated.title}`,
        body: `Cambio realizado por ${user.name}.`,
        link: `/tareas/${updated.id}`,
        entity: 'Task',
        entityId: updated.id,
      })),
      tx,
    );

    return updated;
  });
}

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDIENTE: [TaskStatus.ACEPTADA, TaskStatus.EN_CURSO, TaskStatus.BLOQUEADA, TaskStatus.REALIZADA, TaskStatus.COMPLETADA, TaskStatus.CANCELADA],
  ACEPTADA: [TaskStatus.EN_CURSO, TaskStatus.BLOQUEADA, TaskStatus.REALIZADA, TaskStatus.CANCELADA],
  EN_CURSO: [TaskStatus.BLOQUEADA, TaskStatus.REALIZADA, TaskStatus.COMPLETADA, TaskStatus.CANCELADA, TaskStatus.PENDIENTE],
  BLOQUEADA: [TaskStatus.EN_CURSO, TaskStatus.PENDIENTE, TaskStatus.CANCELADA, TaskStatus.REALIZADA],
  REALIZADA: [TaskStatus.VALIDADA, TaskStatus.DEVUELTA, TaskStatus.EN_CURSO],
  DEVUELTA: [TaskStatus.EN_CURSO, TaskStatus.BLOQUEADA, TaskStatus.REALIZADA, TaskStatus.CANCELADA],
  VALIDADA: [TaskStatus.DEVUELTA],
  COMPLETADA: [TaskStatus.EN_CURSO],
  CANCELADA: [TaskStatus.PENDIENTE],
};

export async function changeTaskStatus(
  user: CurrentUser,
  input: {
    id: string;
    status: TaskStatus;
    blockedReason?: string | null;
    reason?: string | null;
    evidenceProvided?: string | null;
  },
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  if (current.status === input.status) return current;

  if (!(TASK_TRANSITIONS[current.status] ?? []).includes(input.status)) {
    throw new RuleError(
      `No puedes pasar una tarea de ${TASK_STATUS_LABEL[current.status]} a ${TASK_STATUS_LABEL[input.status]}.`,
    );
  }
  if (input.status === TaskStatus.BLOQUEADA && !input.blockedReason) {
    throw new RuleError('Indica por qué la tarea queda bloqueada.');
  }
  if (
    input.status === TaskStatus.REALIZADA &&
    current.evidenceRequired &&
    !(input.evidenceProvided?.trim() || current.evidenceProvided)
  ) {
    throw new RuleError('Adjunta o describe la evidencia requerida antes de marcar la tarea como realizada.');
  }
  if (input.status === TaskStatus.DEVUELTA && !input.reason?.trim()) {
    throw new RuleError('Indica el motivo de la devolución.');
  }
  const validation = input.status === TaskStatus.VALIDADA || input.status === TaskStatus.DEVUELTA;
  if (validation && !user.permissions.includes('supervision.task.validate')) {
    throw new RuleError('No tienes permiso para validar o devolver tareas.');
  }
  const closing =
    input.status === TaskStatus.VALIDADA ||
    input.status === TaskStatus.COMPLETADA ||
    input.status === TaskStatus.CANCELADA;
  if (!validation && closing && !user.permissions.includes('task.close')) {
    throw new RuleError('No tienes permiso para completar o cancelar tareas.');
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const updated = await tx.task.update({
      where: { id: input.id },
      data: {
        status: input.status,
        blockedReason:
          input.status === TaskStatus.BLOQUEADA ? (input.blockedReason ?? null) : null,
        returnReason: input.status === TaskStatus.DEVUELTA ? input.reason ?? null : null,
        cancellationReason: input.status === TaskStatus.CANCELADA ? input.reason ?? null : null,
        evidenceProvided: input.evidenceProvided?.trim() || current.evidenceProvided,
        completedAt:
          input.status === TaskStatus.REALIZADA || input.status === TaskStatus.COMPLETADA
            ? now
            : current.completedAt,
        completedById:
          input.status === TaskStatus.REALIZADA || input.status === TaskStatus.COMPLETADA
            ? user.id
            : current.completedById,
        validatedAt: input.status === TaskStatus.VALIDADA ? now : null,
        validatedById: input.status === TaskStatus.VALIDADA ? user.id : null,
      },
      include: taskInclude,
    });

    await recordAudit(
      {
        entity: 'Task',
        entityId: updated.id,
        action: closing ? AuditAction.CERRAR : AuditAction.CAMBIO_ESTADO,
        summary: `Tarea #${updated.seq}: ${TASK_STATUS_LABEL[current.status]} → ${TASK_STATUS_LABEL[input.status]}`,
        user,
        before: { status: current.status },
        after: { status: input.status },
        reason: input.reason ?? input.blockedReason ?? null,
      },
      tx,
    );

    if (closing) {
      await finishSupervisionTrackingForSource(
        tx,
        user,
        'Task',
        current.id,
        'RESUELTO',
      );
    }

    const targets = new Set<string>([current.createdById]);
    if (current.assigneeId) targets.add(current.assigneeId);
    targets.delete(user.id);
    await notify(
      Array.from(targets).map((userId) => ({
        userId,
        type: NotificationType.ACCION_REQUERIDA,
        title: `Tarea ${TASK_STATUS_LABEL[input.status].toLowerCase()}: ${updated.title}`,
        body: `Actualizada por ${user.name}.`,
        link: `/tareas/${updated.id}`,
        entity: 'Task',
        entityId: updated.id,
      })),
      tx,
    );

    return updated;
  });
}

export async function toggleChecklistItem(
  user: CurrentUser,
  input: { itemId: string; done: boolean },
) {
  const item = await prisma.taskChecklistItem.findUnique({
    where: { id: input.itemId },
    include: { task: { select: { id: true, seq: true, deletedAt: true } } },
  });
  if (!item || item.task.deletedAt) throw new NotFoundError('El ítem no existe.');

  const updated = await prisma.taskChecklistItem.update({
    where: { id: input.itemId },
    data: {
      done: input.done,
      doneAt: input.done ? new Date() : null,
      doneById: input.done ? user.id : null,
    },
  });
  await recordAudit({
    entity: 'Task',
    entityId: item.task.id,
    action: AuditAction.EDITAR,
    summary: `Checklist de la tarea #${item.task.seq}: "${item.text}" ${input.done ? 'marcado' : 'desmarcado'}`,
    user,
    before: { done: item.done },
    after: { done: input.done },
  });
  return updated;
}

export async function softDeleteTask(
  user: CurrentUser,
  input: { id: string; reason: string },
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!current) throw new NotFoundError('La tarea no existe o ya fue eliminada.');
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.task.update({
      where: { id: input.id },
      data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica de la tarea #${current.seq}: ${current.title}`,
        user,
        after: { deletedAt: deleted.deletedAt },
        reason: input.reason,
      },
      tx,
    );
    await finishSupervisionTrackingForSource(
      tx,
      user,
      'Task',
      input.id,
      'CANCELADO',
    );
    return deleted;
  });
}

export async function restoreTask(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
) {
  const current = await prisma.task.findFirst({
    where: { id: input.id, NOT: { deletedAt: null } },
  });
  if (!current) throw new NotFoundError('La tarea no está eliminada.');
  return prisma.$transaction(async (tx) => {
    const restored = await tx.task.update({
      where: { id: input.id },
      data: { deletedAt: null, deletedById: null, deletionReason: null },
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: input.id,
        action: AuditAction.RESTAURAR,
        summary: `Tarea #${current.seq} restaurada`,
        user,
        before: { deletedAt: current.deletedAt },
        after: { deletedAt: null },
        reason: input.reason ?? null,
      },
      tx,
    );
    return restored;
  });
}

/** Tareas abiertas asignadas al usuario, ordenadas por urgencia real. */
export async function listMyTasks(userId: string, take = 20) {
  return prisma.task.findMany({
    where: { deletedAt: null, assigneeId: userId, status: { in: TASK_OPEN_STATUSES } },
    include: taskInclude,
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    take,
  });
}
