import { getSettingBool } from './settings';
import { readEntries } from '@/server/services/entry-visibility';
import {subjectDistributionEnabled} from './subject-distribution-gate';
import {isSubjectAttentionTask} from '@/domain/subject-attention';
import 'server-only';
import {createHash} from 'node:crypto';
import {prisma} from '@/lib/prisma';
import type {CurrentUser} from '@/server/auth/current-user';
import type {Prisma} from '@prisma/client';
import {ForbiddenError,NotFoundError,RuleError} from '@/server/errors';
import {coordinationEntries,coordinationTasks} from './coordination-access';
import {createTask} from './tasks';
import {createHkWork,changeHkWork,hkWorkVisibility,hkCapability} from './housekeeping-work';
import {assertReceptionOperationPermission} from './reception-operation-gate';
import {canAccessHousekeeping} from '@/domain/housekeeping';
import {hotelDateKey} from '@/domain/time';

export async function getSubjectAttentionAreas(user:CurrentUser){
  const areas=await prisma.department.findMany({where:{active:true},select:{id:true,key:true,name:true},orderBy:{order:'asc'}});
  const result:Array<{value:string;label:string;needsLocation:boolean}>=[];
  for(const area of areas){
    const specialized=['HOUSEKEEPING','AREAS_PUBLICAS'].includes(area.key);
    const allowed=specialized?canAccessHousekeeping(user)&&(user.permissions.includes('housekeeping.request')||await hkCapability(user,area.id,'housekeeping.assign')):user.permissions.includes('task.create');
    if(allowed)result.push({value:area.id,label:area.name,needsLocation:specialized});
  }
  return result;
}

/** Una derivación sobre servicios existentes; el origen y su evidencia siguen siendo canónicos. */
export async function requestSubjectAttention(user:CurrentUser,input:{entryId:string;departmentId:string;requestKey:string;revision:string;assigneeId?:string;location?:string},transaction?:Prisma.TransactionClient,notificationOptions:{internalOnly?:boolean}={}){
  const db=transaction??prisma;
  const area=await db.department.findFirst({where:{id:input.departmentId,active:true},select:{key:true}});
  if(!area)throw new RuleError('Selecciona un área activa.');
  const specialized=['HOUSEKEEPING','AREAS_PUBLICAS'].includes(area.key);
  await assertReceptionOperationPermission(user,specialized?'housekeeping.manage':'task.create',db);
  if(!specialized&&!user.permissions.includes('task.create'))throw new ForbiddenError();
  if(!specialized&&input.assigneeId&&input.assigneeId!==user.id&&!user.permissions.includes('task.assign'))throw new ForbiddenError();
  const prefix=`subject:${user.id}:${input.requestKey}:`;
  const occurrenceKey=prefix+createHash('sha256').update(JSON.stringify({entryId:input.entryId,departmentId:input.departmentId,revision:input.revision,assigneeId:input.assigneeId??null,location:input.location?.trim()??null})).digest('hex');
  const perform=async(tx:Prisma.TransactionClient)=>{
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.entryId} FOR UPDATE`;
    const source=await readEntries(tx, user).findFirst({where:{id:input.entryId,deletedAt:null,isDemo:false,OR:[{AND:[coordinationEntries(user)]},...(specialized&&await hkCapability(user,input.departmentId,'housekeeping.assign',tx)?[{areaAttentions:{some:{departmentId:input.departmentId}}}]:[])]}});
    if(!source)throw new NotFoundError();
    if(['NOVEDAD','INCIDENCIA'].includes(source.type)&&await getSettingBool('book.simpleNovelties',false))throw new RuleError('En novedades simples se elige el área relacionada, sin cadenas de asignación.');
    const reopening=await tx.auditLog.findFirst({where:{entity:'SubjectAttention',entityId:{startsWith:prefix},userId:user.id,action:'REABRIR'},select:{entityId:true,after:true}});
    if(reopening && reopening.entityId!==occurrenceKey)throw new RuleError('El reintento pertenece a otra solicitud.');
    if(reopening && reopening.after && typeof reopening.after==='object' && !Array.isArray(reopening.after) && typeof reopening.after.housekeepingId==='string'){
      const work=await tx.housekeepingRequest.findFirst({where:{id:reopening.after.housekeepingId,AND:[await hkWorkVisibility(user,tx)]}});
      if(!work)throw new NotFoundError();
      return {kind:'housekeeping' as const,id:work.id,href:`/housekeeping?area=${work.departmentId}&aviso=${work.humanId}`,existing:true};
    }
    const repeatedTask=await tx.task.findFirst({where:{procedureOccurrenceKey:{startsWith:prefix}}});
    const repeatedHk=await tx.housekeepingRequest.findFirst({where:{requestKey:{startsWith:prefix}}});
    if(repeatedTask&&repeatedTask.entryId!==source.id||repeatedHk&&(repeatedHk.createdById!==user.id||repeatedHk.sourceEntryId!==source.id))throw new RuleError('El reintento pertenece a otra solicitud.');
    if(!await tx.department.count({where:{id:input.departmentId,active:true,key:area.key}}))throw new RuleError('El área cambió. Actualiza antes de continuar.');
    if(repeatedTask){
      if(repeatedTask.procedureOccurrenceKey!==occurrenceKey)throw new RuleError('El reintento pertenece a otra asignación.');
      if(!await tx.task.count({where:{id:repeatedTask.id,AND:[coordinationTasks(user)]}}))throw new NotFoundError();
      return {kind:'task' as const,id:repeatedTask.id,href:`/tareas/${repeatedTask.id}`,existing:true};
    }
    if(repeatedHk){
      if(repeatedHk.requestKey!==occurrenceKey)throw new RuleError('El reintento pertenece a otra solicitud.');
      if(!await tx.housekeepingRequest.count({where:{id:repeatedHk.id,AND:[await hkWorkVisibility(user,tx)]}}))throw new NotFoundError();
      return {kind:'housekeeping' as const,id:repeatedHk.id,href:`/housekeeping?area=${repeatedHk.departmentId}&aviso=${repeatedHk.humanId}`,existing:true};
    }
    const enabled=subjectDistributionEnabled();
    const existingHk=await tx.housekeepingRequest.findFirst({where:{sourceEntryId:source.id,...(enabled?{OR:[{departmentId:input.departmentId},{departmentId:null}]}:{})}});
    if(!enabled){
      const other=await tx.task.findFirst({where:{entryId:source.id,deletedAt:null,status:{notIn:['VALIDADA','COMPLETADA','CANCELADA']},departmentId:{not:input.departmentId},AND:[coordinationTasks(user)]},select:{id:true}});
      if(other||existingHk&&!existingHk.isDemo&&!['RESUELTO','CANCELADO'].includes(existingHk.status)&&existingHk.departmentId!==input.departmentId)throw new RuleError('El asunto ya tiene trabajo de otra área. Continúa su atención vigente; la distribución simultánea todavía no está habilitada.');
    }
    const readableTask=coordinationTasks(user);
    const taskScope:Prisma.TaskWhereInput={entryId:source.id,departmentId:input.departmentId,deletedAt:null,status:{notIn:['VALIDADA','COMPLETADA','CANCELADA']},AND:[readableTask]};
    const existingCanonicalTask=await tx.task.findFirst({where:{...taskScope,procedureOccurrenceKey:{startsWith:'subject:'}},orderBy:{createdAt:'desc'}});
    const existingOrdinaryTask=existingCanonicalTask?null:await tx.task.findFirst({where:{...taskScope,procedureOccurrenceKey:null},orderBy:{createdAt:'asc'}});
    const existingProcedureTask=existingCanonicalTask||existingOrdinaryTask?null:await tx.task.findFirst({where:taskScope,orderBy:{createdAt:'asc'}});
    const existingTask=existingCanonicalTask??existingOrdinaryTask??existingProcedureTask;
    const hkClosed=existingHk && ['RESUELTO','CANCELADO'].includes(existingHk.status);
    if(specialized && existingHk && !existingHk.isDemo && !hkClosed){
      const visible=await tx.housekeepingRequest.count({where:{id:existingHk.id,AND:[await hkWorkVisibility(user,tx)]}});
      if(!visible)throw new RuleError('Este asunto ya tiene atención. Consulta el resultado en el origen.');
      if(existingHk.departmentId!==input.departmentId)throw new RuleError('El asunto ya tiene trabajo de otra área. Abre ese trabajo y deriva desde su contexto para conservar la continuidad.');
      return {kind:'housekeeping' as const,id:existingHk.id,href:`/housekeeping?area=${existingHk.departmentId}&aviso=${existingHk.humanId}`,existing:true};
    }
    if(existingTask){
      if(!await tx.task.count({where:{id:existingTask.id,AND:[coordinationTasks(user)]}}))throw new RuleError('Este asunto ya tiene atención. Consulta el resultado en el origen.');
      if(existingTask.departmentId!==input.departmentId)throw new RuleError('El asunto ya tiene trabajo de otra área. Abre ese trabajo y deriva desde su contexto para conservar la continuidad.');
      if(!isSubjectAttentionTask(existingTask.procedureOccurrenceKey)){
        if(existingTask.procedureOccurrenceKey)throw new RuleError('Este trabajo pertenece a un procedimiento programado. Continúa ese procedimiento antes de solicitar otra atención.');
        if(!user.permissions.includes('task.edit')&&existingTask.createdById!==user.id)throw new ForbiddenError('Se requiere permiso para incorporar el trabajo existente a esta atención.');
        if(source.updatedAt.toISOString()!==input.revision||['RESUELTO','CERRADO'].includes(source.status))throw new RuleError('El asunto cambió. Actualiza antes de solicitar atención.');
        await tx.task.update({where:{id:existingTask.id,updatedAt:existingTask.updatedAt},data:{procedureOccurrenceKey:occurrenceKey}});
        await tx.auditLog.create({data:{entity:'Task',entityId:existingTask.id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:`Trabajo #${existingTask.humanId} incorporado a la atención del asunto #${source.humanId}`,before:{procedureOccurrenceKey:null},after:{procedureOccurrenceKey:occurrenceKey},reason:'Solicitud explícita de atención; conserva el trabajo y exige devolver su resultado.'}});
      }
      return {kind:'task' as const,id:existingTask.id,href:`/tareas/${existingTask.id}`,existing:true};
    }
    if(source.updatedAt.toISOString()!==input.revision)throw new RuleError('El asunto cambió. Actualiza antes de solicitar atención.');
    if(['RESUELTO','CERRADO'].includes(source.status))throw new RuleError('Reabre el asunto con permiso antes de solicitar atención.');
    if(specialized && existingHk){
      if(existingHk.isDemo)throw new RuleError('El vínculo histórico requiere regularización auditada por Administración antes de solicitar atención especializada. Puedes solicitar atención a otra área.');
      if(existingHk.departmentId!==input.departmentId)throw new RuleError('La atención especializada histórica pertenece a otra área. Solicita su revisión al supervisor.');
      if(!await hkCapability(user,input.departmentId,'housekeeping.assign',tx))throw new RuleError('La atención anterior terminó. El supervisor del área debe reabrirla con motivo para conservar su historial.');
      let result=await changeHkWork(user,{id:existingHk.id,version:existingHk.version,action:'REABRIR',note:`Nueva atención solicitada desde el asunto #${source.humanId}.`},tx,notificationOptions.internalOnly);
      if(input.assigneeId&&input.assigneeId!==existingHk.assignedToId)result=await changeHkWork(user,{id:result.id,version:result.version,action:'ASIGNAR',assignedToId:input.assigneeId,note:`Responsable para la nueva atención del asunto #${source.humanId}.`},tx,notificationOptions.internalOnly);
      await tx.auditLog.create({data:{entity:'SubjectAttention',entityId:occurrenceKey,userId:user.id,sessionId:user.sessionId,action:'REABRIR',summary:`Atención reabierta para el asunto #${source.humanId}`,after:{housekeepingId:result.id}}});
      return {kind:'housekeeping' as const,id:result.id,href:`/housekeeping?area=${result.departmentId}&aviso=${result.humanId}`,existing:false};
    }
    if(specialized){
      const result=await createHkWork(user,{requestKey:occurrenceKey,sourceEntryId:source.id,title:source.title,description:source.description,departmentId:input.departmentId,roomId:source.roomId??undefined,location:source.roomId?undefined:input.location,priority:source.priority,dueAt:source.dueAt,workDate:hotelDateKey(new Date()),workKind:'ATENCION',effortMinutes:20,requiresInspection:false,assignedToId:input.assigneeId},tx,notificationOptions.internalOnly);
      return {kind:'housekeeping' as const,id:result.id,href:`/housekeeping?area=${result.departmentId}&aviso=${result.humanId}`,existing:false};
    }
    if(input.assigneeId&&!await tx.user.count({where:{id:input.assigneeId,active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId:input.departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId:input.departmentId,active:true}}}}]}}))throw new RuleError('El responsable debe estar habilitado en el área solicitada.');
    const result=await createTask(user,{internalOnly:notificationOptions.internalOnly,procedureOccurrenceKey:occurrenceKey,title:source.title,description:source.description,entryId:source.id,departmentId:input.departmentId,assigneeId:input.assigneeId,roomId:source.roomId,priority:source.priority,dueAt:source.dueAt,tags:source.tags,checklist:[]},tx);
    return {kind:'task' as const,id:result.id,href:`/tareas/${result.id}`,existing:false};
  };
  return transaction?perform(transaction):prisma.$transaction(perform);
}
