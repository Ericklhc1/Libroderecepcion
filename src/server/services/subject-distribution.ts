import { lockSimpleNoveltiesMode } from './settings';
import { readEntries } from '@/server/services/entry-visibility';
import {entryReadWhere,assertEntryWorkDestination} from './entry-visibility';
import {assertSubjectDistributionEnabled} from './subject-distribution-gate';
import 'server-only';
import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import type {CurrentUser} from '@/server/auth/current-user';
import type {PermissionKey} from '@/lib/permissions';
import {RuleError,ForbiddenError,NotFoundError} from '@/server/errors';
import {canAccessHousekeeping} from '@/domain/housekeeping';
import {isHkFocused} from '@/domain/housekeeping-work';
import {coordinationEntries} from './coordination-access';
import {hkCapability,validateWorker,notifyHkWork} from './housekeeping-work';
import {requestSubjectAttention,getSubjectAttentionAreas} from './subject-attention';
import {getReceptionOperationGate,assertReceptionOperationPermission} from './reception-operation-gate';
import {assertTaskAssignable} from './task-assignment-access';
import {notify} from '@/server/notifications';
import {sourceStakeholders} from './work-notifications';

type Tx=Prisma.TransactionClient;
const areaLabel=(row:Attention)=>row.department.name;
const specialized=(key:string)=>['HOUSEKEEPING','AREAS_PUBLICAS'].includes(key);
const membership=(departmentId:string):Prisma.UserWhereInput=>({active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId,active:true}}}}]});
const include={department:{select:{id:true,name:true,key:true}},entry:{select:{id:true,humanId:true,title:true,description:true,status:true,priority:true,room:{select:{number:true}},dueAt:true,ownerId:true,createdById:true,deletedAt:true,isDemo:true,updatedAt:true}},task:{select:{id:true,humanId:true,status:true,assigneeId:true,assignee:{select:{name:true}},evidenceProvided:true}},housekeeping:{select:{id:true,humanId:true,status:true,assignedToId:true,assignedTo:{select:{name:true}},resolution:true,version:true,requiresInspection:true}}} satisfies Prisma.SubjectAreaAttentionInclude;
type Attention=Prisma.SubjectAreaAttentionGetPayload<{include:typeof include}>;

export async function canReviewArea(user:CurrentUser,departmentId:string,key:string,tx:Tx=prisma){
  if(user.isSystemAdmin)return true;
  if(specialized(key))return canAccessHousekeeping(user)&&hkCapability(user,departmentId,'housekeeping.assign',tx);
  return user.permissions.includes('task.assign')&&!!await tx.user.count({where:{id:user.id,...membership(departmentId)}});
}
async function canRead(user:CurrentUser,row:Attention,tx:Tx){
  if(row.entry.deletedAt||row.entry.isDemo)return false;
  if(row.createdById===user.id||row.entry.ownerId===user.id||row.entry.createdById===user.id)return true;
  if(await canReviewArea(user,row.departmentId,row.department.key,tx))return true;
  if(row.urgentContactId===user.id)return !!await tx.user.count({where:{id:user.id,...membership(row.departmentId)}});
  if(row.status==='INFORMADA'||row.status==='ASIGNADA')return !!await tx.user.count({where:{id:user.id,...membership(row.departmentId)}});
  return false;
}
export async function getAreaAttention(user:CurrentUser,id:string,tx:Tx=prisma){
  const row=await tx.subjectAreaAttention.findFirst({where:{id,entry:{AND:[entryReadWhere(user)]}},include});
  if(!row||!await canRead(user,row,tx))throw new NotFoundError();
  return row;
}
export async function attentionPeople(departmentId:string,tx:Tx=prisma){
  const area=await tx.department.findUnique({where:{id:departmentId},select:{key:true}});
  if(!area)return [];
  const people=await tx.user.findMany({where:membership(departmentId),select:{id:true,name:true,role:{select:{key:true,permissions:{select:{permission:{select:{key:true}}}}}}},orderBy:{name:'asc'}});
  return people.filter(p=>specialized(area.key)?p.role.key==='ADMINISTRADOR_SISTEMA'||p.role.permissions.some(v=>['housekeeping.work','housekeeping.manage'].includes(v.permission.key)):p.role.permissions.some(v=>v.permission.key==='task.edit')&&!isHkFocused({roleKey:p.role.key,permissions:p.role.permissions.map(v=>v.permission.key as PermissionKey)})).map(({id,name})=>({id,name}));
}
async function notifyAttention(tx:Tx,row:Attention,actorId:string,title:string,informArea=false){
  const people=await tx.user.findMany({where:membership(row.departmentId),include:{role:{include:{permissions:{include:{permission:true}}}}}});
  const ids=new Set<string>([row.createdById,...await sourceStakeholders(tx,row.entryId),...(row.urgentContactId?[row.urgentContactId]:[])]);
  for(const p of people){
    const reader={id:p.id,roleKey:p.role.key,isSystemAdmin:p.role.key==='ADMINISTRADOR_SISTEMA',permissions:p.role.permissions.map(r=>r.permission.key as PermissionKey)} as CurrentUser;
    if(informArea||await canReviewArea(reader,row.departmentId,row.department.key,tx))ids.add(p.id);
  }
  ids.delete(actorId);
  const active=await tx.user.findMany({where:{id:{in:[...ids]},active:true,deletedAt:null},select:{id:true}});
  await notify(active.map(p=>({internalOnly:true,userId:p.id,type:'ACCION_REQUERIDA' as const,title,link:`/coordinacion/areas?atencion=${row.id}`,entity:'OperationalEntry',entityId:row.entryId})),tx);
}
async function audit(tx:Tx,user:CurrentUser,row:Attention,action:string,note:string){
  await tx.auditLog.create({data:{entity:'SubjectAreaAttention',entityId:row.id,userId:user.id,sessionId:user.sessionId,action:'EDITAR',summary:`Asunto #${row.entry.humanId} · ${row.department.name}: ${action}`,reason:note,after:{status:row.status,version:row.version,urgent:row.urgent,taskId:row.taskId,housekeepingId:row.housekeepingId}}});
}
async function materialize(tx:Tx,user:CurrentUser,row:Attention,assigneeId?:string){
  const result=await requestSubjectAttention(user,{entryId:row.entryId,departmentId:row.departmentId,revision:row.entry.updatedAt.toISOString(),requestKey:`${row.id}:${row.version}`,location:row.location??undefined,assigneeId},tx,{internalOnly:true});
  if(result.kind==='task'){
    if(row.requiresValidation)await tx.task.update({where:{id:result.id},data:{requiresIndependentValidation:true}});
    return {taskId:result.id};
  }
  if(row.requiresValidation)await tx.housekeepingRequest.update({where:{id:result.id},data:{requiresInspection:true}});
  return {housekeepingId:result.id};
}

/** Explicit dispatch, one source and independent area decisions. Retrying never duplicates work. */
export async function distributeSubject(user:CurrentUser,input:{entryId:string;revision:string;requestKey:string;departmentIds:string[];location?:string;urgent?:boolean;urgencyReason?:string;urgentContacts?:Record<string,string>;requiresValidation?:boolean}){
  assertSubjectDistributionEnabled();
  const allowed=await getSubjectAttentionAreas(user);
  const ids=[...new Set(input.departmentIds)].sort();
  if(!ids.length||ids.length>100||ids.some(id=>!allowed.some(a=>a.value===id)))throw new RuleError('Selecciona una o más áreas operativas disponibles.');
  if(input.urgent&&!input.urgencyReason?.trim())throw new RuleError('Indica qué riesgo requiere atención inmediata.');
  if(input.urgent){
    const gate=await getReceptionOperationGate(user);
    if(gate.mode!=='ACTIVE')throw new RuleError(gate.shiftStatus==='PREPARANDO_ENTREGA'?'Para registrar esta urgencia, abre Mi turno y cancela la preparación de entrega para volver a operación. Contacta directamente a la guardia si el riesgo no puede esperar.':'Tu turno no permite nuevas intervenciones. Contacta directamente a la guardia habilitada; completa la recepción o custodia en Mi turno antes de registrar con tu cuenta.');
  }
  await assertReceptionOperationPermission(user,user.permissions.includes('task.create')?'task.create':'housekeeping.manage');
  const hash=createHash('sha256').update(JSON.stringify({...input,departmentIds:ids})).digest('hex');
  return prisma.$transaction(async tx=>{
    const simpleMode=await lockSimpleNoveltiesMode(tx);
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${input.entryId} FOR UPDATE`;
    const entry=await readEntries(tx, user).findFirst({where:{id:input.entryId,AND:[coordinationEntries(user)]}});
    if(!entry)throw new NotFoundError();
    if(['NOVEDAD','INCIDENCIA'].includes(entry.type)&&simpleMode)throw new RuleError('En novedades simples se elige el área relacionada, sin cadenas de asignación.');
    // Validate every destination under the source lock before receipts, rows or notices.
    for(const departmentId of ids)await assertEntryWorkDestination(tx,entry.id,departmentId,input.urgent?input.urgentContacts?.[departmentId]:null);
    const prefix=`distribution:${user.id}:${input.requestKey}:`;
    const receipt=await tx.auditLog.findFirst({where:{entity:'SubjectDistribution',entityId:{startsWith:prefix},userId:user.id},select:{entityId:true,after:true}});
    if(receipt){
      if(receipt.entityId!==prefix+hash)throw new RuleError('El reintento pertenece a otra distribución.');
      return tx.subjectAreaAttention.findMany({where:{entryId:entry.id,departmentId:{in:ids}}});
    }
    if(entry.updatedAt.toISOString()!==input.revision)throw new RuleError('El asunto cambió. Actualiza antes de distribuir.');
    if(['RESUELTO','CERRADO'].includes(entry.status))throw new RuleError('Reabre el asunto antes de distribuir atención.');
    const result:Attention[]=[];
    for(const departmentId of ids){
      const existing=await tx.subjectAreaAttention.findUnique({where:{entryId_departmentId:{entryId:entry.id,departmentId}},include});
      if(existing){
        if(!!input.urgent!==existing.urgent||!!input.requiresValidation!==existing.requiresValidation)throw new RuleError(`${areaLabel(existing)} ya tiene una atención: abre su decisión vigente antes de cambiar urgencia o validación.`);
        result.push(existing);continue;
      }
      const area=allowed.find(a=>a.value===departmentId)!;
      if(area.needsLocation&&!entry.roomId&&!input.location?.trim())throw new RuleError('Indica la ubicación para el trabajo especializado.');
      const urgentContactId=input.urgent?input.urgentContacts?.[departmentId]:undefined;
      if(input.urgent&&(!urgentContactId||!(await attentionPeople(departmentId,tx)).some(p=>p.id===urgentContactId)))throw new RuleError(`Selecciona la guardia o suplencia habilitada de ${area.label}; no se infiere presencia desde el horario. El asunto original sigue guardado. Contacta directamente a la jefatura o guardia por el canal vigente; no esperes este formulario ante un riesgo inmediato.`);
      let row=await tx.subjectAreaAttention.create({data:{entryId:entry.id,departmentId,requestKey:`${prefix}${hash}:${departmentId}`,createdById:user.id,location:input.location?.trim(),urgent:!!input.urgent,urgencyReason:input.urgencyReason?.trim(),urgentContactId,requiresValidation:!!input.requiresValidation},include});
      if(row.urgent){const work=await materialize(tx,user,row);row=await tx.subjectAreaAttention.update({where:{id:row.id},data:work,include});}
      await audit(tx,user,row,'DISTRIBUIR',row.urgent?'Atención inmediata solicitada; revisión posterior de jefatura pendiente.':'Distribución interna explícita; aún no publicada al área.');
      await notifyAttention(tx,row,user.id,`${row.urgent?'URGENTE · guardia y jefatura':'Por revisar'}: asunto #${entry.humanId} · ${area.label}`);
      result.push(row);
    }
    await tx.auditLog.create({data:{entity:'SubjectDistribution',entityId:prefix+hash,userId:user.id,sessionId:user.sessionId,action:'CREAR',summary:`Asunto #${entry.humanId}: distribución interna a ${ids.length} área(s)`,after:{attentionIds:result.map(r=>r.id),departmentIds:ids}}});
    return result;
  });
}

export type AreaDecision='CONOCER'|'INFORMAR'|'ASIGNAR'|'ACLARACION'|'RESPONDER'|'REVISAR_URGENCIA'|'TOMAR_URGENCIA'|'REABRIR';
export async function decideAreaAttention(user:CurrentUser,input:{id:string;version:number;sourceRevision:string;action:AreaDecision;note?:string;assigneeId?:string}){
  assertSubjectDistributionEnabled();
  return prisma.$transaction(async tx=>{
    const initial=await getAreaAttention(user,input.id,tx);
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${initial.entryId} FOR UPDATE`;
    const row=await getAreaAttention(user,input.id,tx);
    if(row.version!==input.version)throw new RuleError('La atención cambió. Actualiza antes de continuar.');
    if(row.entry.updatedAt.toISOString()!==input.sourceRevision)throw new RuleError('El asunto de origen cambió. Actualiza y revisa su contenido antes de decidir.');
    await assertReceptionOperationPermission(user,specialized(row.department.key)?'housekeeping.manage':'task.assign',tx);
    const review=await canReviewArea(user,row.departmentId,row.department.key,tx);
    const responding=input.action==='RESPONDER'||input.action==='REABRIR';const claim=input.action==='TOMAR_URGENCIA';
    if(responding?!(row.createdById===user.id||row.entry.ownerId===user.id||row.entry.createdById===user.id||review):claim?!(row.urgent&&row.urgentContactId===user.id):!review)throw new ForbiddenError('Esta decisión corresponde a la jefatura del área o a la persona responsable indicada.');
    if(['RESUELTO','CERRADO'].includes(row.entry.status))throw new RuleError('El asunto está finalizado. Reábrelo antes de cambiar su atención.');
    const note=input.note?.trim()??'';
    if(input.action!=='CONOCER'&&!note)throw new RuleError('Registra la instrucción, el motivo o la revisión.');
    const now=new Date();let data:Prisma.SubjectAreaAttentionUncheckedUpdateInput={version:{increment:1}};
    if(input.action==='CONOCER'){
      if(row.knownAt)return row;
      data={...data,knownAt:now,knownById:user.id};
    }else if(input.action==='REABRIR'){
      await assertEntryWorkDestination(tx,row.entryId,row.departmentId,row.urgent?row.urgentContactId:null);
      if(row.task&&!['VALIDADA','COMPLETADA','CANCELADA'].includes(row.task.status)||row.housekeeping&&!['RESUELTO','CANCELADO'].includes(row.housekeeping.status)||!row.task&&!row.housekeeping&&row.status!=='INFORMADA')throw new RuleError('La intervención todavía está pendiente; continúa su atención vigente.');
      data={...data,status:'POR_REVISAR',knownAt:null,knownById:null,decisionAt:null,decidedById:null,decisionNote:`Nueva atención solicitada: ${note}`};
    }else if(responding){
      if(row.status!=='ACLARACION')throw new RuleError('No hay una aclaración pendiente.');
      data={...data,status:'POR_REVISAR',decisionNote:`Respuesta: ${note}`};
    }else if(claim){
      if(!await tx.user.count({where:{id:user.id,...membership(row.departmentId)}}))throw new ForbiddenError('La guardia ya no está habilitada en esta área.');
      // A bounded self-claim by the explicitly selected qualified contact. No assignment of somebody else.
      if(specialized(row.department.key)){
        await validateWorker(tx,row.departmentId,user.id);
        if(!canAccessHousekeeping(user)||!await hkCapability(user,row.departmentId,'housekeeping.work',tx))throw new ForbiddenError();
        const work=row.housekeeping;
        if(!work||work.assignedToId||!['PENDIENTE','RECIBIDO'].includes(work.status))throw new RuleError('La atención ya tiene responsable o comenzó. Abre el trabajo vigente.');
        const changed=await tx.housekeepingRequest.updateMany({where:{id:work.id,version:work.version,assignedToId:null},data:{assignedToId:user.id,workAssignedAt:now,acknowledgedAt:null,sourceVersion:null,version:{increment:1}}});
        if(!changed.count)throw new RuleError('Otra persona tomó el trabajo. Actualiza.');
        await tx.housekeepingEvent.create({data:{requestId:work.id,actorId:user.id,action:'ASIGNAR',fromStatus:work.status,toStatus:work.status,note:`Guardia indicada toma la urgencia: ${note}`}});
        await notifyHkWork(tx,await tx.housekeepingRequest.findUniqueOrThrow({where:{id:work.id}}),user.id,'Guardia tomó la atención; recepción pendiente',undefined,true);
      }else{
        await assertTaskAssignable(user.id,tx);
        if(!user.permissions.includes('task.edit'))throw new ForbiddenError();
        const work=row.task;
        if(!work||work.assigneeId||work.status!=='PENDIENTE')throw new RuleError('La atención ya tiene responsable o comenzó. Abre el trabajo vigente.');
        if(!(await tx.task.updateMany({where:{id:work.id,assigneeId:null,status:'PENDIENTE'},data:{assigneeId:user.id,workAssignedAt:now,workAcknowledgedAt:null,workAcknowledgedById:null}})).count)throw new RuleError('Otra persona tomó el trabajo. Actualiza.');
        await tx.taskAssignment.upsert({where:{taskId_userId:{taskId:work.id,userId:user.id}},create:{taskId:work.id,userId:user.id,assignedById:user.id,role:'PRINCIPAL'},update:{removedAt:null,role:'PRINCIPAL',assignedAt:now,assignedById:user.id}});
      }
      data={...data,decisionNote:`Guardia tomó la atención. Jefatura debe revisar: ${note}`};
    }else if(input.action==='ASIGNAR'){
      if(row.status!=='POR_REVISAR'||row.task&&!['VALIDADA','COMPLETADA','CANCELADA'].includes(row.task.status)||row.housekeeping&&!['RESUELTO','CANCELADO'].includes(row.housekeeping.status))throw new RuleError('Ya hay trabajo asociado. Asigna o releva desde su flujo nativo; solicita nueva revisión cuando termine.');
      if(!input.assigneeId)throw new RuleError('Selecciona el responsable del área.');
      data={...data,...await materialize(tx,user,row,input.assigneeId),status:'ASIGNADA',decisionAt:now,decidedById:user.id,decisionNote:note};
    }else if(input.action==='INFORMAR'){
      if(row.taskId||row.housekeepingId)throw new RuleError('Este asunto tiene una intervención requerida. Registra su resultado o cancelación en el trabajo asociado.');
      data={...data,status:'INFORMADA',decisionAt:now,decidedById:user.id,decisionNote:note};
    }else if(input.action==='REVISAR_URGENCIA'){
      if(!row.urgent||!row.taskId&&!row.housekeepingId)throw new RuleError('No hay una urgencia con trabajo asociado.');
      data={...data,status:'ASIGNADA',decisionAt:now,decidedById:user.id,decisionNote:note};
    }else{
      if(row.taskId||row.housekeepingId)throw new RuleError('Solicita aclaración desde el trabajo activo; la urgencia conserva su atención y salida segura.');
      data={...data,status:'ACLARACION',decisionAt:now,decidedById:user.id,decisionNote:note};
    }
    const updated=await tx.subjectAreaAttention.update({where:{id:row.id,version:input.version},data,include});
    await audit(tx,user,updated,input.action,note||'Tomó conocimiento; no aprueba, publica ni termina el trabajo.');
    if(input.action!=='CONOCER')await notifyAttention(tx,updated,user.id,`Asunto #${row.entry.humanId} · ${row.department.name}: ${input.action==='INFORMAR'?'información publicada':input.action==='ACLARACION'?'aclaración requerida':'atención actualizada'}`,input.action==='INFORMAR');
    return updated;
  });
}
export async function listAreaAttentions(user:CurrentUser,input:{entryId?:string;departmentId?:string;id?:string;page?:number}={}){
  const areas=await prisma.department.findMany({where:{active:true},select:{id:true,key:true,name:true}});
  const memberAreas:string[]=[];const reviewAreas:string[]=[];
  for(const area of areas){
    if(await prisma.user.count({where:{id:user.id,...membership(area.id)}}))memberAreas.push(area.id);
    if(await canReviewArea(user,area.id,area.key))reviewAreas.push(area.id);
  }
  const scope:Prisma.SubjectAreaAttentionWhereInput=user.isSystemAdmin?{}:{OR:[{createdById:user.id},{entry:{ownerId:user.id}},{entry:{createdById:user.id}},{departmentId:{in:reviewAreas}},{departmentId:{in:memberAreas},urgentContactId:user.id},{departmentId:{in:memberAreas},status:{in:['INFORMADA','ASIGNADA']}}]};
  const page=Math.max(1,Math.min(100000,Math.trunc(input.page||1)));
  const pageSize=input.entryId?100:25;
  const rows=await prisma.subjectAreaAttention.findMany({where:{AND:[scope],entry:{deletedAt:null,isDemo:false,AND:[entryReadWhere(user)],...(!input.entryId&&!input.id?{status:{notIn:['RESUELTO','CERRADO']}}:{})},...(input.entryId?{entryId:input.entryId}:{}),...(input.departmentId?{departmentId:input.departmentId}:{}),...(input.id?{id:input.id}:{})},include,orderBy:[{urgent:'desc'},{createdAt:'desc'},{id:'asc'}],take:pageSize+1,skip:(page-1)*pageSize});
  const result=[];
  for(const row of rows)if(await canRead(user,row,prisma))result.push({...row,canReview:await canReviewArea(user,row.departmentId,row.department.key),canRespond:row.createdById===user.id||row.entry.createdById===user.id||row.entry.ownerId===user.id,canClaim:row.urgentContactId===user.id&&!(row.task?.assigneeId||row.housekeeping?.assignedToId)});
  return {rows:result.slice(0,pageSize),hasMore:rows.length>pageSize,page,areas:areas.filter(a=>user.isSystemAdmin||memberAreas.includes(a.id)||reviewAreas.includes(a.id))};
}
