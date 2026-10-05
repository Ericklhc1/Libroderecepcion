import {lockOpenSubjectForWork} from './subject-completion';
import {assertTaskAssignable} from './task-assignment-access';
import {notifyUnassignedTask,notifyNativeWork,sourceStakeholders} from './work-notifications';
import { assertAuthorizedRevision } from '@/server/security/authorized-revision';
import 'server-only';
import {followUpReadWhere,taskFollowUpReadWhere,alertReadWhere} from './followup-access';
import {isSubjectAttentionTask} from '@/domain/subject-attention';
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
import { finishSupervisionTrackingForSource } from './followups';

export const taskInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  room: { select: { id: true, number: true, floor: true } },
  entry: { select: { id: true, humanId: true, title: true, type: true } },
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
  /** Internal notification channel override for staged inter-area workflow. */
  internalOnly?: boolean;
  /** Internal recurrence key; never accepted from a public form. */
  procedureOccurrenceKey?: string;
  requiresIndependentValidation?: boolean;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  priority: Prisma.TaskCreateInput['priority'];
  startsAt?: Date | null;
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

/** Do not notify somebody about work whose reserved source they cannot read. */
export async function assertTaskSourceRecipients(db: Prisma.TransactionClient, ids: Iterable<string>, source: {followUpId?:string|null;alertId?:string|null}, lockSources = false) {
  if (!source.followUpId && !source.alertId) return;
  if (lockSources) {
    const [followUps, alerts] = await Promise.all([
      source.followUpId ? db.followUpSourceFollowUp.findMany({where:{descendantId:source.followUpId},select:{followUpId:true}}) : [],
      source.alertId ? db.alertSourceFollowUp.findMany({where:{alertId:source.alertId},select:{followUpId:true}}) : [],
    ]);
    const origins = new Set([...followUps, ...alerts].map(row => row.followUpId));
    if (source.followUpId) origins.add(source.followUpId);
    for (const id of [...origins].sort()) await db.$queryRaw`SELECT "id" FROM "FollowUp" WHERE "id"=${id} FOR SHARE`;
  }
  const people=await db.user.findMany({where:{id:{in:[...ids]},active:true,deletedAt:null},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  for(const person of people){
    const reader: Pick<CurrentUser,'id'|'permissions'>={id:person.id,permissions:person.role.permissions.some(p=>p.permission.key==='supervision.followup.manage')?['supervision.followup.manage']:[]};
    if(source.followUpId && !await db.followUp.count({where:{id:source.followUpId,AND:[followUpReadWhere(reader,true)]}}) || source.alertId && !await db.alert.count({where:{id:source.alertId,AND:[alertReadWhere(reader)]}})){
      throw new RuleError('El responsable o colaborador no puede acceder al origen reservado. Selecciona una persona autorizada.');
    }
  }
}

/** Deduce el origen de la tarea a partir del registro que la motivó. */
function inferOrigin(input: TaskCreateInput): TaskOrigin {
  if (input.entryId) return TaskOrigin.REGISTRO;
  if (input.followUpId) return TaskOrigin.SEGUIMIENTO;
  if (input.alertId) return TaskOrigin.ALERTA;
  if (input.handoverId) return TaskOrigin.ENTREGA_TURNO;
  return TaskOrigin.MANUAL;
}

export async function createTask(user: CurrentUser, input: TaskCreateInput, client?: Prisma.TransactionClient) {
  const db = client ?? prisma;
  if (input.startsAt && input.dueAt && input.dueAt <= input.startsAt) {
    throw new RuleError('La fecha límite debe ser posterior al inicio programado.');
  }

  const targetType = input.targetType ?? TaskTargetType.PERSONA;
  const participantIds = new Set<string>(input.collaboratorIds ?? []);
  let assigneeId = input.assigneeId ?? null;

  if (targetType === TaskTargetType.PROPIO) assigneeId = user.id;
  if (targetType === TaskTargetType.EQUIPO) {
    const team = await db.user.findMany({
      where: { active: true, deletedAt: null, role: { operational: true } },
      select: { id: true },
    });
    for (const member of team) participantIds.add(member.id);
  }
  if (targetType === TaskTargetType.TURNO) {
    if (!input.targetShiftId) throw new RuleError('Selecciona el turno al que se asigna la tarea.');
    const assignments = await db.shiftAssignment.findMany({
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
  for (const participantId of participantIds) await assertTaskAssignable(participantId,db);
  if (!assigneeId && participantIds.size > 0) assigneeId = [...participantIds][0] ?? null;

  if (input.followUpId && !await db.followUp.findFirst({where:{id:input.followUpId,AND:[followUpReadWhere(user)]},select:{id:true}})) {
    throw new NotFoundError('El seguimiento de origen no existe.');
  }
  if (input.alertId && !await db.alert.findFirst({where:{id:input.alertId,deletedAt:null,AND:[alertReadWhere(user)]},select:{id:true}})) {
    throw new NotFoundError('La alerta de origen no existe.');
  }
  await assertTaskSourceRecipients(db,participantIds,input);
  const alertSource=input.alertId?await db.alert.findFirst({where:{id:input.alertId,deletedAt:null,AND:[alertReadWhere(user)]},select:{followUpId:true,task:{select:{followUpId:true}}}}):null;
  const inheritedFollowUpId=input.followUpId??alertSource?.followUpId??alertSource?.task?.followUpId??null;
  let origin = inferOrigin(input);
  let roomId = input.roomId ?? null;
  if (input.entryId) {
    const entry = await db.operationalEntry.findFirst({
      where: { id: input.entryId, deletedAt: null },
      select: { type: true, roomId: true },
    });
    if (!entry) throw new NotFoundError('El registro de origen no existe.');
    if (entry.type === 'INCIDENCIA') origin = TaskOrigin.INCIDENCIA;
    if (!roomId && entry.roomId) roomId = entry.roomId;
  }
  if (roomId) {
    const room = await db.room.findFirst({
      where: { id: roomId, active: true },
      select: { id: true },
    });
    if (!room) throw new RuleError('La habitación seleccionada no existe en el catálogo operativo.');
  }

  const shift = await getMyOpenShift(user.id);
  const supervisionShift = await db.supervisionShift.findFirst({
    where: { supervisorId: user.id, status: 'ACTIVO' },
    select: { id: true },
  });

  const write = async (tx: Prisma.TransactionClient) => {
    if(input.entryId){
      await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.entryId} FOR UPDATE`;
      if(!await tx.operationalEntry.count({where:{id:input.entryId,deletedAt:null,status:{notIn:['RESUELTO','CERRADO']}}}))throw new RuleError('Reabre el asunto antes de solicitar trabajo nuevo.');
    }
    for(const id of participantIds)await assertTaskAssignable(id,tx);
    await assertTaskSourceRecipients(tx,new Set([user.id,...participantIds]),input,true);
    if (input.procedureOccurrenceKey) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.procedureOccurrenceKey}))::text`;
      const existing = await tx.task.findUnique({ where: { procedureOccurrenceKey: input.procedureOccurrenceKey }, include: taskInclude });
      if (existing) return existing;
    }
    const created = await tx.task.create({
      data: {
        title: input.title,
        procedureOccurrenceKey: input.procedureOccurrenceKey,
        requiresIndependentValidation: input.requiresIndependentValidation ?? false,
        description: input.description ?? null,
        assigneeId,
        workAssignedAt: assigneeId ? new Date() : null,
        priority: input.priority,
        startsAt: input.startsAt ?? null,
        dueAt: input.dueAt ?? null,
        departmentId: input.departmentId ?? null,
        entryId: input.entryId ?? null,
        followUpId: inheritedFollowUpId,
        alertId: input.alertId ?? null,
        handoverId: input.handoverId ?? null,
        fulfillmentCriteria: input.fulfillmentCriteria ?? null,
        evidenceRequired: input.evidenceRequired ?? null,
        evidenceProvided: input.evidenceProvided ?? null,
        targetType,
        targetShiftId: input.targetShiftId ?? null,
        supervisionShiftId: supervisionShift?.id ?? null,
        roomId,
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
        summary: `Tarea #${created.humanId}: ${created.title}`,
        user,
        after: {
          title: created.title,
          assigneeId: created.assigneeId,
          priority: created.priority,
          startsAt: created.startsAt,
          dueAt: created.dueAt,
          origin: created.origin,
          targetType: created.targetType,
          roomId: created.roomId,
          roomNumber: created.room?.number ?? null,
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
          internalOnly:input.internalOnly,
          userId,
          type: NotificationType.TAREA_ASIGNADA,
          title: `Nueva tarea asignada: ${created.title}`,
          body: [
            created.startsAt ? `Comienza el ${formatDateTime(created.startsAt)}.` : 'Disponible de inmediato.',
            created.dueAt ? `Vence el ${formatDateTime(created.dueAt)}.` : 'Sin fecha límite.',
          ].join(' '),
          link: `/tareas/${created.id}`,
          entity: 'Task',
          entityId: created.id,
        })),
        tx,
      );
    }

    await notifyUnassignedTask(tx,created,user.id);
    return created;
  };
  return client ? write(client) : prisma.$transaction(write);
}

export async function getTask(id: string, user: CurrentUser): Promise<TaskWithRelations> {
  const task = await prisma.task.findFirst({ where: { id, AND:[taskFollowUpReadWhere(user)] }, include: {...taskInclude,_count:{select:{followUps:{where:followUpReadWhere(user)},comments:{where:{OR:[{followUpId:null},{followUp:followUpReadWhere(user)}]}}}}} });
  if (!task) throw new NotFoundError('La tarea no existe.');
  return task;
}

const TASK_EDITABLE = [
  'title',
  'description',
  'priority',
  'startsAt',
  'dueAt',
  'departmentId',
  'roomId',
  'tags',
  'blockedReason',
  'fulfillmentCriteria',
  'evidenceRequired',
  'evidenceProvided',
] as const;

export async function updateTask(
  user: CurrentUser,
  input: { id: string } & Partial<TaskCreateInput> & { blockedReason?: string | null },
  expectedRevision?: string,
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null,AND:[taskFollowUpReadWhere(user)] } });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,assigneeId:current.assigneeId,dueAt:current.dueAt});

  const nextStartsAt = 'startsAt' in input ? input.startsAt ?? null : current.startsAt;
  const nextDueAt = 'dueAt' in input ? input.dueAt ?? null : current.dueAt;
  if (nextStartsAt && nextDueAt && nextDueAt <= nextStartsAt) {
    throw new RuleError('La fecha límite debe ser posterior al inicio programado.');
  }

  if (input.roomId) {
    const room = await prisma.room.findFirst({
      where: { id: input.roomId, active: true },
      select: { id: true },
    });
    if (!room) throw new RuleError('La habitación seleccionada no existe en el catálogo operativo.');
  }

  if (
    current.status === TaskStatus.VALIDADA ||
    current.status === TaskStatus.COMPLETADA ||
    current.status === TaskStatus.CANCELADA
  ) {
    throw new RuleError(
      `La tarea está ${TASK_STATUS_LABEL[current.status].toLowerCase()} y no admite edición.`,
    );
  }

  if (isSubjectAttentionTask(current.procedureOccurrenceKey) && current.status === TaskStatus.REALIZADA && 'evidenceProvided' in input && !input.evidenceProvided?.trim()) throw new RuleError('Conserva el resultado de la atención antes de validar.');

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
      where: { id: input.id, updatedAt: current.updatedAt,AND:[taskFollowUpReadWhere(user)] },
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
        summary: `Tarea #${updated.humanId} actualizada (${changes.changed.join(', ')})`,
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
  expectedRevision?: string,
) {
  const current = await prisma.task.findFirst({
    where: { id: input.id, deletedAt: null, AND:[taskFollowUpReadWhere(user)] },
    include: { assignee: { select: { name: true } } },
  });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,assigneeId:current.assigneeId,dueAt:current.dueAt});
  if (input.assigneeId) {await assertTaskAssignable(input.assigneeId);await assertTaskSourceRecipients(prisma,[input.assigneeId],current);}
  if ((current.assigneeId ?? null) === (input.assigneeId ?? null)) return current;

  return prisma.$transaction(async (tx) => {
    if(input.assigneeId)await assertTaskAssignable(input.assigneeId,tx);
    await assertTaskSourceRecipients(tx,[user.id,...(input.assigneeId?[input.assigneeId]:[])],current,true);
    const updated = await tx.task.update({
      where: { id: input.id, updatedAt: current.updatedAt,AND:[taskFollowUpReadWhere(user)] },
      data: { assigneeId: input.assigneeId ?? null, workAssignedAt: input.assigneeId ? new Date() : null, workAcknowledgedAt: null, workAcknowledgedById: null, workStartedAt: null, workEscalatedAt: null, workRequestKey: null },
      include: taskInclude,
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: updated.id,
        action: AuditAction.CAMBIO_RESPONSABLE,
        summary: `Tarea #${updated.humanId} reasignada a ${updated.assignee?.name ?? 'sin asignar'}`,
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

    const internalOnly=!!await tx.subjectAreaAttention.count({where:{taskId:updated.id}});
    const targets = new Set<string>();
    if (updated.assigneeId) targets.add(updated.assigneeId);
    if (current.assigneeId) targets.add(current.assigneeId);
    targets.delete(user.id);
    await notify(
      Array.from(targets).map((userId) => ({
        internalOnly,
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
  ACEPTADA: [TaskStatus.COMPLETADA, TaskStatus.EN_CURSO, TaskStatus.BLOQUEADA, TaskStatus.REALIZADA, TaskStatus.CANCELADA],
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
  expectedRevision?: string,
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null,AND:[taskFollowUpReadWhere(user)] } });
  if (!current) throw new NotFoundError('La tarea no existe o fue eliminada.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,assigneeId:current.assigneeId,dueAt:current.dueAt});
  if (input.status === TaskStatus.ACEPTADA && current.assigneeId !== user.id) throw new RuleError('La recepción corresponde al responsable asignado.');
  if (current.status === input.status) return current;

  const startsInFuture = Boolean(current.startsAt && current.startsAt > new Date());
  const startsWork =
    input.status === TaskStatus.ACEPTADA ||
    input.status === TaskStatus.EN_CURSO ||
    input.status === TaskStatus.REALIZADA ||
    input.status === TaskStatus.COMPLETADA ||
    input.status === TaskStatus.VALIDADA;
  if (startsInFuture && startsWork) {
    throw new RuleError(
      `Esta tarea está programada para comenzar el ${formatDateTime(current.startsAt!)}. Si debe empezar antes, edita su inicio programado.`,
    );
  }

  if (input.status === TaskStatus.EN_CURSO && !current.assigneeId) {
    throw new RuleError('Asigna una persona responsable antes de comenzar la atención.');
  }

  if (!(TASK_TRANSITIONS[current.status] ?? []).includes(input.status)) {
    throw new RuleError(
      `No puedes pasar una tarea de ${TASK_STATUS_LABEL[current.status]} a ${TASK_STATUS_LABEL[input.status]}.`,
    );
  }
  if (input.status === TaskStatus.BLOQUEADA && !input.blockedReason) {
    throw new RuleError('Indica por qué la tarea queda bloqueada.');
  }
  if (isSubjectAttentionTask(current.procedureOccurrenceKey) && input.status === TaskStatus.VALIDADA && !(input.evidenceProvided === undefined ? current.evidenceProvided : input.evidenceProvided)?.trim()) throw new RuleError('La validación requiere el resultado de la atención.');
  if(isSubjectAttentionTask(current.procedureOccurrenceKey)&&['REALIZADA','COMPLETADA'].includes(input.status)&&!input.evidenceProvided?.trim())throw new RuleError('Describe el resultado para devolverlo al asunto de origen.');
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
  if (current.requiresIndependentValidation) {
    if (input.status === TaskStatus.COMPLETADA) throw new RuleError('Este procedimiento requiere ejecución y validación independientes. Registra REALIZADA primero.');
    if (validation && (!current.completedById || current.completedById === user.id)) throw new RuleError('La validación requiere otra persona autorizada distinta de quien ejecutó.');
  }
  const closing =
    input.status === TaskStatus.VALIDADA ||
    input.status === TaskStatus.COMPLETADA ||
    input.status === TaskStatus.CANCELADA;
  if (!validation && closing && !user.permissions.includes('task.close')) {
    throw new RuleError('No tienes permiso para completar o cancelar tareas.');
  }

  return prisma.$transaction(async (tx) => {
    if(current.entryId){
      await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${current.entryId} FOR UPDATE`;
      if(!['VALIDADA','COMPLETADA','CANCELADA'].includes(input.status)&&!await tx.operationalEntry.count({where:{id:current.entryId,deletedAt:null,status:{notIn:['RESUELTO','CERRADO']}}}))throw new RuleError('Reabre el asunto antes de reactivar su trabajo.');
    }
    const now = new Date();
    const updated = await tx.task.update({
      where: { id: input.id, updatedAt: current.updatedAt, assigneeId: current.assigneeId, status: current.status, AND:[taskFollowUpReadWhere(user)] },
      data: {
        status: input.status,
        ...(['ACEPTADA','EN_CURSO'].includes(input.status) && current.assigneeId === user.id ? { workAcknowledgedAt: current.workAcknowledgedAt ?? now, workAcknowledgedById: user.id } : {}),
        ...(input.status === 'EN_CURSO' ? { workStartedAt: current.workStartedAt ?? now } : {}),
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
        summary: `Tarea #${updated.humanId}: ${TASK_STATUS_LABEL[current.status]} → ${TASK_STATUS_LABEL[input.status]}`,
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

    const originalTargets=[current.createdById,current.assigneeId];
    const fromDistribution=!!await tx.subjectAreaAttention.count({where:{taskId:updated.id}});
    await notifyNativeWork(tx,{kind:'task',id:updated.id,actorId:user.id,ids:originalTargets,internalOnly:fromDistribution,title:`Tarea ${TASK_STATUS_LABEL[input.status].toLowerCase()}: ${updated.title}`,body:`Actualizada por ${user.name}.`});
    await notifyNativeWork(tx,{kind:'task',id:updated.id,actorId:user.id,ids:(await sourceStakeholders(tx,current.entryId)).filter(id=>!originalTargets.includes(id)),title:`Tarea ${TASK_STATUS_LABEL[input.status].toLowerCase()}: ${updated.title}`,body:'Revisa el resultado en el asunto de origen.'});

    return updated;
  });
}

export async function toggleChecklistItem(
  user: CurrentUser,
  input: { itemId: string; done: boolean },
) {
  const item = await prisma.taskChecklistItem.findFirst({
    where: { id: input.itemId,task:{deletedAt:null,AND:[taskFollowUpReadWhere(user)]} },
    include: {
      task: {
        select: { id: true, humanId: true, deletedAt: true, startsAt: true },
      },
    },
  });
  if (!item || item.task.deletedAt) throw new NotFoundError('El ítem no existe.');
  if (item.task.startsAt && item.task.startsAt > new Date()) {
    throw new RuleError(
      `Esta tarea está programada para comenzar el ${formatDateTime(item.task.startsAt)}.`,
    );
  }

  return prisma.$transaction(async tx=>{
  const updated = await tx.taskChecklistItem.update({
    where: { id: input.itemId,task:{deletedAt:null,AND:[taskFollowUpReadWhere(user)]} },
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
    summary: `Checklist de la tarea #${item.task.humanId}: "${item.text}" ${input.done ? 'marcado' : 'desmarcado'}`,
    user,
    before: { done: item.done },
    after: { done: input.done },
  },tx);
  return updated;
  });
}

export async function softDeleteTask(
  user: CurrentUser,
  input: { id: string; reason: string },
  expectedRevision?: string,
) {
  const current = await prisma.task.findFirst({ where: { id: input.id, deletedAt: null, AND:[taskFollowUpReadWhere(user)] } });
  if (!current) throw new NotFoundError('La tarea no existe o ya fue eliminada.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,assigneeId:current.assigneeId,dueAt:current.dueAt});
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.task.update({
      where: { id: input.id, updatedAt: current.updatedAt,AND:[taskFollowUpReadWhere(user)] },
      data: { deletedAt: new Date(), deletedById: user.id, deletionReason: input.reason },
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica de la tarea #${current.humanId}: ${current.title}`,
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
  expectedRevision?: string,
) {
  const current = await prisma.task.findFirst({
    where: { id: input.id, NOT: { deletedAt: null }, AND:[taskFollowUpReadWhere(user)] },
  });
  if (!current) throw new NotFoundError('La tarea no está eliminada.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,assigneeId:current.assigneeId,dueAt:current.dueAt});
  return prisma.$transaction(async (tx) => {
    if(!['VALIDADA','COMPLETADA','CANCELADA'].includes(current.status))await lockOpenSubjectForWork(tx,current);
    const restored = await tx.task.update({
      where: { id: input.id, updatedAt: current.updatedAt,AND:[taskFollowUpReadWhere(user)] },
      data: { deletedAt: null, deletedById: null, deletionReason: null },
    });
    await recordAudit(
      {
        entity: 'Task',
        entityId: input.id,
        action: AuditAction.RESTAURAR,
        summary: `Tarea #${current.humanId} restaurada`,
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
export async function listMyTasks(user: CurrentUser, take = 20) {
  return prisma.task.findMany({
    where: { deletedAt: null, assigneeId: user.id, status: { in: TASK_OPEN_STATUSES }, AND:[taskFollowUpReadWhere(user)] },
    include: taskInclude,
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    take,
  });
}
