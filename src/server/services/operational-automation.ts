import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, RuleError } from '@/server/errors';
import { procedureOccurrences, procedureSchema, escalationSchema, matchesAutomation } from '@/domain/operational-automation';
import { canonicalJson } from '@/domain/fronti-execution';
import { createTask } from './tasks';
import { getCoordinationBoard, coordinationMetrics, type CoordinationRow } from './coordination';
import { coordinationEntries, coordinationTasks, coordinationFollowUps } from './coordination-access';
import { hkWorkVisibility } from './housekeeping-work';
import { hasAcceptedCurrentTerms } from './legal-acceptance';
import { assertReceptionOperationPermission } from './reception-operation-gate';
import { notify } from '@/server/notifications';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function automationPrincipal(id: string, policyId: string): Promise<CurrentUser> {
  const user = await prisma.user.findFirst({ where: { id, active: true, deletedAt: null }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  if (!user || user.mustChangePassword || !await hasAcceptedCurrentTerms(user.id)) throw new ForbiddenError('La persona que autorizó la política ya no está habilitada.');
  return { id: user.id, name: user.name, sessionId: `automation:${policyId}`, roleId: user.roleId, roleKey: user.role.key, roleName: user.role.name, roleLevel: user.role.level, roleOperational: user.role.operational, departmentId: user.departmentId, mustChangePassword: user.mustChangePassword, permissions: user.role.permissions.map(p => p.permission.key as PermissionKey), isSystemAdmin: user.role.key === ROLE_KEYS.SYSTEM_ADMIN, frontiAccessEnabled: user.frontiAccessEnabled };
}
async function assertPolicyArea(user: CurrentUser, departmentId: string) {
  if (!user.permissions.includes('system.configure')) throw new ForbiddenError('La habilitación de reglas corresponde a configuración del sistema.');
  if (!await prisma.department.count({ where: { id: departmentId, active: true } })) throw new RuleError('El área no está activa.');
}
export const automationInput = z.object({
  id: z.string().optional(), version: z.number().int().positive().optional(),
  name: z.string().trim().min(3).max(160), departmentId: z.string().min(1),
  kind: z.enum(['PROCEDURE','ESCALATION']), configuration: z.unknown(),
  expiresAt: z.coerce.date(), enabled: z.boolean().default(false),
}).strict();
export async function saveAutomation(user: CurrentUser, raw: unknown) {
  const input = automationInput.parse(raw);
  await assertPolicyArea(user, input.departmentId);
  if (input.expiresAt <= new Date() || input.expiresAt.getTime() > Date.now() + 366 * 86400000) throw new RuleError('Define una vigencia futura de hasta un año.');
  const configuration = input.kind === 'PROCEDURE' ? procedureSchema.parse(input.configuration) : escalationSchema.parse(input.configuration);
  return prisma.$transaction(async tx => {
    const data = { name: input.name, departmentId: input.departmentId, kind: input.kind, configuration: json(configuration), expiresAt: input.expiresAt, enabled: input.enabled };
    let id = input.id;
    if (id) {
      const updated = await tx.operationalAutomation.updateMany({ where: { id, ownerId: user.id, version: input.version, revokedAt: null }, data: { ...data, version: { increment: 1 } } });
      if (!updated.count) throw new RuleError('La política cambió o pertenece a otra persona.');
    } else id = (await tx.operationalAutomation.create({ data: { ...data, ownerId: user.id } })).id;
    await tx.auditLog.create({ data: { entity: 'OperationalAutomation', entityId: id, userId: user.id, sessionId: user.sessionId, action: 'CONFIGURAR', summary: `${input.enabled ? 'Habilitar' : 'Pausar'} política: ${input.name}`, after: data } });
    return { id };
  });
}
export async function revokeAutomation(user: CurrentUser, id: string) {
  const changed = await prisma.operationalAutomation.updateMany({ where: { id, ownerId: user.id, revokedAt: null }, data: { revokedAt: new Date(), enabled: false, version: { increment: 1 } } });
  if (!changed.count) throw new RuleError('No puedes revocar esta política.');
  await prisma.auditLog.create({ data: { entity: 'OperationalAutomation', entityId: id, userId: user.id, sessionId: user.sessionId, action: 'CONFIGURAR', summary: 'Política revocada. Se conserva el historial.' } });
}

/** Every page is read through the original access-filtered board. Bound and label incomplete scans. */
export async function automationBoard(user: CurrentUser, departmentId?: string) {
  const rows: CoordinationRow[] = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const board = await getCoordinationBoard(user, { departmentId, page });
    rows.push(...board.rows);
    if (!board.hasMore) { complete = true; break; }
  }
  return { rows, complete };
}
async function sameAreaUser(id: string, departmentId: string) {
  return prisma.user.findFirst({ where: { id, active: true, deletedAt: null, role: { operational: true }, OR: [{ departmentId }, { scheduleCollaborator: { active: true, memberships: { some: { departmentId, active: true } } } }] }, select: { id: true, name: true } });
}

export async function simulateAutomation(user: CurrentUser, id: string, now = new Date()) {
  const policy = await prisma.operationalAutomation.findFirst({ where: { id, ownerId: user.id } });
  if (!policy) throw new ForbiddenError();
  await assertPolicyArea(user, policy.departmentId);
  if (policy.kind === 'PROCEDURE') {
    const config = procedureSchema.parse(policy.configuration);
    const eligible = await sameAreaUser(config.ownerId, policy.departmentId);
    return { mode: 'SIMULATION', version: policy.version, complete: true, effects: procedureOccurrences(config, now).map(o => ({ occurrence: o.key, dueAt: new Date(o.at.getTime() + config.deadlineMinutes * 60000), ownerId: config.ownerId, responsible: eligible?.name ?? config.ownerId, eligible: !!eligible, action: 'CREATE_TASK' })), explanation: 'Crea una tarea y su lista mediante el servicio existente. Sin ejecución física ni inspección automática. No modifica datos operativos.' };
  }
  const config = escalationSchema.parse(policy.configuration);
  const board = await automationBoard(user, policy.departmentId);
  const recipient = await sameAreaUser(config.recipientId, policy.departmentId);
  return { mode: 'SIMULATION', version: policy.version, complete: board.complete, effects: board.rows.filter(r => matchesAutomation(r, config, now)).slice(0, config.maxItems).map(r => ({ id: r.id, kind: r.kind, revision: r.updatedAt.toISOString(), href: r.href, nextAction: r.nextAction, recipientId: config.recipientId, responsible: recipient?.name ?? config.recipientId, title: r.title, eligible: !!recipient, action: 'NOTIFY' })), explanation: 'Escala el registro original al destinatario del área sólo si conserva acceso. Sin responsable y asignado sin recibir son condiciones distintas. No genera incidencias nuevas.' };
}

/** Called only by the existing operational cron. No provider, push or Actions dependency. */
export async function runOperationalAutomations(now = new Date()) {
  if (process.env.AROH_AUTOMATION_EXECUTION_ENABLED !== 'true') return { enabled: false, attempted: 0, failed: 0 };
  const policies = await prisma.operationalAutomation.findMany({ where: { enabled: true, revokedAt: null, expiresAt: { gt: now } }, orderBy: [{ lastEvaluatedAt: { sort:'asc',nulls:'first' } },{id:'asc'}], take: 20 });
  let attempted = 0, failed = 0;
  for (const policy of policies) {
    try {
      const actor = await automationPrincipal(policy.ownerId, policy.id);
      const simulation = await simulateAutomation(actor, policy.id, now);
      for (const effect of simulation.effects) {
        if (!effect.eligible) throw new RuleError('No hay responsable o destinatario elegible en el área. La política se pausa para intervención.');
        const occurrence = 'occurrence' in effect ? effect.occurrence : createHash('sha256').update(canonicalJson({ kind: effect.kind, id: effect.id, revision: effect.revision, trigger: escalationSchema.parse(policy.configuration).trigger })).digest('hex');
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "OperationalAutomation" WHERE "id"=${policy.id} FOR UPDATE`;
          const live = await tx.operationalAutomation.findFirst({ where: { id: policy.id, version: policy.version, enabled: true, revokedAt: null, expiresAt: { gt: new Date() } } });
          if (!live) return;
          if (await tx.operationalAutomationRun.findUnique({ where: { policyId_occurrence: { policyId: policy.id, occurrence } } })) return;
          const run = await tx.operationalAutomationRun.create({ data: { policyId: policy.id, occurrence, policyVersion: policy.version, snapshot: json(policy.configuration), status: 'RUNNING' } });
          let result: unknown;
          if (policy.kind === 'PROCEDURE') {
            const config = procedureSchema.parse(policy.configuration);
            if (!actor.permissions.includes('task.create') || !actor.permissions.includes('task.assign')) throw new ForbiddenError();
            await assertReceptionOperationPermission(actor, 'task.create');
            if (!await sameAreaUser(config.ownerId, policy.departmentId)) throw new ForbiddenError('Responsable no elegible para el área.');
            const date = procedureOccurrences(config, now).find(o => o.key === occurrence)!;
            const task = await createTask(actor, { title: config.title, description: config.description, assigneeId: config.ownerId, departmentId: policy.departmentId, priority: config.priority, startsAt: date.at, dueAt: new Date(date.at.getTime() + config.deadlineMinutes * 60000), fulfillmentCriteria: config.nextAction, evidenceRequired: config.evidenceRequired, checklist: config.checklist, tags: ['procedimiento'], requiresIndependentValidation: config.requiresIndependentValidation, procedureOccurrenceKey: `${policy.id}:${occurrence}` }, tx);
            result = { taskId: task.id, href: `/tareas/${task.id}` };
          } else if ('id' in effect) {
            const config = escalationSchema.parse(policy.configuration);
            const recipient = await automationPrincipal(config.recipientId, policy.id);
            const visible = effect.kind === 'entry' ? await tx.operationalEntry.count({ where: { id: effect.id, AND: [coordinationEntries(recipient)] } }) : effect.kind === 'task' ? await tx.task.count({ where: { id: effect.id, AND: [coordinationTasks(recipient)] } }) : effect.kind === 'housekeeping' ? await tx.housekeepingRequest.count({ where: { id: effect.id, AND: [await hkWorkVisibility(recipient, tx)] } }) : effect.kind === 'followup' ? await tx.followUp.count({where:{id:effect.id,AND:[coordinationFollowUps(recipient)]}}) : 0;
            if (!visible) throw new ForbiddenError('Destinatario sin acceso al origen.');
            await notify({ userId: recipient.id, type: 'ACCION_REQUERIDA', title: 'Trabajo del área requiere atención', link: effect.href, entity: 'OperationalAutomation', entityId: run.id }, tx);
            result = { sourceId: effect.id, recipientId: recipient.id };
          }
          await tx.operationalAutomationRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', result: json(result), completedAt: new Date() } });
          attempted++;
        }, { timeout: 15000 });
      }
      await prisma.operationalAutomation.updateMany({where:{id:policy.id,version:policy.version},data:{lastEvaluatedAt:now}});
    } catch (error) {
      failed++;
      await prisma.$transaction(async tx => {
        const paused = await tx.operationalAutomation.updateMany({ where: { id: policy.id, version: policy.version, enabled: true }, data: { enabled: false } });
        if (!paused.count) return;
        const result = { error: error instanceof RuleError || error instanceof ForbiddenError ? error.message : 'Fallo técnico', retry: 'Corregir y habilitar una nueva versión; no se repiten ocurrencias confirmadas.' };
        await tx.operationalAutomationRun.upsert({ where: { policyId_occurrence: { policyId: policy.id, occurrence: `error:${policy.version}` } }, create: { policyId: policy.id, occurrence: `error:${policy.version}`, policyVersion: policy.version, snapshot: json(policy.configuration), status: 'INTERVENTION', result, completedAt: new Date() }, update: {} });
        await tx.auditLog.create({ data: { entity: 'OperationalAutomation', entityId: policy.id, userId: policy.ownerId, action: 'EDITAR', summary: 'Automatización pausada; requiere revisión', after: result } });
      });
    }
  }
  return { enabled: true, attempted, failed, limit: 20 };
}

export async function automationSummary(user: CurrentUser, departmentId?: string) {
  const board = await automationBoard(user, departmentId);
  const since = new Date(Date.now() - 86400000);
  const runs = await prisma.frontiExecution.findMany({ where: { userId: user.id, createdAt: { gte: since } }, select: { id: true, status: true }, take: 101 });
  return { generatedAt: new Date(), period: { from: since, to: new Date() }, scope: departmentId ?? 'registros dentro de tu acceso', sources:board.rows.slice(0,20).map(({id,title,owner,nextAction,href,dueAt})=>({id,title,owner,nextAction,href,dueAt})), complete: board.complete, denominator: board.rows.length, metrics: coordinationMetrics(board.rows), fronti: { scope: 'Sólo tus ejecuciones de las últimas 24 horas', complete: runs.length <= 100, observed: runs.slice(0,100) }, savedManualSteps: null, note: 'No se estima ahorro ni se imputan tiempos históricos faltantes. Los pendientes corresponden al estado actual, no sólo al período.' };
}
