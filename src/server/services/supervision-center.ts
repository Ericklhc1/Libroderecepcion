import 'server-only';
import { Prisma } from '@prisma/client';
import type { Priority, SupervisionVisibility, InspectionResult, Severity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, RuleError, NotFoundError } from '@/server/errors';
import { assertAssignable } from './users';
import { getSupervisionData } from './supervision';

type Tx = Prisma.TransactionClient;
function permit(user: CurrentUser, permission: PermissionKey, operational = false) {
  if (!user.permissions.includes(permission) || (operational && (!user.roleOperational || user.isSystemAdmin))) {
    throw new ForbiddenError('No tienes autorización para esta actuación de Supervisión.');
  }
}
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
// Auditoría obligatoria: si falla, revierte la misma transacción. Nunca registra texto privado.
async function audit(tx: Tx, user: CurrentUser, entity: string, entityId: string, action: 'CREAR' | 'EDITAR' | 'CERRAR' | 'ELIMINAR' | 'RESTAURAR', before: unknown, after: unknown, reason?: string) {
  await tx.auditLog.create({ data: { userId: user.id, entity, entityId, action,
    summary: `Centro de Supervisión: ${action.toLowerCase()}`, before: json(before), after: json(after), reason,
    sessionId: user.sessionId } });
}

export async function startSupervisionShift(user: CurrentUser, priorities: string) {
  permit(user, 'supervision.shift', true);
  if (!priorities.trim()) throw new RuleError('Establece las prioridades del turno.');
  try {
    return await prisma.$transaction(async tx => {
      const shift = await tx.supervisionShift.create({ data: { supervisorId: user.id, priorities: priorities.trim() } });
      await audit(tx, user, 'SupervisionShift', shift.id, 'CREAR', {}, { status: shift.status, startedAt: shift.startedAt });
      return shift;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new RuleError('Ya tienes un turno de Supervisión abierto.');
    throw error;
  }
}

export async function handoverSupervisionShift(user: CurrentUser, shiftId: string, note: string) {
  permit(user, 'supervision.shift', true);
  if (!note.trim()) throw new RuleError('Escribe la nota de entrega.');
  return prisma.$transaction(async tx => {
    const shift = await tx.supervisionShift.findFirst({ where: { id: shiftId, supervisorId: user.id, status: 'ACTIVO' } });
    if (!shift) throw new RuleError('El turno no está activo o no te pertenece.');
    const [tasks, notes, inspections, decisions] = await Promise.all([
      tx.task.findMany({ where: { deletedAt: null, OR: [{ createdById: user.id }, { assigneeId: user.id }] }, select: { id: true, title: true, status: true, dueAt: true, assigneeId: true } }),
      tx.supervisionNote.findMany({ where: { deletedAt: null, visibility: 'SUPERVISION', resolution: null }, select: { id: true, title: true, body: true, nextReviewAt: true, priority: true } }),
      tx.inspection.findMany({ where: { deletedAt: null, visibility: 'SUPERVISION', closedAt: null }, select: { id: true, title: true, startedAt: true } }),
      tx.auditLog.findMany({ where: { userId: user.id, createdAt: { gte: shift.startedAt }, entity: { in: ['Task', 'FollowUp', 'ShiftHandover', 'SupervisionShift', 'Inspection', 'CorrectiveMeasure'] } }, select: { id: true, entity: true, entityId: true, action: true, createdAt: true } }),
    ]);
    const at = new Date();
    const updated = await tx.supervisionShift.updateMany({ where: { id: shiftId, status: 'ACTIVO' }, data: { status: 'ENTREGADO', handedOverAt: at } });
    if (updated.count !== 1) throw new RuleError('El turno cambió. Actualiza la pantalla.');
    const delivery = await tx.supervisionHandover.create({ data: { shiftId, authorId: user.id, note, snapshot: json({ version: 1, at, supervisorId: user.id, priorities: shift.priorities, tasks, followUps: notes, inspections, decisions }) } });
    await audit(tx, user, 'SupervisionShift', shiftId, 'EDITAR', { status: 'ACTIVO' }, { status: 'ENTREGADO', handoverId: delivery.id });
    return delivery;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
}

export async function finishSupervisionShift(user: CurrentUser, id: string) {
  permit(user, 'supervision.shift', true);
  return prisma.$transaction(async tx => {
    const result = await tx.supervisionShift.updateMany({ where: { id, supervisorId: user.id, status: 'ENTREGADO' }, data: { status: 'FINALIZADO', finishedAt: new Date() } });
    if (result.count !== 1) throw new RuleError('Primero entrega tu turno activo.');
    await audit(tx, user, 'SupervisionShift', id, 'CERRAR', { status: 'ENTREGADO' }, { status: 'FINALIZADO' });
  });
}

export async function createSupervisionNote(user: CurrentUser, input: { title: string; body: string; visibility: SupervisionVisibility; nextReviewAt?: Date; priority: Priority; source?: string }) {
  permit(user, 'supervision.notes', true);
  if (input.visibility === 'OPERATIVO') throw new RuleError('Publica una instrucción mediante una tarea; las notas no aparecen en el Libro.');
  if (input.visibility === 'SUPERVISION') permit(user, 'supervision.share', true);
  if (!input.title.trim() || !input.body.trim()) throw new RuleError('Indica asunto y contenido.');
  return prisma.$transaction(async tx => {
    const note = await tx.supervisionNote.create({ data: { ...input, authorId: user.id } });
    await tx.supervisionNoteRevision.create({ data: { noteId: note.id, actorId: user.id, snapshot: json(note) } });
    await audit(tx, user, 'SupervisionNote', note.id, 'CREAR', {}, { visibility: note.visibility, revision: 1 });
    return note;
  });
}

export async function readSupervisionNote(user: CurrentUser, id: string, technicalReason?: string) {
  permit(user, 'supervision.center');
  return prisma.$transaction(async tx => {
    const note = await tx.supervisionNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundError('La nota no existe.');
    if (note.visibility === 'PRIVADO' && note.authorId !== user.id) {
      if (!user.isSystemAdmin || !technicalReason?.trim()) throw new ForbiddenError('Esta nota es privada.');
      await audit(tx, user, 'SupervisionNote', id, 'EDITAR', {}, { exceptionalAccess: true }, technicalReason);
    }
    const revisions = await tx.supervisionNoteRevision.findMany({ where: { noteId: id }, orderBy: { createdAt: 'asc' } });
    return { ...note, revisions };
  });
}

export async function updateSupervisionNote(user: CurrentUser, id: string, input: { title: string; body: string; visibility: 'PRIVADO' | 'SUPERVISION'; nextReviewAt: Date | null; resolution: string | null }) {
  permit(user, 'supervision.notes', true);
  if (input.visibility === 'SUPERVISION') permit(user, 'supervision.share', true);
  return prisma.$transaction(async tx => {
    const note = await tx.supervisionNote.findFirst({ where: { id, authorId: user.id, deletedAt: null } });
    if (!note) throw new ForbiddenError('Sólo el autor puede editar esta nota.');
    const updated = await tx.supervisionNote.update({ where: { id }, data: input });
    await tx.supervisionNoteRevision.create({ data: { noteId: id, actorId: user.id, snapshot: json(updated) } });
    await audit(tx, user, 'SupervisionNote', id, 'EDITAR', { visibility: note.visibility }, { visibility: updated.visibility });
    return updated;
  });
}

export async function createSupervisedTask(user: CurrentUser, input: { title: string; description: string; acceptanceCriteria: string; assigneeId: string; collaboratorIds: string[]; priority: Priority; dueAt: Date; evidenceRequired: boolean; entryId?: string; shiftId?: string }) {
  permit(user, 'task.assign', true);
  permit(user, 'supervision.center', true);
  const participants = [...new Set([input.assigneeId, ...input.collaboratorIds])];
  await Promise.all(participants.map(id => assertAssignable(id)));
  if (!input.acceptanceCriteria.trim()) throw new RuleError('Indica el criterio de cumplimiento.');
  return prisma.$transaction(async tx => {
    const { collaboratorIds: _ids, ...data } = input;
    const task = await tx.task.create({ data: { ...data, createdById: user.id,
      collaborators: { create: participants.filter(id => id !== input.assigneeId).map(userId => ({ userId })) } } });
    await audit(tx, user, 'Task', task.id, 'CREAR', {}, { ...data, participants });
    return task;
  });
}

export async function saveTaskEvidence(user: CurrentUser, id: string, evidence: string) {
  if (!user.roleOperational || user.isSystemAdmin) throw new ForbiddenError('Sólo el personal operativo puede entregar evidencia.');
  return prisma.$transaction(async tx => {
    const task = await tx.task.findFirst({ where: { id, deletedAt: null, OR: [{ assigneeId: user.id }, { collaborators: { some: { userId: user.id } } }] } });
    if (!task || task.status === 'VALIDADA' || task.status === 'CANCELADA') throw new ForbiddenError('No puedes editar la evidencia de esta tarea.');
    const result = await tx.task.update({ where: { id }, data: { evidence } });
    await audit(tx, user, 'Task', id, 'EDITAR', { evidence: task.evidence }, { evidence });
    return result;
  });
}

export async function createInspectionTemplate(user: CurrentUser, input: { name: string; area: string; points: string[] }) {
  permit(user, 'supervision.inspections', true);
  if (!input.points.length) throw new RuleError('Añade al menos un punto de comprobación.');
  return prisma.$transaction(async tx => {
    const template = await tx.inspectionTemplate.create({ data: { ...input, authorId: user.id } });
    await audit(tx, user, 'InspectionTemplate', template.id, 'CREAR', {}, { pointCount: input.points.length });
    return template;
  });
}

export async function startInspection(user: CurrentUser, input: { templateId: string; title: string; scope: string; sample: string; reviewedPeople: string[]; reviewedShifts: string[] }) {
  permit(user, 'supervision.inspections', true);
  await Promise.all(input.reviewedPeople.map(id => assertAssignable(id)));
  return prisma.$transaction(async tx => {
    const template = await tx.inspectionTemplate.findFirst({ where: { id: input.templateId, deletedAt: null } });
    if (!template) throw new NotFoundError('La plantilla no existe.');
    const { templateId: _template, ...data } = input;
    const inspection = await tx.inspection.create({ data: { ...data, auditorId: user.id, area: template.area, points: { create: template.points.map(text => ({ text })) } } });
    await audit(tx, user, 'Inspection', inspection.id, 'CREAR', {}, { privatePreparation: true });
    return inspection;
  });
}

export async function updateInspectionPoint(user: CurrentUser, id: string, input: { result: InspectionResult; evidence?: string; observation?: string; severity: Severity }) {
  permit(user, 'supervision.inspections', true);
  if (['OBSERVACION', 'INCUMPLIMIENTO'].includes(input.result) && !input.observation?.trim()) throw new RuleError('Describe el hallazgo.');
  return prisma.$transaction(async tx => {
    const point = await tx.inspectionPoint.findFirst({ where: { id, inspection: { auditorId: user.id, closedAt: null, deletedAt: null } } });
    if (!point) throw new ForbiddenError('La auditoría está cerrada o no te pertenece.');
    const updated = await tx.inspectionPoint.update({ where: { id }, data: input });
    await audit(tx, user, 'Inspection', point.inspectionId, 'EDITAR', {}, { pointId: id, changed: true });
    return updated;
  });
}

export async function closeInspection(user: CurrentUser, id: string, result: string, visibility: 'PRIVADO' | 'SUPERVISION') {
  permit(user, 'supervision.inspections', true);
  return prisma.$transaction(async tx => {
    const inspection = await tx.inspection.findFirst({ where: { id, auditorId: user.id, deletedAt: null, closedAt: null }, include: { points: true } });
    if (!inspection || !result.trim() || inspection.points.some(p => p.result === 'PENDIENTE')) throw new RuleError('Completa todos los puntos y el resultado antes de cerrar.');
    const updated = await tx.inspection.update({ where: { id }, data: { closedAt: new Date(), result, visibility } });
    await audit(tx, user, 'Inspection', id, 'CERRAR', {}, { closedAt: updated.closedAt, visibility });
    return updated;
  });
}

export async function createCorrectiveMeasure(user: CurrentUser, input: { pointId: string; title: string; instruction: string; criteria: string; assigneeId: string; dueAt: Date }) {
  permit(user, 'supervision.corrective', true);
  await assertAssignable(input.assigneeId);
  return prisma.$transaction(async tx => {
    const point = await tx.inspectionPoint.findFirst({ where: { id: input.pointId, result: { in: ['OBSERVACION', 'INCUMPLIMIENTO'] }, inspection: { deletedAt: null, closedAt: { not: null }, OR: [{ auditorId: user.id }, { visibility: 'SUPERVISION' }] } } });
    if (!point) throw new RuleError('La medida requiere un hallazgo de una auditoría cerrada y accesible.');
    const task = await tx.task.create({ data: { title: input.title, description: input.instruction, acceptanceCriteria: input.criteria, assigneeId: input.assigneeId, dueAt: input.dueAt, evidenceRequired: true, createdById: user.id } });
    const measure = await tx.correctiveMeasure.create({ data: { pointId: point.id, taskId: task.id, responsibleId: input.assigneeId } });
    await audit(tx, user, 'CorrectiveMeasure', measure.id, 'CREAR', {}, { taskId: task.id });
    await audit(tx, user, 'Task', task.id, 'CREAR', {}, { title: task.title, assigneeId: task.assigneeId });
    return measure;
  });
}

export async function getSupervisionCenter(user: CurrentUser) {
  permit(user, 'supervision.center');
  const [shift, notes, inspections, templates, tasks, handovers, operational] = await Promise.all([
    prisma.supervisionShift.findFirst({ where: { supervisorId: user.id, status: { in: ['ACTIVO', 'ENTREGADO'] } }, include: { handover: true } }),
    prisma.supervisionNote.findMany({ where: { deletedAt: null, OR: [{ authorId: user.id }, { visibility: 'SUPERVISION' }] }, orderBy: { updatedAt: 'desc' } }),
    prisma.inspection.findMany({ where: { deletedAt: null, OR: [{ auditorId: user.id }, { visibility: 'SUPERVISION', closedAt: { not: null } }] }, include: { points: { include: { measures: { include: { task: true } } } } }, orderBy: { startedAt: 'desc' } }),
    prisma.inspectionTemplate.findMany({ where: { deletedAt: null } }),
    prisma.task.findMany({ where: { deletedAt: null, acceptanceCriteria: { not: null } }, include: { assignee: { select: { name: true } } }, orderBy: { dueAt: 'asc' } }),
    prisma.supervisionHandover.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    getSupervisionData(),
  ]);
  return { shift, notes, inspections, templates, tasks, handovers, operational };
}

export async function getTeamPerformance(user: CurrentUser, subjectId: string, start: Date, end: Date) {
  permit(user, 'supervision.performance');
  if (start >= end) throw new RuleError('El periodo no es válido.');
  await assertAssignable(subjectId);
  const [tasks, shifts, observations] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, assigneeId: subjectId, dueAt: { gte: start, lt: end }, acceptanceCriteria: { not: null } }, select: { id: true, title: true, status: true, dueAt: true, completedAt: true, validatedAt: true } }),
    prisma.shiftAssignment.findMany({ where: { userId: subjectId, activatedAt: { gte: start, lt: end } }, select: { shiftId: true, activatedAt: true, leftAt: true } }),
    prisma.performanceObservation.findMany({ where: { subjectId, deletedAt: null, periodStart: { lt: end }, periodEnd: { gt: start } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const eligible = tasks.filter(t => t.status !== 'CANCELADA');
  return { start, end, tasks, shifts, observations, denominator: eligible.length,
    validated: eligible.filter(t => t.status === 'VALIDADA').length,
    onTime: eligible.filter(t => t.completedAt && t.dueAt && t.completedAt <= t.dueAt).length,
    returned: eligible.filter(t => t.status === 'DEVUELTA').length,
    formula: 'Tareas asignadas actualmente al usuario con vencimiento en el periodo; se excluyen las canceladas. Puntualidad: primera realización registrada antes o en el vencimiento. Devueltas: estado actual, no reincidencias.' };
}

export async function recordPerformanceObservation(user: CurrentUser, input: { subjectId: string; periodStart: Date; periodEnd: Date; kind: string; comment: string; workerExplanation?: string; context: string; sources: string[] }) {
  permit(user, 'supervision.observe', true);
  if (input.periodStart >= input.periodEnd || !input.context.trim() || !input.comment.trim()) throw new RuleError('Indica periodo, contexto y comentario.');
  if (!['Dato operativo', 'Hallazgo confirmado', 'Observación del supervisor', 'Tendencia', 'Reincidencia', 'Valoración manual'].includes(input.kind)) throw new RuleError('Selecciona el tipo de observación.');
  if (['Hallazgo confirmado', 'Reincidencia'].includes(input.kind) && !input.sources.length) throw new RuleError('Vincula los registros que permiten confirmar el hallazgo.');
  await assertAssignable(input.subjectId);
  return prisma.$transaction(async tx => {
    const record = await tx.performanceObservation.create({ data: { ...input, authorId: user.id } });
    await audit(tx, user, 'PerformanceObservation', record.id, 'CREAR', {}, { kind: input.kind, subjectId: input.subjectId });
    return record;
  });
}

export async function archiveSupervisionRecord(user: CurrentUser, entity: 'SupervisionNote' | 'Inspection' | 'InspectionTemplate' | 'PerformanceObservation' | 'CorrectiveMeasure', id: string, reason: string, restore = false) {
  permit(user, 'supervision.center');
  if (!reason.trim()) throw new RuleError('Indica el motivo.');
  if (restore && !user.permissions.includes('entry.restore')) throw new ForbiddenError('No tienes permiso para restaurar.');
  if (!restore && !user.permissions.includes('entry.delete')) throw new ForbiddenError('No tienes permiso para eliminar.');
  return prisma.$transaction(async tx => {
    const data = { deletedAt: restore ? null : new Date(), deletionReason: restore ? null : reason };
    if (entity === 'SupervisionNote') {
      const record = await tx.supervisionNote.findUnique({ where: { id } });
      if (!record || (record.authorId !== user.id && !user.isSystemAdmin)) throw new ForbiddenError('No tienes acceso a esta nota.');
      await tx.supervisionNote.update({ where: { id }, data });
    } else if (entity === 'Inspection') {
      const record = await tx.inspection.findUnique({ where: { id } });
      if (!record || (record.auditorId !== user.id && !user.isSystemAdmin)) throw new ForbiddenError('No tienes acceso a esta auditoría.');
      await tx.inspection.update({ where: { id }, data });
    } else if (entity === 'InspectionTemplate') {
      permit(user, 'supervision.inspections');
      await tx.inspectionTemplate.update({ where: { id }, data });
    } else if (entity === 'PerformanceObservation') {
      permit(user, 'supervision.observe');
      await tx.performanceObservation.update({ where: { id }, data });
    } else {
      permit(user, 'supervision.corrective');
      await tx.correctiveMeasure.update({ where: { id }, data });
    }
    await audit(tx, user, entity, id, restore ? 'RESTAURAR' : 'ELIMINAR', {}, data, reason);
  });
}
