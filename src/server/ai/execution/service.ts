import 'server-only';
import { revisionForStep } from './revision';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sealSecret, openSecret } from '@/lib/secret-box';
import { requireUser } from '@/server/auth/guard';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canUseFronti } from '@/server/ai/fronti-access';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import { canonicalJson, executionStatus, frontiPlanSchema, type FrontiStep } from '@/domain/fronti-execution';
import { actionDefinition, invokeNativeAction, validateStep } from './catalog';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const purpose = (userId: string) => `fronti-execution:${userId}`;

export async function executionActor() {
  const user = await requireUser(); // fresh session and permissions, including every resumed step
  if (!canUseFronti(user, (await getFrontiConfig()).enabled)) throw new ForbiddenError();
  return user;
}

export async function prepareExecution(input: unknown) {
  const user = await executionActor();
  const plan = frontiPlanSchema.parse(input);
  const steps = plan.steps.map(validateStep);
  for (const step of steps) {
    if(step.action==='updateRolePermissionsAction') {
      if(!user.permissions.includes('role.manage'))throw new ForbiddenError();
      const before=await prisma.rolePermission.findMany({where:{roleId:String(step.fields.roleId)},include:{permission:true}});
      const keys=before.map(p=>p.permission.key).sort(), approvals=before.filter(p=>p.requiresApproval).map(p=>p.permission.key).sort();
      if(canonicalJson(keys)!==canonicalJson([...(step.fields.permissionsBefore as string[])].sort())||canonicalJson(approvals)!==canonicalJson([...(step.fields.approvalRequiredBefore as string[])].sort()))throw new RuleError('La matriz previa no coincide con el rol. Consulta su estado y presenta antes y después completos.');
    }
    if(step.action==='updateUserAction'&&!user.permissions.includes('user.manage'))throw new ForbiddenError();
  }
  const fingerprint = digest({ instruction: plan.instruction, steps });
  const revisions = await Promise.all(steps.map(revisionForStep));
  return prisma.$transaction(async tx => {
    // Serialize retries before reading; no long-running native service runs under this lock.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'fronti-plan:' + user.id}))::text`;
    const alias = await tx.frontiExecutionRequest.findUnique({where:{userId_requestKey:{userId:user.id,requestKey:plan.requestKey}},include:{execution:true}});
    if (alias) {
      if(alias.execution.fingerprint!==fingerprint) throw new RuleError('El reintento contiene una instrucción distinta. Prepara un procedimiento nuevo.');
      return alias.execution;
    }
    const existing = await tx.frontiExecution.findUnique({ where: { userId_requestKey: { userId: user.id, requestKey: plan.requestKey } } });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new RuleError('El reintento contiene una instrucción distinta. Prepara un procedimiento nuevo.');
      return existing;
    }
    // A retransmitted message with a new transport ID must not create the same operation twice.
    const duplicate = await tx.frontiExecution.findFirst({ where: { userId: user.id, fingerprint, createdAt: { gte: new Date(Date.now() - 5 * 60_000) }, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
    if (duplicate) {
      await tx.frontiExecutionRequest.create({data:{userId:user.id,requestKey:plan.requestKey,executionId:duplicate.id}});
      return duplicate;
    }
    return tx.frontiExecution.create({ data: {
      requests: {create:{userId:user.id,requestKey:plan.requestKey}},
      userId: user.id, sessionId: user.sessionId, requestKey: plan.requestKey, fingerprint,
      instruction: digest(plan.instruction), expiresAt: new Date(Date.now() + 15 * 60_000),
      steps: { create: steps.map((step, position) => ({ position, revision: revisions[position], action: step.action, fields: { sealed: sealSecret(JSON.stringify(step.fields), purpose(user.id)) } })) },
    } });
  });
}

export async function readExecution(id: string) {
  const user = await executionActor();
  await prisma.frontiExecutionStep.updateMany({ where: { executionId: id, execution: { userId: user.id }, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'INTERVENTION', result: { ok: false, message: 'Ejecución interrumpida sin resultado confirmado. Verifica el registro original antes de repetir.' }, completedAt: new Date() } });
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  return { id: row.id, status: executionStatus(row), createdAt: row.createdAt, expiresAt: row.expiresAt, cancelledAt: row.cancelledAt,
    steps: row.steps.map(s => ({ action: s.action, status: s.status, result: s.result, startedAt: s.startedAt, completedAt: s.completedAt })),
    href: `/fronti/procedimientos?ejecucion=${row.id}` };
}

export async function executionCard(id: string) {
  const user = await executionActor();
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  const lines = row.steps.map((s, i) => {
    const definition = actionDefinition(s.action);
    const fields = openSecret((s.fields as { sealed: string }).sealed, purpose(user.id));
    if (!fields) throw new RuleError('No se pudo leer el procedimiento. Prepara una nueva solicitud.');
    return `${i + 1}. ${definition.label}\n${Object.entries(JSON.parse(fields)).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}${definition.physical ? '\nLa confirmación declara únicamente los hechos físicos que tú has comprobado.' : ''}`;
  });
  return { token: `fronti-plan:${id}`, title: 'Procedimiento preparado', risk: 'high' as const,
    detail: lines.join('\n\n') + '\n\nSe ejecutará en tu nombre, conservando los permisos y aprobaciones del procedimiento. Los pasos completados no se deshacen al cancelar. Vigencia: 15 minutos.' };
}

export async function cancelExecution(id: string) {
  const user = await executionActor();
  return prisma.$transaction(async tx => {
    const changed = await tx.frontiExecution.updateMany({ where: { id, userId: user.id, cancelledAt:null, steps:{some:{status:{in:['PENDING','RUNNING']}}} }, data: { cancelledAt: new Date(), status: 'CANCELLED' } });
    if (!changed.count) throw new RuleError('No hay pasos pendientes que puedas cancelar en este procedimiento.');
    await tx.frontiExecutionStep.updateMany({ where: { executionId: id, status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } });
    await tx.auditLog.create({data:{entity:'FrontiExecution',entityId:id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:'Fronti: cancelar pasos pendientes sin revertir efectos.'}});
    // A RUNNING step has crossed the commit boundary: cancellation is deliberately not advertised as undo.
    return { message: 'Pasos pendientes cancelados. Un paso ya iniciado puede terminar; revisa su resultado.' };
  });
}

export async function executePlan(id: string, authorize: boolean) {
  let user = await executionActor();
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  if (row.cancelledAt || row.expiresAt <= new Date()) throw new RuleError('La autorización fue cancelada o caducó.');
  if (!row.authorizedAt && !authorize) throw new RuleError('Este procedimiento todavía necesita autorización.');
  if (authorize && !row.authorizedAt) await prisma.frontiExecution.updateMany({ where: { id, userId: user.id, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { authorizedAt: new Date(), status: 'AUTHORIZED' } });

  for (const step of row.steps) {
    if (step.status === 'SUCCEEDED') continue;
    if (step.status !== 'PENDING') break; // unknown outcomes are NEVER blindly retried
    user = await executionActor();
    if (user.id !== row.userId) throw new ForbiddenError();
    const claim = await prisma.frontiExecutionStep.updateMany({ where: {
      id: step.id, status: 'PENDING', execution: { userId: user.id, authorizedAt: { not: null }, cancelledAt: null, expiresAt: { gt: new Date() } },
    }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claim.count) break;
    const value = openSecret((step.fields as { sealed: string }).sealed, purpose(user.id));
    try {
      if (!value) throw new RuleError('No se pudo leer el procedimiento autorizado.');
      const command: FrontiStep = { action: step.action, fields: JSON.parse(value) };
      if (step.revision !== null && step.revision !== await revisionForStep(command)) {
        await prisma.frontiExecutionStep.update({ where: { id: step.id }, data: { status: 'CHANGED', result: { ok: false, message: 'El registro cambió después de preparar la acción. Revisa el nuevo estado y autoriza una propuesta actualizada.' }, completedAt: new Date() } });
        break;
      }
      const result = await invokeNativeAction(command, step.revision);
      // Native actions may commit before a post-commit error. Conservatively stop on every failure.
      const status = result.ok ? 'SUCCEEDED' : 'INTERVENTION';
      const safeResult = result.ok ? { ok: true, message: result.message.slice(0,2000), id: result.id ?? null } : { ok: false, message: result.error };
      await prisma.$transaction(async tx => {
        await tx.frontiExecutionStep.update({ where: { id: step.id }, data: { status, result: safeResult, completedAt: new Date() } });
        await tx.auditLog.create({ data: { entity: 'FrontiExecution', entityId: id, action: 'EDITAR', userId: user.id, sessionId: user.sessionId,
          summary: `Fronti: ${step.action} · ${status}`, after: { position: step.position, requestKey: row.requestKey, authorization: row.instruction, result: safeResult },
        } });
      });
      if (!result.ok) break;
    } catch {
      await prisma.frontiExecutionStep.update({ where: { id: step.id }, data: { status: 'INTERVENTION', result: { ok: false, message: 'Resultado no confirmado. Revisa el registro original antes de repetir; pueden existir efectos guardados.' }, completedAt: new Date() } });
      break;
    }
  }
  const latest = await prisma.frontiExecution.findUniqueOrThrow({ where: { id }, include: { steps: true } });
  const status = executionStatus(latest);
  await prisma.frontiExecution.update({ where: { id }, data: { status } });
  return readExecution(id);
}

export function newExecutionKey() { return randomUUID(); }
