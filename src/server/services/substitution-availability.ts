import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';
import type { OperationalAutomation, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import type { PermissionKey } from '@/lib/permissions';
import { substitutionSchema, matchesAutomation } from '@/domain/operational-automation';
import { isHkFocused, hkAllowedActions } from '@/domain/housekeeping-work';
import { coverageSlots, dateDays, datePlus, dayWindow, scheduleTeamAccess } from '@/domain/schedule';
import { hotelDateKey } from '@/domain/time';
import { hkReceiptAvailableAt } from '@/domain/coordination';
import { selectSubstitutionAvailability, type SubstitutionAvailabilityResult, type SubstitutionSlotEvidence } from '@/domain/substitution-availability';
import { coordinationEntries, coordinationTasks } from './coordination-access';
import { hkCapability, hkWorkVisibility, validateWorker } from './housekeeping-work';
import { scheduleAreaIds } from './schedule-access';
import { assertTaskSourceRecipients } from './tasks';
import { RuleError } from '@/server/errors';

type Tx = Prisma.TransactionClient;
export type SubstitutionReadCache=Map<string,Promise<unknown>>;
async function cached<T>(cache:SubstitutionReadCache|undefined,key:string,read:()=>Promise<T>):Promise<T>{
  if(!cache)return read();
  if(!cache.has(key))cache.set(key,read());
  return cache.get(key)! as Promise<T>;
}
type Policy = Pick<OperationalAutomation, 'id'|'ownerId'|'departmentId'|'configuration'|'version'|'expiresAt'|'revokedAt'|'enabled'>;
export type SubstitutionWork = {
  id:string; kind:'entry'|'task'|'housekeeping'; ownerId:string|null; departmentId:string|null;
  updatedAt:Date; status:string; priority:string; receivedAt:Date|null; assignedAt:Date|null;
  availableAt:Date|null; dueAt:Date|null; startedAt:Date|null; workDate:string|null;
  followUpId:string|null; alertId:string|null; sourceChanged:boolean; version:number|null;
};
export type SubstitutionPreview = Omit<SubstitutionAvailabilityResult, 'state'|'reasonCode'> & {
  state:SubstitutionAvailabilityResult['state']|'ACCESS_UNAVAILABLE'|'WORK_CHANGED';
  reasonCode:string; generatedAt:Date; searchUntil:Date; policyVersion:number;
  sourceRevision:string; responsible:string|null; policyState:'ACTIVE'|'PAUSED'|'REVOKED'|'EXPIRED';
};

/** The persisted work is the pending item. No future owner or synthetic due date is stored. */
export async function readSubstitutionWork(actor:CurrentUser, kind:SubstitutionWork['kind'], id:string, tx:Tx=prisma):Promise<SubstitutionWork|null> {
  if(kind==='entry'){
    const row=await readEntries(tx, actor).findFirst({where:{id,AND:[coordinationEntries(actor)]}});
    return row?{id,kind,ownerId:row.ownerId,departmentId:row.departmentId,updatedAt:row.updatedAt,status:row.status,priority:row.priority,receivedAt:row.workAcknowledgedAt,assignedAt:row.workAssignedAt,availableAt:null,dueAt:row.dueAt,startedAt:row.workStartedAt,workDate:null,followUpId:null,alertId:null,sourceChanged:false,version:null}:null;
  }
  if(kind==='task'){
    const row=await tx.task.findFirst({where:{id,AND:[coordinationTasks(actor)]}});
    return row?{id,kind,ownerId:row.assigneeId,departmentId:row.departmentId,updatedAt:row.updatedAt,status:row.status,priority:row.priority,receivedAt:row.workAcknowledgedAt,assignedAt:row.workAssignedAt,availableAt:row.startsAt,dueAt:row.dueAt,startedAt:row.workStartedAt,workDate:null,followUpId:row.followUpId,alertId:row.alertId,sourceChanged:false,version:null}:null;
  }
  const row=await tx.housekeepingRequest.findFirst({where:{id,workflowVersion:1,isDemo:false,AND:[await hkWorkVisibility(actor,tx)]},include:{sourceEntry:{select:{updatedAt:true,deletedAt:true}}}});
  return row?{id,kind,ownerId:row.assignedToId,departmentId:row.departmentId,updatedAt:row.updatedAt,status:row.status,priority:row.priority,receivedAt:row.acknowledgedAt,assignedAt:row.workAssignedAt,availableAt:hkReceiptAvailableAt(row.workDate),dueAt:row.dueAt,startedAt:row.startedAt,workDate:row.workDate,followUpId:null,alertId:null,sourceChanged:!!row.sourceEntry?.deletedAt||!!row.acknowledgedAt&&!!row.sourceEntry&&row.sourceVersion?.getTime()!==row.sourceEntry.updatedAt.getTime(),version:row.version}:null;
}

export function substitutionStillPending(work:SubstitutionWork, policy:Policy, now:Date):boolean {
  const config=substitutionSchema.parse(policy.configuration);
  // Historical states remain evidence even when later-added receipt/start metadata
  // is null. Returned tasks also retain their native human correction workflow.
  return work.departmentId===policy.departmentId && !work.receivedAt && !work.startedAt &&
    !['ACEPTADA','RECIBIDO','DEVUELTA','EN_CURSO','EN_GESTION','REALIZADA','POR_REVISAR','RESUELTO','CERRADO','VALIDADA','COMPLETADA','CANCELADA','CANCELADO'].includes(work.status) &&
    !work.sourceChanged && (work.kind!=='housekeeping'||hkAllowedActions(work.status,!!work.ownerId).includes('ASIGNAR')) &&
    matchesAutomation(work,{trigger:config.trigger,kind:config.kind,priority:config.priority,receiptMinutes:config.receiptMinutes,recipientId:policy.ownerId,maxItems:config.maxItems},now);
}

/** Shared with native writers: users/roles, area, then collaborators. Never acquire in reverse order. */
export async function lockSubstitutionContext(tx:Tx, policy:Policy):Promise<void> {
  const config=substitutionSchema.parse(policy.configuration);
  const initialDelegations=await tx.housekeepingDelegation.findMany({where:{userId:policy.ownerId,departmentId:policy.departmentId,permission:'housekeeping.assign',revokedAt:null},select:{id:true,grantedById:true}});
  const ids=[...new Set([policy.ownerId,...config.candidateIds,...initialDelegations.map(d=>d.grantedById)])].sort();
  for(const id of ids)await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id} FOR SHARE`;
  // Grant creation takes the grantee's user lock. Refresh after locking the owner
  // so a grant committed while we were waiting cannot introduce an unlocked grantor.
  const delegations=await tx.housekeepingDelegation.findMany({where:{userId:policy.ownerId,departmentId:policy.departmentId,permission:'housekeeping.assign',revokedAt:null},select:{id:true,grantedById:true}});
  for(const id of [...new Set(delegations.map(d=>d.grantedById))].filter(id=>!ids.includes(id)).sort()){await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id} FOR SHARE`;ids.push(id);}
  const people=await tx.user.findMany({where:{id:{in:ids}},select:{roleId:true}});
  for(const id of [...new Set(people.map(p=>p.roleId))].sort())await tx.$queryRaw`SELECT "id" FROM "Role" WHERE "id"=${id} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id"=${policy.departmentId} FOR SHARE`;
  const collaborators=await tx.scheduleCollaborator.findMany({where:{userId:{in:config.candidateIds}},select:{id:true},orderBy:{id:'asc'}});
  for(const c of collaborators)await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id"=${c.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "ScheduleAreaGrant" WHERE "userId"=${policy.ownerId} FOR SHARE`;
  for(const d of delegations.sort((a,b)=>a.id.localeCompare(b.id)))await tx.$queryRaw`SELECT "id" FROM "HousekeepingDelegation" WHERE "id"=${d.id} FOR SHARE`;
}

/** Read-only, bounded evidence. Cross-area conflicts stay internal; no absence notes leave this service. */
export async function previewSubstitutionAvailability(actor:CurrentUser, policy:Policy, work:SubstitutionWork, now=new Date(), tx:Tx=prisma, lockSources=false, cache?:SubstitutionReadCache):Promise<SubstitutionPreview> {
  const config=substitutionSchema.parse(policy.configuration);
  const read=<T>(key:string,fn:()=>Promise<T>)=>cached(cache,`${actor.id}:${policy.id}:${policy.version}:${now.toISOString()}:${key}`,fn);
  const searchUntil=dayWindow(datePlus(hotelDateKey(now),14)).startAt;
  const base={planningOnly:true as const,generatedAt:now,searchUntil,policyVersion:policy.version,sourceRevision:work.updatedAt.toISOString(),responsible:null,policyState:(policy.revokedAt?'REVOKED':policy.expiresAt<=now?'EXPIRED':policy.enabled?'ACTIVE':'PAUSED') as SubstitutionPreview['policyState']};
  const empty=(state:SubstitutionPreview['state'],reasonCode:string):SubstitutionPreview=>({...base,state,reasonCode,selection:null,eligibleNow:false});
  if(actor.id!==policy.ownerId||!actor.permissions.includes('system.configure'))return empty('ACCESS_UNAVAILABLE','POLICY_ACCESS_REQUIRED');
  if(policy.revokedAt||policy.expiresAt<=now)return empty('AUTHORIZATION_EXPIRES','POLICY_NOT_CURRENT');
  if(!substitutionStillPending(work,policy,now))return empty('WORK_CHANGED','WORK_NO_LONGER_PENDING');
  const authority=work.kind==='housekeeping'?await read('authority',()=>hkCapability(actor,policy.departmentId,'housekeeping.assign',tx,now)):actor.permissions.includes(work.kind==='entry'?'entry.edit':'task.assign');
  if(!authority)return empty('ACCESS_UNAVAILABLE','ASSIGNMENT_PERMISSION_REQUIRED');
  if(!scheduleTeamAccess(actor))return empty('ACCESS_UNAVAILABLE','SCHEDULE_ACCESS_REQUIRED');
  const areas=await read('areas',()=>scheduleAreaIds(actor,true,tx));
  if(areas&&!areas.includes(policy.departmentId))return empty('ACCESS_UNAVAILABLE','SCHEDULE_AREA_REQUIRED');
  const people=await read('people',()=>tx.user.findMany({where:{id:{in:config.candidateIds},active:true,deletedAt:null,hiddenFromSelectors:false,role:{operational:true},OR:[{departmentId:policy.departmentId},{scheduleCollaborator:{active:true,memberships:{some:{departmentId:policy.departmentId,active:true}}}}]},include:{role:{include:{permissions:{include:{permission:true}}}},scheduleCollaborator:true}}));
  const originalVeto=work.kind==='housekeeping'&&work.workDate?await read(`original:${work.workDate}`,()=>tx.housekeepingDayMember.findMany({where:{departmentId:policy.departmentId,userId:{in:config.candidateIds},workDate:work.workDate!,available:false},select:{userId:true,workDate:true}})):[];
  const eligible:string[]=[];
  for(const person of people){
    if(person.id===work.ownerId||!person.scheduleCollaborator?.active)continue;
    const access={roleKey:person.role.key,permissions:person.role.permissions.map(p=>p.permission.key as PermissionKey)};
    if(work.kind!=='housekeeping'&&isHkFocused(access))continue;
    if(originalVeto.some(day=>day.userId===person.id&&day.workDate===work.workDate))continue;
    try {
      if(work.kind==='housekeeping')await read(`worker:${person.id}:${work.workDate}`,()=>validateWorker(tx,policy.departmentId,person.id,work.workDate??undefined));
      if(work.kind==='task')await assertTaskSourceRecipients(tx,[actor.id,person.id],work,lockSources);
      eligible.push(person.id);
    } catch(error) { if(!(error instanceof RuleError))throw error; }
  }
  const include={plan:{select:{id:true,departmentId:true,status:true,publishedAt:true,publishedVersion:true}},collaborator:{select:{userId:true}}} as const;
  // Bound offer starts by the approved horizon, then independently bound conflict
  // context by the latest effective end. A last-day night can outlive that horizon.
  const offers=people.length?await read('offers',()=>tx.scheduleSlot.findMany({where:{cancelledAt:null,kind:'TURNO',plan:{departmentId:policy.departmentId,status:'PUBLICADO'},collaborator:{userId:{in:people.map(p=>p.id)},active:true},startAt:{lt:searchUntil},endAt:{gt:now}},include,orderBy:[{startAt:'asc'},{id:'asc'}],take:2001})):[];
  if(offers.length>2000)return empty('INCOMPLETE','INCOMPLETE_EVIDENCE');
  const offerCoverage=coverageSlots(offers);
  const contextFrom=new Date(Math.min(now.getTime(),...offerCoverage.flatMap(slot=>slot.startAt?[slot.startAt.getTime()]:[])));
  const contextUntil=new Date(Math.max(searchUntil.getTime(),...offerCoverage.flatMap(slot=>slot.endAt?[slot.endAt.getTime()]:[])));
  const fromDate=hotelDateKey(contextFrom),toDate=hotelDateKey(new Date(contextUntil.getTime()-1));
  const rows=offers.length?await read('context',()=>tx.scheduleSlot.findMany({where:{cancelledAt:null,plan:{status:'PUBLICADO'},collaborator:{userId:{in:people.map(p=>p.id)},active:true},OR:[{startAt:{lt:contextUntil},endAt:{gt:contextFrom}},{kind:{in:['LIBRE','AUSENCIA','VACACIONES']},date:{gte:new Date(fromDate),lte:new Date(toDate)}}]},include,orderBy:[{startAt:{sort:'asc',nulls:'last'}},{id:'asc'}],take:2001})):[];
  if(rows.length>2000)return empty('INCOMPLETE','INCOMPLETE_EVIDENCE');
  const effective=coverageSlots(rows);
  const slots:SubstitutionSlotEvidence[]=effective.filter(s=>s.plan.departmentId===policy.departmentId).map(s=>({...s,userId:s.collaborator.userId!,planStatus:s.plan.status,publishedVersion:s.plan.publishedVersion,publishedAt:s.plan.publishedAt,date:s.date.toISOString().slice(0,10)}));
  const unavailable=work.kind==='housekeeping'?await read(`days:${work.workDate}`,()=>tx.housekeepingDayMember.findMany({where:{departmentId:policy.departmentId,userId:{in:people.map(p=>p.id)},available:false,OR:[{workDate:{gte:fromDate,lte:toDate}},...(work.workDate?[{workDate:work.workDate}]:[])]},select:{userId:true,workDate:true}})):[];
  const delegated=work.kind==='housekeeping'&&actor.roleKey!=='ADMINISTRADOR_SISTEMA'&&!actor.permissions.some(p=>['housekeeping.assign','housekeeping.manage'].includes(p));
  const grants=delegated?await read('grants',()=>tx.housekeepingDelegation.findMany({where:{userId:actor.id,departmentId:policy.departmentId,permission:'housekeeping.assign',revokedAt:null,startsAt:{lt:searchUntil},endsAt:{gt:now},grantedBy:{active:true,deletedAt:null,role:{OR:[{key:'ADMINISTRADOR_SISTEMA'},{permissions:{some:{permission:{key:'housekeeping.plan'}}}}]}}},select:{startsAt:true,endsAt:true}})):[];
  const blocked:string[]=[];
  const authorityEnds=new Map<string,Date>();
  for(const slot of slots){
    if(slot.kind!=='TURNO'||!slot.startAt||!slot.endAt)continue;
    const conflict=effective.some(other=>{
      if(other.id===slot.id||other.collaboratorId!==slot.collaboratorId)return false;
      if(other.kind==='LIBRE')return other.date.toISOString().slice(0,10)===slot.date;
      if(['AUSENCIA','VACACIONES'].includes(other.kind)){const w=dayWindow(other.date.toISOString().slice(0,10));return slot.startAt!<w.endAt&&slot.endAt!>w.startAt;}
      return other.kind==='TURNO'&&!!other.startAt&&!!other.endAt&&slot.startAt!<other.endAt&&slot.endAt!>other.startAt;
    });
    const dates=dateDays(hotelDateKey(slot.startAt),hotelDateKey(new Date(slot.endAt.getTime()-1)));
    if(conflict||unavailable.some(day=>day.userId===slot.userId&&(day.workDate===work.workDate||dates.includes(day.workDate)))){blocked.push(slot.id);continue;}
    if(delegated){
      const at=new Date(Math.max(now.getTime(),slot.startAt.getTime()));
      const grant=grants.filter(g=>g.startsAt<=at&&g.endsAt>at).sort((a,b)=>b.endsAt.getTime()-a.endsAt.getTime())[0];
      if(!grant){blocked.push(slot.id);continue;}
      authorityEnds.set(slot.id,grant.endsAt);
    }
  }
  const result=selectSubstitutionAvailability({candidateIds:config.candidateIds,currentOwnerId:work.ownerId,eligibleUserIds:eligible,slots,now,expiresAt:policy.expiresAt,searchUntil,blockedSlotIds:blocked});
  if(!result.selection&&originalVeto.some(day=>day.workDate===work.workDate))return empty('REVIEW_REQUIRED','HK_ORIGINAL_DATE_UNAVAILABLE');
  const selection=result.selection;
  if(selection){const until=authorityEnds.get(selection.slotId);if(until&&until<selection.eligibleUntil)selection.eligibleUntil=until;}
  return {...base,...result,responsible:selection?people.find(p=>p.id===selection.userId)?.name??null:null};
}
