import 'server-only';
import {
  AuditAction,
  ChecklistItemResult,
  CorrectiveMeasureStatus,
  TaskParticipantRole,
  TaskStatus,
} from '@prisma/client';
import type { PerformanceObservationKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';

export type ExplainableIndicator = {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  value: number | null;
  formula: string;
  source: string;
  cases: Array<{ id: string; label: string; href: string }>;
  kind: 'DATO_OPERATIVO' | 'HALLAZGO_CONFIRMADO' | 'TENDENCIA' | 'REINCIDENCIA';
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

function assertCanViewTeam(user: CurrentUser) {
  if (
    !user.permissions.includes('supervision.performance.view') &&
    !user.isSystemAdmin
  ) {
    throw new RuleError('No tienes permiso para consultar indicadores del equipo.');
  }
}

export async function getTeamPerformance(
  user: CurrentUser,
  input: { from: Date; to: Date },
) {
  assertCanViewTeam(user);
  const people = await prisma.user.findMany({
    where: { active: true, deletedAt: null, role: { operational: true } },
    select: { id: true, name: true, role: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  return Promise.all(
    people.map((person) => getUserPerformance(user, person.id, input)),
  );
}

export async function getUserPerformance(
  user: CurrentUser,
  subjectId: string,
  input: { from: Date; to: Date },
) {
  assertCanViewTeam(user);
  if (input.from > input.to) throw new RuleError('El inicio del periodo no puede ser posterior al final.');
  const subject = await prisma.user.findFirst({
    where: { id: subjectId, deletedAt: null, role: { operational: true } },
    select: { id: true, name: true, role: { select: { name: true } } },
  });
  if (!subject) throw new NotFoundError('La persona no existe o no pertenece al equipo operativo.');

  const range = { gte: input.from, lte: input.to };
  const [tasks, followUps, shifts, auditItems, measures, collaboration, observations] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          deletedAt: null,
          assigneeId: subject.id,
          createdAt: range,
        },
        select: {
          id: true,
          seq: true,
          title: true,
          status: true,
          dueAt: true,
          completedAt: true,
          validatedAt: true,
          returnReason: true,
        },
      }),
      prisma.followUp.findMany({
        where: { deletedAt: null, ownerId: subject.id, createdAt: range },
        select: { id: true, action: true, status: true, scheduledAt: true, completedAt: true },
      }),
      prisma.shiftAssignment.findMany({
        where: { userId: subject.id, activatedAt: range },
        select: { id: true, shiftId: true, activatedAt: true, leftAt: true },
      }),
      prisma.checklistRunItem.findMany({
        where: {
          run: {
            deletedAt: null,
            finishedAt: range,
            participants: { some: { userId: subject.id } },
          },
        },
        select: {
          id: true,
          text: true,
          result: true,
          run: { select: { id: true, templateName: true, template: { select: { category: true } } } },
        },
      }),
      prisma.correctiveMeasure.findMany({
        where: { deletedAt: null, assigneeId: subject.id, createdAt: range },
        select: { id: true, title: true, status: true, validatedAt: true, dueAt: true },
      }),
      prisma.taskAssignment.findMany({
        where: {
          userId: subject.id,
          role: TaskParticipantRole.COLABORADOR,
          removedAt: null,
          task: { deletedAt: null, createdAt: range },
        },
        select: { task: { select: { id: true, seq: true, title: true, status: true } } },
      }),
      prisma.performanceObservation.findMany({
        where: {
          subjectId: subject.id,
          deletedAt: null,
          periodStart: { lte: input.to },
          periodEnd: { gte: input.from },
        },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  const doneStatuses = new Set<TaskStatus>([
    TaskStatus.REALIZADA,
    TaskStatus.VALIDADA,
    TaskStatus.COMPLETADA,
  ]);
  const closedStatuses = new Set<TaskStatus>([
    TaskStatus.VALIDADA,
    TaskStatus.COMPLETADA,
    TaskStatus.CANCELADA,
  ]);
  const taskDone = tasks.filter((task) => doneStatuses.has(task.status));
  const taskClosed = tasks.filter((task) => closedStatuses.has(task.status));
  const taskOnTime = taskDone.filter(
    (task) => !task.dueAt || (task.completedAt !== null && task.completedAt <= task.dueAt),
  );
  const returned = tasks.filter((task) => task.status === TaskStatus.DEVUELTA || task.returnReason);
  const validatedStatuses = new Set<TaskStatus>([TaskStatus.VALIDADA, TaskStatus.COMPLETADA]);
  const validated = tasks.filter((task) => validatedStatuses.has(task.status));
  const followUpsClosed = followUps.filter((followUp) => followUp.status === 'CUMPLIDO');
  const followUpsOnTime = followUpsClosed.filter(
    (followUp) =>
      !followUp.scheduledAt ||
      (followUp.completedAt !== null && followUp.completedAt <= followUp.scheduledAt),
  );
  const inspected = auditItems.filter((item) => item.result !== ChecklistItemResult.PENDIENTE);
  const compliantResults = new Set<ChecklistItemResult>([
    ChecklistItemResult.OK,
    ChecklistItemResult.CUMPLE,
    ChecklistItemResult.NO_APLICA,
  ]);
  const findingResults = new Set<ChecklistItemResult>([
    ChecklistItemResult.FALLA,
    ChecklistItemResult.INCUMPLIMIENTO,
  ]);
  const compliant = inspected.filter((item) => compliantResults.has(item.result));
  const confirmedFindings = inspected.filter((item) => findingResults.has(item.result));
  const normalizedFindingNames = new Map<string, number>();
  for (const item of confirmedFindings) {
    const key = item.text.trim().toLocaleLowerCase('es-CL');
    normalizedFindingNames.set(key, (normalizedFindingNames.get(key) ?? 0) + 1);
  }
  const recurrences = [...normalizedFindingNames.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const measuresValidated = measures.filter(
    (measure) => measure.status === CorrectiveMeasureStatus.VALIDADA,
  );
  const collaborationCompleted = collaboration.filter((item) =>
    doneStatuses.has(item.task.status),
  );

  const taskCases = (items: typeof tasks) =>
    items.slice(0, 30).map((task) => ({
      id: task.id,
      label: `T#${task.seq} · ${task.title}`,
      href: `/tareas/${task.id}`,
    }));
  const auditCases = (items: typeof auditItems) =>
    items.slice(0, 30).map((item) => ({
      id: item.id,
      label: `${item.run.templateName} · ${item.text}`,
      href: `/supervision/auditorias?auditoria=${item.run.id}`,
    }));

  const indicators: ExplainableIndicator[] = [
    {
      key: 'task-completion',
      label: 'Cumplimiento de tareas',
      numerator: taskDone.length,
      denominator: tasks.length,
      value: ratio(taskDone.length, tasks.length),
      formula: 'Tareas realizadas o validadas ÷ tareas asignadas en el periodo',
      source: 'Tareas y sus estados auditados',
      cases: taskCases(tasks),
      kind: 'DATO_OPERATIVO',
    },
    {
      key: 'task-on-time',
      label: 'Entregas dentro del plazo',
      numerator: taskOnTime.length,
      denominator: taskDone.length,
      value: ratio(taskOnTime.length, taskDone.length),
      formula: 'Tareas realizadas antes del vencimiento ÷ tareas realizadas',
      source: 'Fecha límite y fecha real de realización',
      cases: taskCases(taskDone),
      kind: 'DATO_OPERATIVO',
    },
    {
      key: 'task-quality',
      label: 'Calidad de ejecución',
      numerator: validated.length,
      denominator: validated.length + returned.length,
      value: ratio(validated.length, validated.length + returned.length),
      formula: 'Tareas validadas ÷ tareas validadas o devueltas',
      source: 'Validaciones y devoluciones de tareas',
      cases: taskCases([...validated, ...returned]),
      kind: 'TENDENCIA',
    },
    {
      key: 'returned-tasks',
      label: 'Tareas devueltas',
      numerator: returned.length,
      denominator: taskClosed.length + returned.length,
      value: ratio(returned.length, taskClosed.length + returned.length),
      formula: 'Tareas devueltas ÷ tareas cerradas o devueltas',
      source: 'Estado y motivo de devolución',
      cases: taskCases(returned),
      kind: 'HALLAZGO_CONFIRMADO',
    },
    {
      key: 'followups',
      label: 'Atención de seguimientos',
      numerator: followUpsOnTime.length,
      denominator: followUpsClosed.length,
      value: ratio(followUpsOnTime.length, followUpsClosed.length),
      formula: 'Seguimientos cumplidos a tiempo ÷ seguimientos cumplidos',
      source: 'Seguimientos asignados, revisión y cierre',
      cases: followUps.slice(0, 30).map((followUp) => ({
        id: followUp.id,
        label: followUp.action,
        href: '/seguimientos',
      })),
      kind: 'DATO_OPERATIVO',
    },
    {
      key: 'procedures',
      label: 'Cumplimiento de procedimientos',
      numerator: compliant.length,
      denominator: inspected.length,
      value: ratio(compliant.length, inspected.length),
      formula: 'Puntos conformes o no aplicables ÷ puntos auditados',
      source: 'Auditorías cerradas vinculadas a la persona',
      cases: auditCases(inspected),
      kind: 'HALLAZGO_CONFIRMADO',
    },
    {
      key: 'recurrence',
      label: 'Reincidencias confirmadas',
      numerator: recurrences,
      denominator: confirmedFindings.length,
      value: ratio(recurrences, confirmedFindings.length),
      formula: 'Repeticiones del mismo hallazgo confirmado ÷ hallazgos confirmados',
      source: 'Puntos incumplidos de auditorías cerradas',
      cases: auditCases(confirmedFindings),
      kind: 'REINCIDENCIA',
    },
    {
      key: 'corrective-measures',
      label: 'Medidas correctivas cerradas',
      numerator: measuresValidated.length,
      denominator: measures.length,
      value: ratio(measuresValidated.length, measures.length),
      formula: 'Medidas validadas ÷ medidas asignadas',
      source: 'Medidas correctivas y validación del Supervisor',
      cases: measures.slice(0, 30).map((measure) => ({
        id: measure.id,
        label: measure.title,
        href: '/supervision/auditorias',
      })),
      kind: 'DATO_OPERATIVO',
    },
    {
      key: 'collaboration',
      label: 'Colaboración operativa',
      numerator: collaborationCompleted.length,
      denominator: collaboration.length,
      value: ratio(collaborationCompleted.length, collaboration.length),
      formula: 'Tareas colaborativas realizadas ÷ tareas en que participó como colaborador',
      source: 'Asignaciones múltiples y estado de la tarea',
      cases: collaboration.slice(0, 30).map(({ task }) => ({
        id: task.id,
        label: `T#${task.seq} · ${task.title}`,
        href: `/tareas/${task.id}`,
      })),
      kind: 'DATO_OPERATIVO',
    },
  ];

  return {
    user: subject,
    period: input,
    context: {
      shiftsWorked: shifts.length,
      assignedTasks: tasks.length,
      collaborativeTasks: collaboration.length,
      auditedPoints: inspected.length,
      absences: null,
      comparabilityNote:
        shifts.length === 0
          ? 'No hay turnos activados en el periodo; no corresponde comparar tasas con otros periodos.'
          : null,
    },
    indicators,
    observations,
  };
}

export async function addPerformanceObservation(
  user: CurrentUser,
  input: {
    subjectId: string;
    kind: PerformanceObservationKind;
    periodStart: Date;
    periodEnd: Date;
    content: string;
    sourceEntity?: string | null;
    sourceId?: string | null;
  },
) {
  if (
    user.roleKey !== ROLE_KEYS.SUPERVISOR ||
    user.isSystemAdmin ||
    !user.permissions.includes('supervision.performance.comment')
  ) {
    throw new RuleError('No tienes permiso para añadir observaciones de rendimiento.');
  }
  const subject = await prisma.user.findFirst({
    where: { id: input.subjectId, deletedAt: null, role: { operational: true } },
    select: { id: true, name: true },
  });
  if (!subject) throw new NotFoundError('La persona no existe o no es operativa.');
  const observation = await prisma.performanceObservation.create({
    data: {
      subjectId: subject.id,
      authorId: user.id,
      kind: input.kind,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      content: input.content.trim(),
      sourceEntity: input.sourceEntity ?? null,
      sourceId: input.sourceId ?? null,
    },
  });
  await recordAudit({
    entity: 'PerformanceObservation',
    entityId: observation.id,
    action: AuditAction.CREAR,
    summary: `Observación de rendimiento para ${subject.name}`,
    user,
    after: {
      subjectId: subject.id,
      kind: observation.kind,
      periodStart: observation.periodStart,
      periodEnd: observation.periodEnd,
      sourceEntity: observation.sourceEntity,
      sourceId: observation.sourceId,
    },
  });
  return observation;
}
