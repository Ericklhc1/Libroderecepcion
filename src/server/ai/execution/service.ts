import 'server-only';
import type { ActionState } from '@/server/action';
import { dynamicDelegationSchema } from '@/domain/fronti-delegation';
import { assertDynamicSteps, validateDynamicCatalog } from './delegation-scope';
import { revisionForStep } from './revision';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sealSecret, openSecret } from '@/lib/secret-box';
import { requireUser } from '@/server/auth/guard';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { canUseFronti } from '@/server/ai/fronti-access';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import { canonicalJson, executionStatus, frontiPlanSchema, frontiDelegationSchema, type FrontiStep } from '@/domain/fronti-execution';
import { actionDefinition, invokeNativeAction, validateStep } from './catalog';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const purpose = (userId: string) => `fronti-execution:${userId}`;

export async function executionActor() {
  const user = await requireUser(); // fresh session and permissions, including every resumed step
  if (!canUseFronti(user, (await getFrontiConfig()).enabled)) throw new ForbiddenError();
  return user;
}

export async function prepareExecution(input: unknown) {
  return prepareFiniteExecution(input);
}

/** Called only by an explicit authenticated command, never by a model tool. */
export async function createDelegation(input: unknown) {
  const parsed = frontiDelegationSchema.parse(input);
  const availableAt = new Date(parsed.availableAt), expiresAt = new Date(parsed.expiresAt);
  if (expiresAt <= new Date() || availableAt.getTime() > Date.now() + 31 * 86400000) throw new RuleError('La delegación debe tener vigencia futura y comenzar dentro de los próximos 31 días.');
  return prepareFiniteExecution({ requestKey: parsed.requestKey, instruction: parsed.instruction, steps: parsed.steps }, { objective: parsed.objective, availableAt, expiresAt });
}

async function prepareFiniteExecution(input: unknown, delegation?: { objective: string; availableAt: Date; expiresAt: Date }, parentDelegationId?: string) {
  const user = await executionActor();
  const plan = frontiPlanSchema.parse(input);
  const steps = plan.steps.map(validateStep);
  if(steps.some((step,index)=>step.action==='logoutAction'&&index!==steps.length-1))throw new RuleError('Cerrar sesión debe ser el último paso del procedimiento.');
  for (const step of steps) {
    if(step.action==='updateRolePermissionsAction') {
      if(!user.permissions.includes('role.manage'))throw new ForbiddenError();
      const before=await prisma.rolePermission.findMany({where:{roleId:String(step.fields.roleId)},include:{permission:true}});
      const keys=before.map(p=>p.permission.key).sort(), approvals=before.filter(p=>p.requiresApproval).map(p=>p.permission.key).sort();
      if(canonicalJson(keys)!==canonicalJson([...(step.fields.permissionsBefore as string[])].sort())||canonicalJson(approvals)!==canonicalJson([...(step.fields.approvalRequiredBefore as string[])].sort()))throw new RuleError('La matriz previa no coincide con el rol. Consulta su estado y presenta antes y después completos.');
    }
    if(step.action==='updateUserAction'&&!user.permissions.includes('user.manage'))throw new ForbiddenError();
  }
  const fingerprint = digest({ instruction: plan.instruction, steps, ...(parentDelegationId ? { parentDelegationId } : {}), ...(delegation ? { delegation: { ...delegation, availableAt: delegation.availableAt.toISOString(), expiresAt: delegation.expiresAt.toISOString() } } : {}) });
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
    let reservedMinorUnits=0;
    let parentExpiry:Date|undefined;
    if(parentDelegationId){
      const parent=await tx.frontiExecution.findFirst({where:{id:parentDelegationId,userId:user.id,authorizationKind:'DYNAMIC',cancelledAt:null,expiresAt:{gt:new Date()},availableAt:{lte:new Date()}},include:{steps:true}});
      if(!parent?.delegationPolicy)throw new RuleError('Delegación revocada, caducada o no vigente.');
      const policy=dynamicDelegationSchema.parse(JSON.parse(openSecret(parent.delegationPolicy,purpose(user.id))??'{}'));
      for(const anchor of parent.steps)if(anchor.revision!==null){const fields=JSON.parse(openSecret((anchor.fields as {sealed:string}).sealed,purpose(user.id))??'{}');if(anchor.revision!==await revisionForStep({action:anchor.action,fields}))throw new RuleError('Un registro fijo cambió desde la autorización. Prepara otra delegación con el nuevo alcance.');}
      const uses=await tx.frontiExecution.findMany({where:{parentDelegationId},select:{reservedMinorUnits:true,steps:{select:{status:true}}}});
      if(uses.some(use=>use.steps.some(step=>['INTERVENTION','CHANGED','RUNNING'].includes(step.status))))throw new RuleError('Hay una ejecución pendiente de revisión. No se amplía el mandato hasta resolverla.');
      if(uses.length>=policy.maxExecutions||uses.reduce((sum,use)=>sum+use.steps.length,0)+steps.length>policy.maxActions)throw new RuleError('Se alcanzó el límite acumulado de usos o acciones.');
      reservedMinorUnits=await assertDynamicSteps(user,policy,steps,tx);
      if(policy.budget&&uses.reduce((sum,use)=>sum+use.reservedMinorUnits,0)+reservedMinorUnits>policy.budget.maxMinorUnits)throw new RuleError('Se excede el presupuesto acumulado delegado.');
      parentExpiry=parent.expiresAt;
    }
    const created = await tx.frontiExecution.create({ data: {
      requests: {create:{userId:user.id,requestKey:plan.requestKey}},
      userId: user.id, sessionId: user.sessionId, requestKey: plan.requestKey, fingerprint,
      instruction: digest(plan.instruction), ...(parentDelegationId?{parentDelegationId,reservedMinorUnits,authorizationKind:'DELEGATED_USE',authorizedAt:new Date(),status:'AUTHORIZED'}:{}), expiresAt: parentExpiry ?? delegation?.expiresAt ?? new Date(Date.now() + 15 * 60_000),
      ...(delegation ? { authorizationKind: 'DELEGATION', availableAt: delegation.availableAt, objective: sealSecret(delegation.objective, purpose(user.id)), authorizedAt: new Date(), status: 'AUTHORIZED' } : {}),
      steps: { create: steps.map((step, position) => ({ position, revision: revisions[position], action: step.action, fields: { sealed: sealSecret(JSON.stringify(step.fields), purpose(user.id)) } })) },
    } });
    if (parentDelegationId) await tx.auditLog.create({data:{entity:'FrontiExecution',entityId:created.id,userId:user.id,sessionId:user.sessionId,action:'CREAR',summary:'Fronti: uso de delegación dinámica; límites reservados sin devolución automática.',after:{parentDelegationId,reservedMinorUnits,actions:steps.length,requestKey:plan.requestKey}}});
    if (delegation) await tx.auditLog.create({ data: { entity: 'FrontiExecution', entityId: created.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId,
      summary: 'Fronti: delegación finita autorizada; sin ejecutar pasos.', after: { authorization: created.instruction, requestKey: plan.requestKey, fingerprint, availableAt: delegation.availableAt.toISOString(), expiresAt: delegation.expiresAt.toISOString(), actions: steps.map(step => step.action), maxActions: steps.length } } });
    return created;
  });
}

export async function readExecution(id: string) {
  const user = await executionActor();
  await prisma.frontiExecutionStep.updateMany({ where: { executionId: id, execution: { userId: user.id }, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'INTERVENTION', result: { ok: false, message: 'Ejecución interrumpida sin resultado confirmado. Verifica el registro original antes de repetir.' }, completedAt: new Date() } });
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  return { id: row.id, status: row.authorizationKind==='DYNAMIC' ? row.cancelledAt?'CANCELLED':'AUTHORIZED' : executionStatus(row), createdAt: row.createdAt, expiresAt: row.expiresAt, cancelledAt: row.cancelledAt,
    delegationPolicy: row.delegationPolicy ? dynamicDelegationSchema.parse(JSON.parse(openSecret(row.delegationPolicy,purpose(user.id))??'{}')) : null, parentDelegationId: row.parentDelegationId, authorizationKind: row.authorizationKind, availableAt: row.availableAt, objective: row.objective ? openSecret(row.objective, purpose(user.id)) : null,
    steps: (row.authorizationKind==='DYNAMIC'?[]:row.steps).map(s => ({ action: s.action, label: actionDefinition(s.action).label, status: s.status, result: s.result, startedAt: s.startedAt, completedAt: s.completedAt,
      requiresProtectedInput: actionDefinition(s.action).protectedInputs.length > 0 || actionDefinition(s.action).protectedOutput,
      parameters: JSON.parse(openSecret((s.fields as { sealed: string }).sealed, purpose(user.id)) ?? '{}') as Record<string, string | string[]> })),
    href: `/fronti/procedimientos?ejecucion=${row.id}` };
}

export async function executionCard(id: string) {
  const user = await executionActor();
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  if (row.authorizationKind === 'DELEGATION') throw new RuleError('La delegación ya contiene una autorización explícita; consulta su vigencia y sus pasos.');
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
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'fronti-plan:' + user.id}))::text`;
    const changed = await tx.frontiExecution.updateMany({ where: { id, userId: user.id, cancelledAt:null, OR:[{authorizationKind:'DYNAMIC'},{steps:{some:{status:{in:['PENDING','RUNNING']}}}}] }, data: { cancelledAt: new Date(), status: 'CANCELLED' } });
    if (!changed.count) {
      // Concurrent retries observe the committed cancellation without another audit/effect.
      const cancelled = await tx.frontiExecution.findFirst({ where: { id, userId: user.id, cancelledAt: { not: null } }, select: { id: true } });
      if (cancelled) return { message: 'Autorización ya cancelada. El historial y los efectos realizados se conservan.' };
      throw new RuleError('No hay pasos pendientes que puedas cancelar en este procedimiento.');
    }
    await tx.frontiExecution.updateMany({where:{parentDelegationId:id,cancelledAt:null},data:{cancelledAt:new Date(),status:'CANCELLED'}});
    await tx.frontiExecutionStep.updateMany({ where: { OR:[{executionId:id},{execution:{parentDelegationId:id}}], status: 'PENDING' }, data: { status: 'CANCELLED', completedAt: new Date() } });
    await tx.auditLog.create({data:{entity:'FrontiExecution',entityId:id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:'Fronti: cancelar pasos pendientes sin revertir efectos.'}});
    // A RUNNING step has crossed the commit boundary: cancellation is deliberately not advertised as undo.
    return { message: 'Pasos pendientes cancelados. Un paso ya iniciado puede terminar; revisa su resultado.' };
  });
}

export async function executePlan(id: string, authorize: boolean, protectedStep?: {position: number; form: FormData; receiveResult: (result: ActionState) => void}) {
  let user = await executionActor();
  const row = await prisma.frontiExecution.findFirst({ where: { id, userId: user.id }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!row) throw new NotFoundError();
  if(row.authorizationKind==='DYNAMIC')throw new RuleError('Indica las acciones concretas para usar esta delegación.');
  if (row.cancelledAt || row.expiresAt <= new Date()) throw new RuleError('La autorización fue cancelada o caducó.');
  if (row.availableAt && row.availableAt > new Date()) throw new RuleError('La delegación todavía no está vigente. No se ha ejecutado ningún paso.');
  if (!row.authorizedAt && !authorize) throw new RuleError('Este procedimiento todavía necesita autorización.');
  if (authorize && !row.authorizedAt) await prisma.frontiExecution.updateMany({ where: { id, userId: user.id, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { authorizedAt: new Date(), status: 'AUTHORIZED' } });

  for (const step of row.steps) {
    if (step.status === 'SUCCEEDED') continue;
    if (step.status !== 'PENDING') break; // unknown outcomes are NEVER blindly retried
    const definition = actionDefinition(step.action);
    const protectedRequired = definition.protectedInputs.length > 0 || definition.protectedOutput;
    if (protectedStep && protectedStep.position !== step.position) break;
    if (protectedRequired && !protectedStep) break; // Wait for private form; no effect or failed attempt.
    if(row.parentDelegationId){
      const parent=await prisma.frontiExecution.findFirst({where:{id:row.parentDelegationId,userId:row.userId,cancelledAt:null,expiresAt:{gt:new Date()},availableAt:{lte:new Date()}}});
      if(!parent?.delegationPolicy)throw new RuleError('La delegación ya no está vigente.');
      const fields=JSON.parse(openSecret((step.fields as {sealed:string}).sealed,purpose(row.userId))??'{}');
      await prisma.$transaction(tx=>assertDynamicSteps(user,dynamicDelegationSchema.parse(JSON.parse(openSecret(parent.delegationPolicy!,purpose(row.userId))??'{}')),[{action:step.action,fields}],tx));
    }
    user = await executionActor();
    if (user.id !== row.userId) throw new ForbiddenError();
    const claim = await prisma.frontiExecutionStep.updateMany({ where: {
      id: step.id, status: 'PENDING', execution: { ...(row.parentDelegationId?{parentDelegation:{cancelledAt:null,expiresAt:{gt:new Date()}}}:{}), userId: user.id, authorizedAt: { not: null }, cancelledAt: null, expiresAt: { gt: new Date() }, OR: [{ availableAt: null }, { availableAt: { lte: new Date() } }] },
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
      const result = await invokeNativeAction(command, step.revision, protectedStep?.form, protectedStep?.receiveResult);
      // Native actions may commit before a post-commit error. Conservatively stop on every failure.
      const status = result.ok ? 'SUCCEEDED' : 'INTERVENTION';
      const actionModule=actionDefinition(step.action).module;
      const href=result.ok&&result.id&&(actionModule==='tasks'||actionModule==='entries')?`${actionModule==='tasks'?'/tareas':'/libro'}/${result.id}`:undefined;
      const safeResult = result.ok ? { ok: true, message: result.message.slice(0,2000), id: result.id ?? null, ...(href?{href}:{}) } : { ok: false, message: result.error };
      await prisma.$transaction(async tx => {
        await tx.frontiExecutionStep.update({ where: { id: step.id }, data: { status, result: safeResult, completedAt: new Date() } });
        // Only advance snapshots for the same record using the native committed row.
        // An external edit after that commit still fails the next preflight/CAS.
        if(result.ok && result.committedRevision && step.revision && result.id===command.fields.id && ['tasks','entries','followups'].includes(actionModule)){
          for(const pending of row.steps.filter(candidate=>candidate.position>step.position&&candidate.status==='PENDING'&&candidate.revision===step.revision)){
            if(actionDefinition(pending.action).module!==actionModule)continue;
            const fields=JSON.parse(openSecret((pending.fields as {sealed:string}).sealed,purpose(user.id))??'{}');
            if(fields.id!==result.id)continue;
            const advanced=await tx.frontiExecutionStep.updateMany({where:{id:pending.id,status:'PENDING',revision:step.revision},data:{revision:result.committedRevision}});
            if(advanced.count)pending.revision=result.committedRevision;
          }
        }
        await tx.auditLog.create({ data: { entity: 'FrontiExecution', entityId: id, action: 'EDITAR', userId: user.id, sessionId: user.sessionId,
          summary: `Fronti: ${step.action} · ${status}`, after: { position: step.position, requestKey: row.requestKey, authorization: row.instruction, authorizationKind: row.authorizationKind, result: safeResult },
        } });
      });
      if (!result.ok || protectedStep) break; // Protected request executes exactly the displayed step.
    } catch (error) {
      if(step.action==='logoutAction'&&error&&typeof error==='object'&&'digest' in error&&typeof error.digest==='string'&&error.digest.startsWith('NEXT_REDIRECT;')){
        await prisma.$transaction(async tx=>{
          await tx.frontiExecutionStep.update({where:{id:step.id},data:{status:'SUCCEEDED',result:{ok:true,message:'Sesión cerrada mediante el procedimiento original.'},completedAt:new Date()}});
          await tx.frontiExecution.update({where:{id},data:{status:'SUCCEEDED'}});
          await tx.auditLog.create({data:{entity:'FrontiExecution',entityId:id,action:'EDITAR',userId:user.id,sessionId:user.sessionId,summary:'Fronti: cierre de sesión completado.',after:{position:step.position,requestKey:row.requestKey,authorization:row.instruction}}});
        });
        throw error;
      }
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

/** Explicit authenticated creation only. Model tools cannot grant a mandate. */
export async function createDynamicDelegation(raw:unknown){
  const user=await executionActor();
  const policy=dynamicDelegationSchema.parse(raw);
  validateDynamicCatalog(policy);
  if(new Date(policy.expiresAt)<=new Date()||Date.parse(policy.availableAt)>Date.now()+31*86400000)throw new RuleError('Define una vigencia futura de hasta 31 días.');
  const fingerprint=digest({...policy,requestKey:undefined});
  const anchors=await Promise.all(policy.rules.map(async(rule,position)=>({position,action:rule.action,fields:{sealed:sealSecret(JSON.stringify(rule.fixedFields),purpose(user.id))},revision:await revisionForStep({action:rule.action,fields:rule.fixedFields})})));
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'fronti-plan:' + user.id}))::text`;
    const alias=await tx.frontiExecutionRequest.findUnique({where:{userId_requestKey:{userId:user.id,requestKey:policy.requestKey}},include:{execution:true}});
    const prior=alias?.execution??await tx.frontiExecution.findUnique({where:{userId_requestKey:{userId:user.id,requestKey:policy.requestKey}}});
    if(prior){if(prior.fingerprint!==fingerprint)throw new RuleError('El reintento modifica la autorización.');return prior;}
    const duplicate=await tx.frontiExecution.findFirst({where:{userId:user.id,fingerprint,authorizationKind:'DYNAMIC',cancelledAt:null,createdAt:{gte:new Date(Date.now()-5*60000)}}});
    if(duplicate){await tx.frontiExecutionRequest.create({data:{userId:user.id,requestKey:policy.requestKey,executionId:duplicate.id}});return duplicate;}
    const row=await tx.frontiExecution.create({data:{requests:{create:{userId:user.id,requestKey:policy.requestKey}},steps:{create:anchors},userId:user.id,sessionId:user.sessionId,requestKey:policy.requestKey,fingerprint,instruction:digest(policy.instruction),authorizationKind:'DYNAMIC',delegationPolicy:sealSecret(JSON.stringify(policy),purpose(user.id)),objective:sealSecret(policy.objective,purpose(user.id)),availableAt:new Date(policy.availableAt),expiresAt:new Date(policy.expiresAt),authorizedAt:new Date(),status:'AUTHORIZED'}});
    await tx.auditLog.create({data:{entity:'FrontiExecution',entityId:row.id,userId:user.id,sessionId:user.sessionId,action:'CREAR',summary:'Fronti: delegación dinámica explícita; no ejecutada.',after:{authorization:row.instruction,requestKey:policy.requestKey,maxActions:policy.maxActions,maxExecutions:policy.maxExecutions,budget:policy.budget??null,actions:policy.rules.map(rule=>rule.action)}}});
    return row;
  });
}
export async function executeDelegatedPlan(id:string,input:unknown){
  const plan=await prepareFiniteExecution(input,undefined,id);
  return executePlan(plan.id,false);
}
