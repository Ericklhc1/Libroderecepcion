import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS, type PermissionKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, RuleError } from '@/server/errors';
import { procedureOccurrences, procedureSchema, escalationSchema, substitutionSchema, matchesAutomation } from '@/domain/operational-automation';
import { isHkFocused } from '@/domain/housekeeping-work';
import { canonicalJson } from '@/domain/fronti-execution';
import { createTask } from './tasks';
import { getCoordinationBoard, coordinationMetrics, type CoordinationRow } from './coordination';
import { coordinationEntries, coordinationTasks, coordinationFollowUps } from './coordination-access';
import { hkWorkVisibility, hkCapability } from './housekeeping-work';
import { hasAcceptedCurrentTerms } from './legal-acceptance';
import { assertReceptionOperationPermission } from './reception-operation-gate';
import { chooseSubstitute, applySubstitution } from './automation-substitutions';
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
  kind: z.enum(['PROCEDURE','ESCALATION','SUBSTITUTION']), configuration: z.unknown(),
  expiresAt: z.coerce.date(), enabled: z.boolean().default(false),
}).strict().refine(input=>!input.id||input.version!==undefined,{message:'La versión vigente es obligatoria al modificar una política.'});
export async function saveAutomation(user: CurrentUser, raw: unknown) {
  const input = automationInput.parse(raw);
  await assertPolicyArea(user, input.departmentId);
  if (input.expiresAt <= new Date() || input.expiresAt.getTime() > Date.now() + 366 * 86400000) throw new RuleError('Define una vigencia futura de hasta un año.');
  const configuration = input.kind === 'PROCEDURE' ? procedureSchema.parse(input.configuration) : input.kind==='SUBSTITUTION'?substitutionSchema.parse(input.configuration):escalationSchema.parse(input.configuration);
  return prisma.$transaction(async tx => {
    if(input.kind==='ESCALATION'&&input.enabled){
      const config=escalationSchema.parse(configuration);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.departmentId+':'+config.trigger}))::text`;
      const overlaps=await tx.operationalAutomation.findMany({where:{id:{not:input.id??''},departmentId:input.departmentId,kind:'ESCALATION',enabled:true,revokedAt:null,expiresAt:{gt:new Date()}},select:{configuration:true}});
      if(overlaps.some(p=>{const other=escalationSchema.parse(p.configuration);return other.trigger===config.trigger&&(!other.kind||!config.kind||other.kind===config.kind)&&(!other.priority||!config.priority||other.priority===config.priority)}))throw new RuleError('Ya existe una regla habilitada para esta condición, tipo y prioridad del área. Pausa o acota su alcance antes de habilitar otra.');
    }
    if(input.kind==='SUBSTITUTION'&&input.enabled){
      const config=substitutionSchema.parse(configuration);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.departmentId+':substitution'}))::text`;
      const existing=await tx.operationalAutomation.findMany({where:{id:{not:input.id??''},departmentId:input.departmentId,kind:'SUBSTITUTION',enabled:true,revokedAt:null,expiresAt:{gt:new Date()}},select:{configuration:true}});
      if(existing.some(row=>{const other=substitutionSchema.parse(row.configuration);return other.kind===config.kind&&(!other.priority||!config.priority||other.priority===config.priority);}))throw new RuleError('Ya existe una suplencia habilitada para este tipo y prioridad del área. Pausa o delimita la anterior.');
    }
    const data = { name: input.name, departmentId: input.departmentId, kind: input.kind, configuration: json(configuration), expiresAt: input.expiresAt, enabled: input.enabled, scanPage: 1 };
    let id = input.id;
    if (id) {
      const updated = await tx.operationalAutomation.updateMany({ where: { id, ownerId: user.id, version: input.version, revokedAt: null }, data: { ...data, version: { increment: 1 } } });
      if (!updated.count) throw new RuleError('La política cambió o pertenece a otra persona.');
    } else id = (await tx.operationalAutomation.create({ data: { ...data, ownerId: user.id } })).id;
    await tx.auditLog.create({ data: { entity: 'OperationalAutomation', entityId: id, userId: user.id, sessionId: user.sessionId, action: 'CONFIGURAR', summary: `${input.enabled ? 'Habilitar' : 'Pausar'} política: ${input.name}`, after: data } });
    return { id };
  });
}
export async function revokeAutomation(user: CurrentUser, id: string, version: number) {
  return prisma.$transaction(async tx => {
  const changed = await tx.operationalAutomation.updateMany({ where: { id, ownerId: user.id, version, revokedAt: null }, data: { revokedAt: new Date(), enabled: false, version: { increment: 1 } } });
  if (!changed.count) throw new RuleError('No puedes revocar esta política.');
  await tx.auditLog.create({ data: { entity: 'OperationalAutomation', entityId: id, userId: user.id, sessionId: user.sessionId, action: 'CONFIGURAR', summary: 'Política revocada. Se conserva el historial.' } });
  });
}

/** Every page is read through the original access-filtered board. Bound and label incomplete scans. */
export async function automationBoard(user: CurrentUser, departmentId?: string, startPage = 1, deadlineAt = Infinity) {
  const rows: CoordinationRow[] = [];
  let complete = false, nextPage = startPage;
  for (let page = startPage; page < startPage + 10; page++) {
    if(Date.now()>=deadlineAt)break;
    const board = await getCoordinationBoard(user, { departmentId, page });
    rows.push(...board.rows);
    nextPage = board.hasMore ? page + 1 : 1;
    if (!board.hasMore) { complete = startPage === 1; break; }
  }
  return { rows, complete, nextPage };
}
async function sameAreaUser(id: string, departmentId: string) {
  return prisma.user.findFirst({ where: { id, active: true, deletedAt: null, role: { operational: true }, OR: [{ departmentId }, { scheduleCollaborator: { active: true, memberships: { some: { departmentId, active: true } } } }] }, select: { id: true, name: true } });
}

async function procedureAssignee(id:string,departmentId:string) {
  const member=await sameAreaUser(id,departmentId);
  if(!member)return null;
  const user=await prisma.user.findUnique({where:{id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  if(!user||isHkFocused({roleKey:user.role.key,permissions:user.role.permissions.map(p=>p.permission.key as PermissionKey)}))return null;
  return member;
}

export async function simulateAutomation(user: CurrentUser, id: string, now = new Date(), deadlineAt = Infinity) {
  const policy = await prisma.operationalAutomation.findFirst({ where: { id, ownerId: user.id } });
  if (!policy) throw new ForbiddenError();
  await assertPolicyArea(user, policy.departmentId);
  if (policy.kind === 'PROCEDURE') {
    const config = procedureSchema.parse(policy.configuration);
    const eligible = await procedureAssignee(config.ownerId, policy.departmentId);
    return { mode: 'SIMULATION', version: policy.version, complete: true, effects: procedureOccurrences(config, now).map(o => ({ occurrence: o.key, dueAt: new Date(o.at.getTime() + config.deadlineMinutes * 60000), ownerId: config.ownerId, responsible: eligible?.name ?? config.ownerId, eligible: !!eligible, action: 'CREATE_TASK' })), explanation: 'Crea una tarea y su lista mediante el servicio existente. Sin ejecución física ni inspección automática. No modifica datos operativos.' };
  }
  if(policy.kind==='SUBSTITUTION'){
    const config=substitutionSchema.parse(policy.configuration);
    const board=await automationBoard(user,policy.departmentId,policy.scanPage,deadlineAt);
    const matched=board.rows.filter(row=>matchesAutomation(row,{trigger:config.trigger,kind:config.kind,priority:config.priority,receiptMinutes:config.receiptMinutes,recipientId:policy.ownerId,maxItems:config.maxItems},now));
    const done=await prisma.operationalAutomationRun.findMany({where:{policyId:policy.id,status:'SUCCEEDED',stateKey:{in:matched.map(row=>'substitution:'+row.kind+':'+row.id)}},select:{stateKey:true}});
    const pending=matched.filter(row=>!done.some(run=>run.stateKey==='substitution:'+row.kind+':'+row.id));
    const effects=[];
    for(const row of pending.slice(0,config.maxItems)){
      const selected=await chooseSubstitute(user,policy.departmentId,config,row,now);
      const retryKey='substitution:'+row.kind+':'+row.id;
      effects.push({id:row.id,kind:row.kind,retryKey,attemptKey:retryKey+':'+policy.version+':'+row.updatedAt.toISOString(),revision:row.updatedAt.toISOString(),href:row.href,nextAction:config.nextAction,ownerId:row.ownerId,substituteId:selected?.id??null,recipientId:policy.ownerId,responsible:selected?.name??'Sin suplente elegible',title:row.title,eligible:!!selected,action:config.mode});
    }
    return {mode:'SIMULATION',version:policy.version,complete:board.complete&&pending.length<=config.maxItems,nextPage:pending.length>config.maxItems?policy.scanPage:board.nextPage,effects,explanation:`${config.mode==='APPLY'?'Reasigna':'Propone reasignar'} sólo a candidatos explícitos elegibles del área. Horario publicado es planificación, no presencia. Una suplencia confirmada por registro y política evita bucles; pausar o revocar impide efectos nuevos.`};
  }
  const config = escalationSchema.parse(policy.configuration);
  const board = await automationBoard(user, policy.departmentId, policy.scanPage, deadlineAt);
  const recipient = await sameAreaUser(config.recipientId, policy.departmentId);
  const matched=board.rows.filter(r => matchesAutomation(r, config, now)).map(r=>({...r,retryKey:createHash('sha256').update(canonicalJson({kind:r.kind,id:r.id,trigger:config.trigger,recipientId:config.recipientId,ownerId:r.ownerId,assignedAt:r.assignedAt?.toISOString(),receivedAt:r.receivedAt?.toISOString(),dueAt:r.dueAt?.toISOString(),status:r.status,priority:r.priority,nextAction:r.nextAction})).digest('hex')}));
  const attemptKey=(r: (typeof matched)[number])=>r.retryKey+':'+r.updatedAt.toISOString();
  const seen=await prisma.operationalAutomationRun.findMany({where:{policyId:policy.id,OR:[{status:'SUCCEEDED',stateKey:{in:matched.map(r=>r.retryKey)}},{occurrence:{in:matched.map(attemptKey)}}]},select:{occurrence:true,stateKey:true,status:true}});
  const done=new Set(seen.filter(r=>r.status==='SUCCEEDED').map(r=>r.stateKey)), attempts=new Set(seen.map(r=>r.occurrence)), pending=matched.filter(r=>!done.has(r.retryKey)&&!attempts.has(attemptKey(r)));
  return { mode: 'SIMULATION', version: policy.version, complete: board.complete && pending.length<=config.maxItems, nextPage:pending.length>config.maxItems?policy.scanPage:board.nextPage, matchesObserved:matched.length, effects: pending.slice(0, config.maxItems).map(r => ({ id: r.id, kind: r.kind, retryKey:r.retryKey, attemptKey:attemptKey(r), revision: r.updatedAt.toISOString(), href: r.href, nextAction: r.nextAction, recipientId: config.recipientId, responsible: recipient?.name ?? config.recipientId, title: r.title, eligible: !!recipient, action: 'NOTIFY' })), explanation: 'Escala el registro original al destinatario del área sólo si conserva acceso. Sin responsable y asignado sin recibir son condiciones distintas. No genera incidencias nuevas.' };
}

/** Called only by the existing operational cron. No provider, push or Actions dependency. */
export async function runOperationalAutomations(now = new Date(), deadlineAt = Date.now() + 30_000) {
  if (process.env.AROH_AUTOMATION_EXECUTION_ENABLED !== 'true') return { enabled: false, attempted: 0, failed: 0 };
  const policies = await prisma.operationalAutomation.findMany({ where: { enabled: true, revokedAt: null, expiresAt: { gt: now } }, orderBy: [{ lastEvaluatedAt: { sort:'asc',nulls:'first' } },{id:'asc'}], take: 20 });
  let attempted = 0, failed = 0, scanned = 0, deferred = false;
  for (const policy of policies) {
    if (scanned >= 25 || Date.now() + 15_000 >= deadlineAt) { deferred = true; break; }
    try {
      const actor = await automationPrincipal(policy.ownerId, policy.id);
      const simulation = await simulateAutomation(actor, policy.id, now, deadlineAt - 15_000);
      for (const effect of simulation.effects) {
        if (scanned >= 25 || Date.now() + 15_000 >= deadlineAt) { deferred = true; break; }
        scanned++;
        if (!effect.eligible) throw new RuleError('No hay responsable o destinatario elegible en el área. La política se pausa para intervención.');
        const occurrence = 'occurrence' in effect ? effect.occurrence : effect.attemptKey;
        const stateKey = 'occurrence' in effect ? effect.occurrence : effect.retryKey;
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "OperationalAutomation" WHERE "id"=${policy.id} FOR UPDATE`;
          const live = await tx.operationalAutomation.findFirst({ where: { id: policy.id, version: policy.version, enabled: true, revokedAt: null, expiresAt: { gt: new Date() } } });
          if (!live) return;
          const executor=await automationPrincipal(policy.ownerId,policy.id);
          await assertPolicyArea(executor,policy.departmentId);
          if (await tx.operationalAutomationRun.findFirst({where:{policyId:policy.id,OR:[{occurrence},{stateKey,status:'SUCCEEDED'}]}})) return;
          const run = await tx.operationalAutomationRun.create({ data: { policyId: policy.id, occurrence, stateKey, policyVersion: policy.version, snapshot: json(policy.configuration), status: 'RUNNING' } });
          let result: unknown;
          if (policy.kind === 'PROCEDURE') {
            const config = procedureSchema.parse(policy.configuration);
            if (!executor.permissions.includes('task.create') || !executor.permissions.includes('task.assign')) throw new ForbiddenError();
            await assertReceptionOperationPermission(executor, 'task.create');
            if (!await procedureAssignee(config.ownerId, policy.departmentId)) throw new ForbiddenError('Responsable no elegible para tareas generales del área; el trabajo exclusivo de Housekeeping utiliza sus rutinas nativas.');
            const date = procedureOccurrences(config, now).find(o => o.key === occurrence)!;
            const task = await createTask(executor, { title: config.title, description: config.description, assigneeId: config.ownerId, departmentId: policy.departmentId, priority: config.priority, startsAt: date.at, dueAt: new Date(date.at.getTime() + config.deadlineMinutes * 60000), fulfillmentCriteria: config.nextAction, evidenceRequired: config.evidenceRequired, checklist: config.checklist, tags: ['procedimiento'], requiresIndependentValidation: config.requiresIndependentValidation, procedureOccurrenceKey: `${policy.id}:${occurrence}` }, tx);
            result = { taskId: task.id, href: `/tareas/${task.id}` };
          } else if(policy.kind==='SUBSTITUTION' && 'substituteId' in effect){
            result=await applySubstitution(executor,policy.departmentId,policy.configuration,effect,run.id,now,tx);
          } else if ('id' in effect) {
            const config = escalationSchema.parse(policy.configuration);
            const recipient = await automationPrincipal(config.recipientId, policy.id);
            if(!await sameAreaUser(recipient.id,policy.departmentId))throw new ForbiddenError('Destinatario fuera del área.');
            const canEscalate=effect.kind==='housekeeping'?await hkCapability(recipient,policy.departmentId,'housekeeping.assign',tx):recipient.permissions.includes(effect.kind==='entry'?'entry.edit':effect.kind==='task'?'task.assign':'supervision.followup.manage');
            if(!canEscalate)throw new ForbiddenError('El destinatario no conserva autoridad de coordinación para este trabajo.');
            const revision=new Date(effect.revision);
            const unchanged=effect.kind==='entry'?await tx.operationalEntry.count({where:{id:effect.id,updatedAt:revision}}):effect.kind==='task'?await tx.task.count({where:{id:effect.id,updatedAt:revision}}):effect.kind==='housekeeping'?await tx.housekeepingRequest.count({where:{id:effect.id,updatedAt:revision}}):await tx.followUp.count({where:{id:effect.id,updatedAt:revision}});
            if(!unchanged){await tx.operationalAutomationRun.update({where:{id:run.id},data:{status:'SKIPPED',result:{reason:'El origen cambió; se reevaluará en el próximo barrido.'},completedAt:new Date()}});return;}
            const visible = effect.kind === 'entry' ? await tx.operationalEntry.count({ where: { id: effect.id, AND: [coordinationEntries(recipient)] } }) : effect.kind === 'task' ? await tx.task.count({ where: { id: effect.id, AND: [coordinationTasks(recipient)] } }) : effect.kind === 'housekeeping' ? await tx.housekeepingRequest.count({ where: { id: effect.id, AND: [await hkWorkVisibility(recipient, tx)] } }) : effect.kind === 'followup' ? await tx.followUp.count({where:{id:effect.id,AND:[coordinationFollowUps(recipient)]}}) : 0;
            if (!visible) throw new ForbiddenError('Destinatario sin acceso al origen.');
            if(config.trigger==='UNRECEIVED'&&(effect.kind==='entry'||effect.kind==='task')){
              const claim={id:effect.id,updatedAt:revision,workAcknowledgedAt:null,workEscalatedAt:null};
              const changed=effect.kind==='entry'?await tx.operationalEntry.updateMany({where:claim,data:{workEscalatedAt:now}}):await tx.task.updateMany({where:claim,data:{workEscalatedAt:now}});
              if(!changed.count){await tx.operationalAutomationRun.update({where:{id:run.id},data:{status:'SKIPPED',result:{reason:'Ya recibido o escalado por el mecanismo original.'},completedAt:new Date()}});return;}
            }
            if(effect.kind==='housekeeping'&&['UNRECEIVED','OVERDUE'].includes(config.trigger)){
              const origin=await tx.housekeepingRequest.findUniqueOrThrow({where:{id:effect.id}});
              const changed=await tx.housekeepingRequest.updateMany({where:{id:origin.id,version:origin.version,OR:[{escalatedVersion:null},{escalatedVersion:{not:origin.version}}]},data:{escalatedVersion:origin.version}});
              if(!changed.count){await tx.operationalAutomationRun.update({where:{id:run.id},data:{status:'SKIPPED',result:{reason:'Ya escalado por Housekeeping.'},completedAt:new Date()}});return;}
            }
            await notify({ userId: recipient.id, type: 'ACCION_REQUERIDA', title: 'Trabajo del área requiere atención', link: effect.href, entity: 'OperationalAutomation', entityId: run.id }, tx);
            if(!await tx.notification.count({where:{userId:recipient.id,entity:'OperationalAutomation',entityId:run.id}}))throw new RuleError('No se pudo conservar el aviso interno.');
            result = { sourceId: effect.id, recipientId: recipient.id };
          }
          await tx.operationalAutomationRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', result: json(result), completedAt: new Date() } });
          attempted++;
        }, { timeout: 15000 });
      }
      await prisma.operationalAutomation.updateMany({where:{id:policy.id,version:policy.version},data:{lastEvaluatedAt:now,...(!deferred&&'nextPage' in simulation?{scanPage:simulation.nextPage}:{})}});
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
  return { enabled: true, attempted, failed, scanned, deferred, policyLimit: 20, effectLimit: 25 };
}

export async function automationSummary(user: CurrentUser, departmentId?: string) {
  const board = await automationBoard(user, departmentId);
  const since = new Date(Date.now() - 86400000);
  const runs = await prisma.frontiExecution.findMany({ where: { userId: user.id, createdAt: { gte: since } }, select: { id: true, status: true }, take: 101 });
  return { generatedAt: new Date(), period: { from: since, to: new Date() }, scope: departmentId ?? 'registros dentro de tu acceso', sources:board.rows.slice(0,20).map(({id,title,owner,nextAction,href,dueAt})=>({id,title,owner,nextAction,href,dueAt})), complete: board.complete, denominator: board.rows.length, metrics: coordinationMetrics(board.rows), fronti: { scope: 'Sólo tus ejecuciones de las últimas 24 horas', complete: runs.length <= 100, observed: runs.slice(0,100) }, savedManualSteps: null, note: 'No se estima ahorro ni se imputan tiempos históricos faltantes. Los pendientes corresponden al estado actual, no sólo al período.' };
}
