import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { substitutionSchema } from '@/domain/operational-automation';
import { getCoordinationTeam, coordinateWork, type CoordinationRow } from './coordination';
import { changeHkWork, validateWorker, hkCapability } from './housekeeping-work';
import { assertReceptionOperationPermission } from './reception-operation-gate';
import { RuleError } from '@/server/errors';
import { notify } from '@/server/notifications';
import { randomUUID } from 'node:crypto';
import type { SubstitutionWork, SubstitutionPreview } from './substitution-availability';

/** Ordered explicit candidates, membership and published planning; never inferred presence. */
export async function chooseSubstitute(actor:CurrentUser,departmentId:string,raw:unknown,row:Pick<CoordinationRow,'id'|'ownerId'>,now:Date,tx:Prisma.TransactionClient=prisma){
  const config=substitutionSchema.parse(raw);
  const team=await getCoordinationTeam(actor,departmentId,now);
  for(const id of config.candidateIds){
    const member=team.find(person=>person.id===id&&id!==row.ownerId);
    if(!member||config.requirePublishedSchedule&&(!member.scheduleVisible||!member.scheduled))continue;
    if(config.kind==='housekeeping'){
      const work=await tx.housekeepingRequest.findUnique({where:{id:row.id},select:{workDate:true}});
      if(!work||!await hkCapability(actor,departmentId,'housekeeping.assign',tx))continue;
      try { await validateWorker(tx,departmentId,id,work.workDate??undefined); } catch { continue; }
    }
    return {...member,planningOnly:true};
  }
  return null;
}

export async function applySubstitution(actor:CurrentUser,departmentId:string,raw:unknown,effect:{id:string;revision:string;ownerId:string|null;substituteId:string|null;href:string},runId:string,now:Date,tx:Prisma.TransactionClient){
  const config=substitutionSchema.parse(raw);
  const selected=await chooseSubstitute(actor,departmentId,config,effect,now,tx);
  if(!selected||selected.id!==effect.substituteId)throw new RuleError('No hay suplente elegible o cambió la selección. La política requiere revisión.');
  if(config.mode==='PROPOSE'){
    await notify({userId:actor.id,type:'ACCION_REQUERIDA',title:'Suplencia propuesta: revisar el trabajo original',link:effect.href,entity:'OperationalAutomation',entityId:runId},tx);
    return {sourceId:effect.id,substituteId:selected.id,mode:'PROPOSE',reason:'Propuesta conservada; no cambia responsable ni confirma asistencia.'};
  }
  if(config.kind==='housekeeping'){
    await assertReceptionOperationPermission(actor,'housekeeping.manage');
    const work=await tx.housekeepingRequest.findUniqueOrThrow({where:{id:effect.id}});
    if(work.updatedAt.toISOString()!==effect.revision||work.assignedToId!==effect.ownerId)throw new RuleError('El trabajo cambió después de simular.');
    await changeHkWork(actor,{id:work.id,version:work.version,action:'ASIGNAR',assignedToId:selected.id,note:config.nextAction},tx);
  }else{
    await coordinateWork(actor,{kind:config.kind,id:effect.id,updatedAt:new Date(effect.revision),requestKey:randomUUID(),action:'ASIGNAR',ownerId:selected.id,nextAction:config.nextAction},tx);
  }
  return {sourceId:effect.id,substituteId:selected.id,mode:'APPLY',reason:'Responsable actualizado mediante el servicio original. Recepción pendiente; no acredita presencia.'};
}

/** Executable only after the policy/source/schedule were re-read in the caller's transaction. */
export async function applyPreparedSubstitution(actor:CurrentUser,raw:unknown,work:SubstitutionWork,preview:SubstitutionPreview,runId:string,href:string,tx:Prisma.TransactionClient){
  const config=substitutionSchema.parse(raw);
  const selected=preview.selection;
  if(!config.waitForPublishedSchedule||!selected||!preview.eligibleNow||preview.state!=='AVAILABLE_NOW'||selected.eligibleUntil<=new Date())throw new RuleError('La oportunidad publicada dejó de estar vigente. Reevalúa el pendiente.');
  if(config.mode==='PROPOSE'){
    await notify({userId:actor.id,type:'ACCION_REQUERIDA',title:'Suplencia propuesta: revisar el trabajo original',link:href,entity:'OperationalAutomation',entityId:runId},tx);
    if(!await tx.notification.count({where:{userId:actor.id,entity:'OperationalAutomation',entityId:runId}}))throw new RuleError('No se pudo conservar la propuesta interna.');
  }else if(work.kind==='housekeeping'){
    await assertReceptionOperationPermission(actor,'housekeeping.manage',tx);
    await changeHkWork(actor,{id:work.id,version:work.version!,action:'ASIGNAR',assignedToId:selected.userId,note:config.nextAction},tx);
  }else{
    await coordinateWork(actor,{kind:work.kind,id:work.id,updatedAt:work.updatedAt,requestKey:randomUUID(),action:'ASIGNAR',ownerId:selected.userId,nextAction:config.nextAction},tx);
  }
  return {sourceId:work.id,substituteId:selected.userId,mode:config.mode,planning:{slotId:selected.slotId,planId:selected.planId,publishedVersion:selected.publishedVersion,slotUpdatedAt:selected.slotUpdatedAt,startAt:selected.startAt,effectiveEndAt:selected.effectiveEndAt},reason:config.mode==='PROPOSE'?'Propuesta vigente conservada. El trabajo sigue pendiente de asignación humana.':'Responsable actualizado mediante el servicio original. Recepción pendiente; no acredita presencia.'};
}
