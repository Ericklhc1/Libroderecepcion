import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditAction, EntryType, ShiftType, ShiftStatus } from '@prisma/client';
import { createUser, createShift, openShiftAs, seedCatalog, resetOperationalData, prisma, ROLE_KEYS } from './helpers';
import { getShiftBriefing, prepareHandover, receiveHandover, confirmHandoverReviewStep, sendHandover, closeShift, startReceptionShift, confirmReceptionReviewStep } from '@/server/services/shifts';
import { listPendingClosureReviews, reviewShiftClosure } from '@/server/services/closure-review';
import { supervisionAttentionCounts, getSupervisionData } from '@/server/services/supervision';
import { createEntry, getSubjectEntry, updateEntryVisibility, updateEntry } from '@/server/services/entries';
import { lockReceptionSummary,buildHandoverSnapshot, visibleSnapshotItems,visibleHandover } from '@/server/services/handover-snapshot';
import { getBookItems } from '@/server/services/book';
import { getCoordinationBoard } from '@/server/services/coordination';
import { searchOperationalRecords } from '@/server/services/global-search';
import { notificationWhereForUser } from '@/server/services/notification-access';
import { getHkSources } from '@/server/services/housekeeping-work';
import { getTask, createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import { getWebPushPayload } from '@/server/services/web-push';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { markReadableNotifications } from '@/server/services/notification-access';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import { addComment } from '@/server/services/comments';
import { lockEntrySourcesForRecord } from '@/server/services/entry-visibility';
import { alertReadWhere, followUpReadWhere } from '@/server/services/followup-access';
import { createManualAlert } from '@/server/services/alerts';
import { getShiftMetrics, getMetrics, defaultRange } from '@/server/services/metrics';
import { getDashboardData } from '@/server/services/dashboard';
import { createHkWork, getHkWorkday, saveHkHandover, changeHkWork } from '@/server/services/housekeeping-work';
import { createHousekeepingRequest, getHousekeepingBoard, searchHousekeepingRecords, changeHousekeepingRequest } from '@/server/services/housekeeping';
import { hotelDateKey } from '@/domain/time';
import {saveScheduleCollaborator,removeScheduleMembership} from '@/server/services/schedule-catalog';
import {updateAdministrativeUser} from '@/server/services/schedule-admin-safety';
import { entryCreateSchema } from '@/server/schemas';
import type { CurrentUser } from '@/server/auth/current-user';

let reception: CurrentUser, other: CurrentUser, supervisor: CurrentUser;
async function sentShift() {
  const shift = await createShift({userId:reception.id,type:ShiftType.DIA});
  await openShiftAs(reception,shift); await receiveHandover(reception,{shiftId:shift.id});
  const handover=await prepareHandover(reception,shift.id);
  await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
  await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
  await sendHandover(reception,{shiftId:shift.id});
  return {shift,handover};
}
async function sentShiftWithUrgent(){
  const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await sendHandover(reception,{shiftId:shift.id});return {shift,handover};
}
async function notice(author=supervisor, extra: Partial<Parameters<typeof createEntry>[1]>={}) {
  return createEntry(author,{type:EntryType.NOVEDAD,title:'Novedad de visibilidad',description:'Descripción completa para recepción.',priority:'MEDIA',tags:[],requiresFollowUp:false,...extra});
}

describe('AROH 1.64 · cierre exclusivo de Supervisión y visibilidad por área',()=>{
  beforeAll(seedCatalog);
  beforeEach(async()=>{await resetOperationalData(); reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST}); other=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST}); supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});});


  for(const type of [EntryType.CAJA,EntryType.MANTENIMIENTO])for(const kind of ['alert','followup'] as const)it(`habilitar origen ${type} invalida el borrador por su ${kind} operativo`,async()=>{
    const e=await notice(supervisor,{type,includeInReceptionHandover:false});
    const task=kind==='followup'?await prisma.task.create({data:{title:'Origen indirecto',createdById:supervisor.id,entryId:e.id}}):null;
    const linked=kind==='alert'?await createManualAlert(supervisor,{entryId:e.id,type:'OTRO',level:'ATENCION',title:'Alerta de origen no novedad'}):await createFollowUp(supervisor,{taskId:task!.id,action:'Seguimiento de origen no novedad',visibility:'OPERATIVO'});
    const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:linked.id}})).toBe(0);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({receptionSummaryRevision:1,pendingsReviewedAt:null,finalReviewAt:null});
    await expect(sendHandover(reception,{shiftId:shift.id})).rejects.toThrow(/Regenera/);
    await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:linked.id}})).toBe(1);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(0);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});await sendHandover(reception,{shiftId:shift.id});
    expect(JSON.stringify((await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}})).snapshot)).toContain(linked.id);
  });

  for(const roleKey of [ROLE_KEYS.SUPERVISOR,ROLE_KEYS.SYSTEM_ADMIN])it(`avisos históricos de cierre exigen shift.manage vigente para ${roleKey}`,async()=>{
    const reader=await createUser({roleKey});
    const alert=await prisma.alert.create({data:{title:'Validar cierre de turno',type:'OTRO',dedupeKey:'shift-validation:synthetic-permission'}});
    const task=await prisma.task.create({data:{title:alert.title,createdById:supervisor.id,alertId:alert.id}});
    const notices=await Promise.all([['Alert',alert.id],['Task',task.id]].map(([entity,entityId])=>prisma.notification.create({data:{userId:reader.id,type:'ACCION_REQUERIDA',title:alert.title,entity,entityId}})));
    const ordinary=await prisma.notification.create({data:{userId:reader.id,type:'ACTUALIZACION_OPERATIVA',title:'Aviso ordinario'}});
    const endpoint=`https://push.invalid/closure-permission-${roleKey}`;await prisma.pushSubscription.create({data:{userId:reader.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual(expect.arrayContaining(notices.map(n=>n.id)));
    const role=await prisma.role.findUniqueOrThrow({where:{key:roleKey}});const permission=await prisma.permission.findUniqueOrThrow({where:{key:'shift.manage'}});
    await prisma.rolePermission.deleteMany({where:{roleId:role.id,permissionId:permission.id}});
    try{
      expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual([ordinary.id]);
      expect((await getWebPushPayload({userId:reader.id,endpoint})).items.map(n=>n.id)).toEqual([ordinary.id]);
      for(const n of notices)expect(await markReadableNotifications(reader.id,n.id)).toMatchObject({count:0});
      expect(await prisma.notification.count({where:{id:{in:notices.map(n=>n.id)},readAt:null}})).toBe(2);
    }finally{await prisma.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});}
    expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual(expect.arrayContaining(notices.map(n=>n.id)));
  });

  for(const selection of ['include','area','both'] as const)it(`habilitar una novedad antes excluida por ${selection} invalida revisión y exige regenerar sin borrar evidencia manual`,async()=>{
    const receptionId=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    const e=await notice(supervisor,{includeInReceptionHandover:selection==='area',hiddenDepartmentIds:selection==='include'?[]:[receptionId]});
    const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(0);
    const manual=await prisma.handoverItem.create({data:{handoverId:handover.id,manual:true,title:'Nota manual conservada',section:'Notas',level:'INFORMATIVO'}});
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    const invalidated=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});
    expect(invalidated).toMatchObject({receptionSummaryRevision:1,receptionSummaryPreparedRevision:0,pendingsReviewedAt:null,finalReviewAt:null,urgentAcknowledgedAt:null});
    expect(await prisma.handoverItem.findUnique({where:{id:manual.id}})).toMatchObject({title:'Nota manual conservada'});
    await expect(confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'})).rejects.toThrow(/Regenera/);
    await expect(sendHandover(reception,{shiftId:shift.id})).rejects.toThrow(/Regenera/);
    const audit=await prisma.auditLog.findFirstOrThrow({where:{entity:'OperationalEntry',entityId:e.id,summary:{startsWith:'Visibilidad'}}});
    expect(audit.before).toMatchObject({receptionDrafts:[{id:handover.id,receptionSummaryRevision:0}]});expect(audit.after).toMatchObject({receptionDrafts:[{id:handover.id,receptionSummaryRevision:1,finalReviewAt:null}]});
    await prepareHandover(reception,shift.id);
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({receptionSummaryRevision:1,receptionSummaryPreparedRevision:1});
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);expect(await prisma.handoverItem.findUnique({where:{id:manual.id}})).not.toBeNull();
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});await sendHandover(reception,{shiftId:shift.id});
    const sent=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});expect(JSON.stringify(sent.snapshot)).toContain(e.id);expect(JSON.stringify(sent.snapshot)).toContain('Nota manual conservada');
  });


  it('desocultar otra área del emisor invalida exactamente su borrador y exige regenerarlo',async()=>{
    const adminId=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;
    await prisma.user.update({where:{id:reception.id},data:{departmentId:adminId}});reception={...reception,departmentId:adminId};
    const e=await notice(supervisor,{hiddenDepartmentIds:[adminId]});const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(0);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    const source=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:source.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({receptionSummaryRevision:1,pendingsReviewedAt:null,finalReviewAt:null});
    await expect(sendHandover(reception,{shiftId:shift.id})).rejects.toThrow(/Regenera/);
    await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);
  });

  it('otro participante regenera con su selección y firma completa, sin heredar la revisión ajena',async()=>{
    const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;await prisma.user.update({where:{id:reception.id},data:{departmentId:area}});reception={...reception,departmentId:area};const e=await notice(supervisor,{hiddenDepartmentIds:[area]});
    const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});await prisma.shiftAssignment.create({data:{shiftId:shift.id,userId:other.id,role:'APOYO',activatedAt:new Date()}});const handover=await prepareHandover(reception,shift.id);const manual=await prisma.handoverItem.create({data:{handoverId:handover.id,manual:true,title:'Nota conservada entre emisores',section:'Notas',level:'INFORMATIVO'}});
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(0);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    await expect(confirmHandoverReviewStep(other,{handoverId:handover.id,step:'PENDINGS'})).rejects.toThrow(/Regenera.*tu cuenta/);await expect(sendHandover(other,{shiftId:shift.id})).rejects.toThrow(/Regenera.*tu cuenta/);
    const prepared=await prepareHandover(other,shift.id);expect(prepared).toMatchObject({issuedById:other.id,pendingsReviewedAt:null,finalReviewAt:null});expect(await prisma.handoverItem.findUnique({where:{id:manual.id}})).not.toBeNull();expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);await confirmHandoverReviewStep(other,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(other,{handoverId:handover.id,step:'FINAL'});const sent=await sendHandover(other,{shiftId:shift.id});expect(sent.issuedById).toBe(other.id);expect(JSON.stringify(sent.snapshot)).toContain(e.id);
  });

  it('el contador de revisión usa la cola canónica y no suma el cierre como alerta crítica',async()=>{
    const shift=await createShift({userId:reception.id,type:'DIA'});await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date()}});const review=await getSupervisionData(supervisor);expect(supervisionAttentionCounts(review.blocks)).toEqual({critical:0,pendingClosures:1});expect(review.blocks.find(b=>b.key==='cierres-validacion')?.rows.map(r=>r.id)).toContain(shift.id);
  });

  it('cambiar áreas del preparador invalida sólo su borrador con auditoría y conserva notas manuales',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;const e=await notice(supervisor,{hiddenDepartmentIds:[area]});const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);const manual=await prisma.handoverItem.create({data:{handoverId:handover.id,manual:true,title:'Nota conservada al cambiar áreas',section:'Notas',level:'INFORMATIVO'}});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    await saveScheduleCollaborator(admin,{userId:reception.id,departmentIds:[area]});expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({receptionSummaryRevision:1,pendingsReviewedAt:null,finalReviewAt:null});await expect(sendHandover(reception,{shiftId:shift.id})).rejects.toThrow(/Regenera/);await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(0);expect(await prisma.handoverItem.findUnique({where:{id:manual.id}})).not.toBeNull();expect(await prisma.auditLog.count({where:{entity:'ShiftHandover',entityId:handover.id,summary:{contains:'cambio de áreas del emisor'},userId:admin.id}})).toBe(1);
  });

  for(const writer of ['membership-add','membership-remove','primary-department'] as const)for(const action of ['FINAL','RECEIVE'] as const)it(`áreas de receptor ${writer} serializan ${action} y releen la identidad`,async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;const desk=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    await notice(supervisor,{priority:'CRITICA',title:'URGENTE_IDENTIDAD_A'});await notice(supervisor,{priority:'MEDIA',title:'FILA_IDENTIDAD_B',hiddenDepartmentIds:[area]});const {shift,handover}=await sentShiftWithUrgent();await closeShift(reception,{shiftId:shift.id});
    let collaboratorId:string|undefined;if(writer==='primary-department'){await prisma.user.update({where:{id:other.id},data:{departmentId:area}});other={...other,departmentId:area};}else{collaboratorId=(await saveScheduleCollaborator(admin,{userId:other.id,departmentIds:[writer==='membership-remove'?area:desk]})).id;}
    const incoming=await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});if(action==='RECEIVE')await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});const photo=(await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}})).snapshot;
    const account=await prisma.user.findUniqueOrThrow({where:{id:other.id}});const version=collaboratorId?(await prisma.scheduleCollaborator.findUniqueOrThrow({where:{id:collaboratorId}})).version:0;
    let ready!:()=>void;let release!:()=>void;const locked=new Promise<void>(r=>{ready=r;});const gate=new Promise<void>(r=>{release=r;});const holder=prisma.$transaction(async tx=>{await lockReceptionSummary(tx);ready();await gate;});await locked;
    const change=writer==='membership-add'?saveScheduleCollaborator(admin,{userId:other.id,departmentIds:[area]}):writer==='membership-remove'?removeScheduleMembership(admin,{collaboratorId,departmentId:area,version,reason:'Cambio sintético de pertenencia'}):updateAdministrativeUser(admin,{id:other.id,name:account.name,email:account.email??undefined,emailNotificationsEnabled:account.emailNotificationsEnabled,hiddenFromSelectors:account.hiddenFromSelectors,roleId:account.roleId,departmentId:desk,phone:account.phone,active:account.active});
    let attempt:Promise<{ok:boolean;error?:unknown}>|undefined;let completed=false;
    const waiters=async(minimum:number)=>{let count=0;for(let i=0;i<50&&count<minimum;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=(hashtext('aroh.reception-handover-summary')::bigint & 4294967295)::oid`;count=rows[0]!.count;if(count<minimum)await new Promise(r=>setTimeout(r,20));}return count;};
    try {expect(await waiters(1)).toBe(1);attempt=(action==='FINAL'?confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true}):receiveHandover(other,{handoverId:handover.id})).then(()=>({ok:true}),error=>({ok:false,error})).finally(()=>{completed=true;});expect(await waiters(2)).toBe(2);expect(completed).toBe(false);}finally{release();await holder;}
    await change;const result=await attempt!;expect(result.ok).toBe(false);expect(String(result.error)).toMatch(/entrega visible cambió/);expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'ENVIADA',receivedAt:null,snapshot:photo});expect(await prisma.shift.findUnique({where:{id:incoming.id}})).toMatchObject({status:'INICIADO'});expect(await prisma.auditLog.count({where:{entity:'ShiftHandover',entityId:handover.id,action:'TURNO_RECIBIR'}})).toBe(0);
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await receiveHandover(other,{handoverId:handover.id});expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'RECIBIDA',snapshot:photo});
  });

  it('si falla la auditoría de visibilidad se revierten también la invalidación y los sellos del borrador',async()=>{
    const e=await notice(supervisor,{includeInReceptionHandover:false});const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    const before=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});const source=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});const auditCount=await prisma.auditLog.count();
    // Simulate a mandatory audit failure through its real FK, without mocking DB writes.
    await expect(updateEntryVisibility({...supervisor,id:'missing-audit-user-synthetic-164',isSystemAdmin:true},{id:e.id,revision:source.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true})).rejects.toThrow();
    expect(await prisma.operationalEntry.findUnique({where:{id:e.id}})).toMatchObject({includeInReceptionHandover:false,updatedAt:source.updatedAt});
    const after=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});expect(after.receptionSummaryRevision).toBe(before.receptionSummaryRevision);expect(after.pendingsReviewedAt).toEqual(before.pendingsReviewedAt);expect(after.finalReviewAt).toEqual(before.finalReviewAt);expect(await prisma.auditLog.count()).toBe(auditCount);
  });


  it('desocultar después de enviar no convierte una fila del borrador excluida en contenido de la foto enviada',async()=>{
    const e=await notice(supervisor,{priority:'CRITICA'});const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);
    let source=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:source.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:false});
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});await sendHandover(reception,{shiftId:shift.id});
    const before=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});expect(JSON.stringify(before.snapshot)).not.toContain(e.id);expect(before.items.some(i=>i.refId===e.id)).toBe(true);
    source=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:source.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    const after=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});expect(after.snapshot).toEqual(before.snapshot);expect(after.items.some(i=>i.refId===e.id)).toBe(true);
    expect((await visibleHandover(reception,after)).items.some(i=>i.refId===e.id)).toBe(false);
    const context=await executeFrontiPageContextTool(other,resolveFrontiPageContext({pathname:`/turno/entrega/${handover.id}`}));
    expect(JSON.stringify(context)).not.toContain(e.id);expect(JSON.stringify(context)).not.toContain(e.title);
    await closeShift(reception,{shiftId:shift.id});
    await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});
    const reviewed=await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'});
    expect(reviewed.receiverFinalReviewAt).not.toBeNull();expect(reviewed.receiverUrgentAcknowledgedAt).toBeNull();
    await receiveHandover(other,{handoverId:handover.id});
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'RECIBIDA',snapshot:before.snapshot});
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);
  });

  for(const action of ['FINAL','RECEIVE'] as const)for(const terminal of [false,true])for(const selection of ['include','other-area'] as const)it(`visibilidad concurrente ${selection} serializa ${action} de receptor con urgente fotografiado ${terminal?'resuelto':'activo'}`,async()=>{
    const e=await notice(supervisor,{priority:'CRITICA'});const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await sendHandover(reception,{shiftId:shift.id});await closeShift(reception,{shiftId:shift.id});
    if(terminal)await prisma.operationalEntry.update({where:{id:e.id},data:{status:'RESUELTO',closedAt:new Date()}});
    const adminId=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;
    if(selection==='other-area'){await prisma.user.update({where:{id:other.id},data:{departmentId:adminId}});other={...other,departmentId:adminId};}
    let current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:selection==='other-area'?[adminId]:[],includeInReceptionHandover:selection==='other-area'});
    const incoming=await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});
    if(action==='RECEIVE')await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'});
    let ready!:()=>void;let release!:()=>void;const locked=new Promise<void>(r=>{ready=r;});const gate=new Promise<void>(r=>{release=r;});
    const holder=prisma.$transaction(async tx=>{await lockReceptionSummary(tx);ready();await gate;});await locked;
    current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});
    const enable=updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    let attempt:Promise<{ok:boolean;error?:unknown}>|undefined;
    try {
      // Wait for the actual visibility transaction to queue first on PostgreSQL's lock.
      let waiting=0;for(let i=0;i<50&&!waiting;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=(hashtext('aroh.reception-handover-summary')::bigint & 4294967295)::oid`;waiting=rows[0]!.count;if(!waiting)await new Promise(r=>setTimeout(r,20));}
      expect(waiting).toBeGreaterThan(0);
      let completed=false;
      attempt=(action==='FINAL'?confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'}):receiveHandover(other,{handoverId:handover.id})).then(()=>({ok:true}),error=>({ok:false,error})).finally(()=>{completed=true;});
      let receptionWaiting=0;for(let i=0;i<50&&receptionWaiting<2&&!completed;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=(hashtext('aroh.reception-handover-summary')::bigint & 4294967295)::oid`;receptionWaiting=rows[0]!.count;if(receptionWaiting<2)await new Promise(r=>setTimeout(r,20));}
      expect(receptionWaiting).toBe(2);expect(completed).toBe(false);
    } finally {release();await holder;}
    await enable;const result=await attempt!;expect(result.ok).toBe(false);expect(String(result.error)).toMatch(/urgentes|custodia cambió|entrega visible cambió/);
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'ENVIADA',receivedAt:null,receiverUrgentAcknowledgedAt:null});expect(await prisma.shift.findUnique({where:{id:incoming.id}})).toMatchObject({status:'INICIADO'});
    expect(await prisma.auditLog.count({where:{entity:'ShiftHandover',entityId:handover.id,action:'TURNO_RECIBIR'}})).toBe(0);
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await receiveHandover(other,{handoverId:handover.id});expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'RECIBIDA'});
  });

  it('habilitar una novedad después de enviar conserva íntegra la fotografía enviada',async()=>{
    const e=await notice(supervisor,{includeInReceptionHandover:false});const {handover}=await sentShift();const before=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    const after=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});expect(after.snapshot).toEqual(before.snapshot);expect(after.receptionSummaryRevision).toBe(before.receptionSummaryRevision);expect(after.finalReviewAt).toEqual(before.finalReviewAt);
  });

  for(const kind of ['task','closure','excluded-entry'] as const)it(`un urgente histórico ${kind} excluido no bloquea FINAL ni envío, sin regenerar ni borrar evidencia`,async()=>{
    const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);
    let refType='task',refId:string|null=null,title='Urgente de tarea histórica';
    if(kind==='closure'){const alert=await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Validar cierre de turno',dedupeKey:'shift-validation:synthetic-old-draft'}});refType='alert';refId=alert.id;title=alert.title;}
    if(kind==='excluded-entry'){const e=await notice(supervisor,{includeInReceptionHandover:false});refType='entry';refId=e.id;title=e.title;}
    const old=await prisma.handoverItem.create({data:{handoverId:handover.id,level:'URGENTE',section:kind==='task'?'Tareas pendientes':'Novedades activas',title,refType,refId,order:0}});
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
    const final=await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    expect(final.urgentAcknowledgedAt).toBeNull();
    const sent=await sendHandover(reception,{shiftId:shift.id});
    expect(sent.status).toBe('ENVIADA');expect(sent.snapshot).toMatchObject({counts:{urgente:0}});
    expect(await prisma.handoverItem.findUnique({where:{id:old.id}})).not.toBeNull();
    expect(await visibleSnapshotItems(reception,[old],true)).toEqual([]);
  });

  it('un urgente visible todavía exige reconocimiento y se cuenta al enviar',async()=>{
    await notice(supervisor,{priority:'CRITICA'});
    const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
    await expect(confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'})).rejects.toThrow(/Hay puntos urgentes/);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});
    expect((await sendHandover(reception,{shiftId:shift.id})).snapshot).toMatchObject({counts:{urgente:1}});
  });

  it('el resumen activo, resuelto y la lectura histórica sólo incluyen NOVEDAD/INCIDENCIA como entradas',async()=>{
    const shift=await createShift({userId:reception.id,type:'DIA'});const rows=[];
    for(const type of Object.values(EntryType))for(const resolved of [false,true])rows.push(await prisma.operationalEntry.create({data:{type,title:`TIPO_${type}_${resolved?'RESUELTO':'ACTIVO'}`,description:'Contenido sintético por tipo',createdById:supervisor.id,shiftId:shift.id,status:resolved?'RESUELTO':'ABIERTO',closedAt:resolved?new Date():null}}));
    const snapshot=await buildHandoverSnapshot(reception,new Date(),{shiftId:shift.id});const allowed=rows.filter(e=>e.type==='NOVEDAD'||e.type==='INCIDENCIA');expect(snapshot.filter(i=>i.refType==='entry').map(i=>i.refId).sort()).toEqual(allowed.map(e=>e.id).sort());
    const historical=rows.map(e=>({refType:'entry',refId:e.id,title:e.title,detail:e.description,section:'Novedades activas',level:'URGENTE' as const}));
    expect((await visibleSnapshotItems(reception,historical,true)).map(i=>i.refId).sort()).toEqual(allowed.map(e=>e.id).sort());expect(await prisma.operationalEntry.count()).toBe(rows.length);
  });

  for(const status of ['RESUELTO','CERRADO'] as const)for(const ownShift of [true,false])it(`habilitar ${status} invalida sólo el borrador que selecciona su turno: own=${ownShift}`,async()=>{
    const e=await notice(supervisor,{includeInReceptionHandover:false});const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    await prisma.operationalEntry.update({where:{id:e.id},data:{status,closedAt:new Date(),shiftId:ownShift?shift.id:null}});
    const handover=await prepareHandover(reception,shift.id);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    const before=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});const after=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});
    if(ownShift){expect(after).toMatchObject({receptionSummaryRevision:before.receptionSummaryRevision+1,pendingsReviewedAt:null,finalReviewAt:null});await expect(sendHandover(reception,{shiftId:shift.id})).rejects.toThrow(/Regenera/);await prepareHandover(reception,shift.id);expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});}
    else{expect(after.receptionSummaryRevision).toBe(before.receptionSummaryRevision);expect(after.finalReviewAt).toEqual(before.finalReviewAt);}
    const sent=await sendHandover(reception,{shiftId:shift.id});expect(JSON.stringify(sent.snapshot).includes(e.id)).toBe(ownShift);expect(await prisma.operationalEntry.findUnique({where:{id:e.id}})).toMatchObject({status});
  });

  for(const priority of ['CRITICA','ALTA','MEDIA'] as const)for(const selection of ['include','area'] as const)it(`la aprobación de urgente A no cubre B ${priority} que se habilita por ${selection}`,async()=>{
    const area=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    await notice(supervisor,{priority:'CRITICA',title:'URGENTE_A_REVISADO'});const b=await notice(supervisor,{priority,title:'B_FOTOGRAFIADO_OCULTO'});
    const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await sendHandover(reception,{shiftId:shift.id});await closeShift(reception,{shiftId:shift.id});
    let current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:b.id}});await updateEntryVisibility(supervisor,{id:b.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:selection==='area'?[area]:[],includeInReceptionHandover:selection==='area'});
    const incoming=await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});
    const reviewed=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});expect(reviewed.receiverUrgentAcknowledgedAt).not.toBeNull();expect(reviewed.receiverBriefingSummaryKey).toBe(reviewed.receiverFinalSummaryKey);expect(reviewed.receiverFinalSummaryKey).toMatch(/^[a-f0-9]{64}$/);const signed=reviewed.snapshot;
    current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:b.id}});await updateEntryVisibility(supervisor,{id:b.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    const raw=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});expect(raw.receiverFinalReviewAt).toEqual(reviewed.receiverFinalReviewAt);expect(raw.receiverFinalSummaryKey).toBe(reviewed.receiverFinalSummaryKey);expect(raw.snapshot).toEqual(signed);
    expect(await visibleHandover(other,raw)).toMatchObject({receiverBriefingReviewedAt:null,receiverFinalReviewAt:null,receiverUrgentAcknowledgedAt:null});
    const context=await executeFrontiPageContextTool(other,resolveFrontiPageContext({pathname:`/turno/entrega/${handover.id}`}));expect(context).toMatchObject({snapshot:{receiverBriefingReviewedAt:null,receiverFinalReviewAt:null}});
    await expect(receiveHandover(other,{handoverId:handover.id})).rejects.toThrow(/entrega visible cambió/);await expect(confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true})).rejects.toThrow(/entrega visible cambió/);expect(await prisma.shift.findUnique({where:{id:incoming.id}})).toMatchObject({status:'INICIADO'});
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});await receiveHandover(other,{handoverId:handover.id});const received=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});expect(received.status).toBe('RECIBIDA');expect(received.receiverFinalSummaryKey).not.toBe(reviewed.receiverFinalSummaryKey);expect(received.snapshot).toEqual(signed);
    const audited=await prisma.auditLog.findMany({where:{entity:'ShiftHandover',entityId:handover.id,summary:{startsWith:'Revisión final de recepción confirmada'}}});expect(audited.map(a=>(a.after as {receptionSummaryKey?:string}).receptionSummaryKey)).toEqual(expect.arrayContaining([reviewed.receiverFinalSummaryKey,received.receiverFinalSummaryKey]));
  });

  it('habilitar un ítem omitido de la fotografía no invalida la revisión de lo efectivamente enviado',async()=>{
    const b=await notice(supervisor);const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});const handover=await prepareHandover(reception,shift.id);let current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:b.id}});await updateEntryVisibility(supervisor,{id:b.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:false});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});await sendHandover(reception,{shiftId:shift.id});await closeShift(reception,{shiftId:shift.id});await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'});const reviewed=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});
    current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:b.id}});await updateEntryVisibility(supervisor,{id:b.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});const raw=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});expect(await visibleHandover(other,raw)).toMatchObject({receiverBriefingReviewedAt:reviewed.receiverBriefingReviewedAt,receiverFinalReviewAt:reviewed.receiverFinalReviewAt});await receiveHandover(other,{handoverId:handover.id});expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({status:'RECIBIDA',snapshot:reviewed.snapshot});
  });

  it('una revisión enviada anterior sin huella requiere revisión nueva y una recibida histórica conserva sus sellos',async()=>{
    const {shift,handover}=await sentShift();await closeShift(reception,{shiftId:shift.id});await startReceptionShift(other,{handoverId:handover.id,type:'NOCHE'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'});
    const old=await prisma.shiftHandover.update({where:{id:handover.id},data:{receiverBriefingSummaryKey:null,receiverFinalSummaryKey:null},include:{items:true}});
    expect(await visibleHandover(other,old)).toMatchObject({receiverBriefingReviewedAt:null,receiverFinalReviewAt:null});await expect(receiveHandover(other,{handoverId:handover.id})).rejects.toThrow(/entrega visible cambió/);
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).toMatchObject({receiverFinalReviewAt:old.receiverFinalReviewAt,snapshot:old.snapshot});
    await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'BRIEFING'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'CUSTODY'});await confirmReceptionReviewStep(other,{handoverId:handover.id,step:'FINAL'});await receiveHandover(other,{handoverId:handover.id});
    const signed=await prisma.shiftHandover.update({where:{id:handover.id},data:{receiverBriefingSummaryKey:null,receiverFinalSummaryKey:null},include:{items:true}});expect(await visibleHandover(other,signed)).toMatchObject({status:'RECIBIDA',receiverBriefingReviewedAt:signed.receiverBriefingReviewedAt,receiverFinalReviewAt:signed.receiverFinalReviewAt});
  });

  for(const kind of ['direct-alert','indirect-alert','indirect-followup'] as const)it(`la fotografía de ${kind} combina el área del lector y elegibilidad de Recepción`,async()=>{
    const management=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;await prisma.user.update({where:{id:management.id},data:{departmentId:area}});management.departmentId=area;
    const e=await notice(supervisor);const task=kind==='direct-alert'?null:await createTask(supervisor,{entryId:e.id,title:'Fuente sintética del aviso',priority:'MEDIA',tags:[],checklist:[]});
    const linked=kind==='indirect-followup'?await createFollowUp(supervisor,{taskId:task!.id,action:'DETALLE_FOTOGRAFIA_OCULTO_AREA',visibility:'OPERATIVO'}):await createManualAlert(supervisor,{type:'OTRO',level:'ATENCION',title:'DETALLE_FOTOGRAFIA_OCULTO_AREA',message:'Mensaje reservado por área del origen',...(task?{taskId:task.id}:{entryId:e.id})});
    const {handover}=await sentShift();
    if(kind==='indirect-alert'){
      // New summaries omit task-backed alerts. Recreate only synthetic legacy
      // photographed evidence to exercise the retained historic reader.
      const before=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});const legacy={level:'IMPORTANTE' as const,section:'Alertas activas',title:'Otra alerta: DETALLE_FOTOGRAFIA_OCULTO_AREA',detail:'Mensaje reservado por área del origen',refType:'alert',refId:linked.id,manual:false};await prisma.handoverItem.create({data:{handoverId:handover.id,...legacy}});const snapshot=before.snapshot as {items:unknown[];counts:{urgente:number;importante:number;informativo:number}};await prisma.shiftHandover.update({where:{id:handover.id},data:{snapshot:JSON.parse(JSON.stringify({...snapshot,items:[...snapshot.items,legacy],counts:{...snapshot.counts,importante:snapshot.counts.importante+1}}))}});
    }
    const photo=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});expect(photo.items.some(i=>i.refId===linked.id)).toBe(true);const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[area],includeInReceptionHandover:true});
    const raw=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});const read=await visibleHandover(management,raw);expect(JSON.stringify(read)).not.toContain('DETALLE_FOTOGRAFIA_OCULTO_AREA');expect(read.items.some(i=>i.refId===linked.id)).toBe(false);expect(await buildHandoverSnapshot(management)).toHaveLength(0);expect(read.snapshot).toMatchObject({counts:{urgente:0,importante:0,informativo:0}});expect((await visibleHandover(reception,raw)).items.some(i=>i.refId===linked.id)).toBe(true);expect((await visibleHandover(supervisor,raw)).items.some(i=>i.refId===linked.id)).toBe(true);expect(raw.snapshot).toEqual(photo.snapshot);expect(raw.items).toEqual(photo.items);
    const context=await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname:`/turno/entrega/${handover.id}`}));expect(JSON.stringify(context)).not.toContain('DETALLE_FOTOGRAFIA_OCULTO_AREA');
  });

  it('Administración y visibilidad de responsable usan el mismo orden global antes de User y no forman un deadlock',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const desk=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;const e=await notice(supervisor,{ownerId:reception.id});const account=await prisma.user.findUniqueOrThrow({where:{id:reception.id}});
    let ready!:()=>void;let release!:()=>void;const locked=new Promise<void>(r=>{ready=r;});const gate=new Promise<void>(r=>{release=r;});const holder=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "User" WHERE id=${reception.id} FOR SHARE`;ready();await gate;});await locked;
    const administration=updateAdministrativeUser(admin,{id:reception.id,name:account.name,email:account.email??undefined,emailNotificationsEnabled:account.emailNotificationsEnabled,hiddenFromSelectors:account.hiddenFromSelectors,roleId:account.roleId,departmentId:desk,phone:account.phone,active:account.active}).then(value=>({ok:true,value}),error=>({ok:false,error}));
    let visibility:Promise<{ok:boolean;error?:unknown}>|undefined;
    try {
      let waiting=0;for(let i=0;i<50&&!waiting;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;waiting=rows[0]!.count;if(!waiting)await new Promise(r=>setTimeout(r,20));}expect(waiting).toBe(1);
      visibility=updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area],includeInReceptionHandover:true}).then(()=>({ok:true}),error=>({ok:false,error}));
      let queued=0;for(let i=0;i<50&&!queued;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=(hashtext('aroh.reception-handover-summary')::bigint & 4294967295)::oid`;queued=rows[0]!.count;if(!queued)await new Promise(r=>setTimeout(r,20));}expect(queued).toBe(1);
    }finally{release();await holder;}
    expect(await administration).toMatchObject({ok:true});expect(await visibility!).toMatchObject({ok:true});expect(await prisma.user.findUnique({where:{id:reception.id}})).toMatchObject({departmentId:desk});expect(await prisma.operationalEntry.findUnique({where:{id:e.id},include:{hiddenFromDepartments:true}})).toMatchObject({includeInReceptionHandover:true,hiddenFromDepartments:[{id:area}]});
  });

  it('el lector de otra área no obtiene una novedad oculta por la fotografía de Recepción ni sus contadores',async()=>{
    const management=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});const area=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;await prisma.user.update({where:{id:management.id},data:{departmentId:area}});management.departmentId=area;
    const e=await notice(supervisor,{title:'NOV_OCULTA_GERENCIA_164'});const {handover}=await sentShift();const source=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});await updateEntryVisibility(supervisor,{id:e.id,revision:source.updatedAt.toISOString(),hiddenDepartmentIds:[area],includeInReceptionHandover:true});
    const raw=await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id},include:{items:true}});const read=await visibleHandover(management,raw);expect(JSON.stringify(read)).not.toContain(e.title);expect(read.items).toHaveLength(0);expect(read.snapshot).toMatchObject({counts:{urgente:0,importante:0,informativo:0}});expect(await buildHandoverSnapshot(management)).toHaveLength(0);
    expect((await visibleHandover(supervisor,raw)).items.some(i=>i.refId===e.id)).toBe(true);expect((await visibleHandover(reception,raw)).items.some(i=>i.refId===e.id)).toBe(true);expect((await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}})).snapshot).toEqual(raw.snapshot);
  });

  it('el cierre real con trigger nuevo crea una única acción y auditoría, sin alerta, tarea ni novedad',async()=>{
    const {shift,handover}=await sentShift();
    const closed=await closeShift(reception,{shiftId:shift.id});
    expect(closed.closureReviewRequestedAt).not.toBeNull();
    expect(await prisma.alert.count({where:{dedupeKey:`shift-validation:${shift.id}`}})).toBe(0);
    expect(await prisma.task.count({where:{shiftId:shift.id}})).toBe(0);
    expect(await prisma.operationalEntry.count()).toBe(0);
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,action:AuditAction.CREAR,summary:{startsWith:'Acción pendiente'}}})).toBe(1);
    await prisma.shift.update({where:{id:shift.id},data:{status:ShiftStatus.CERRADO}});
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,action:AuditAction.CREAR,summary:{startsWith:'Acción pendiente'}}})).toBe(1);
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const rows=(await getSupervisionData(supervisor)).blocks.find(b=>b.key==='cierres-validacion')!.rows;
    expect(rows).toMatchObject([{id:shift.id,href:`/supervision/cierres/${shift.id}`}]);
    expect(rows[0]!.ref).toContain('DIA');
    expect(JSON.stringify(await buildHandoverSnapshot(reception))).not.toContain('Validar cierre');
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).not.toBeNull();
  });

  it('la acción y su auditoría se revierten juntas si falla la transacción de cierre',async()=>{
    const {shift}=await sentShift();
    await expect(prisma.$transaction(async tx=>{await tx.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date(),closedById:reception.id}});throw Error('rollback sintético');})).rejects.toThrow('rollback sintético');
    expect((await prisma.shift.findUniqueOrThrow({where:{id:shift.id}})).closureReviewRequestedAt).toBeNull();
    expect(await prisma.auditLog.count({where:{entityId:shift.id,summary:{startsWith:'Acción pendiente'}}})).toBe(0);
  });

  it('validar/observar exige supervisor, evidencia y revisión vigente; observar mantiene pendiente',async()=>{
    const {shift}=await sentShift(); const closed=await closeShift(reception,{shiftId:shift.id});
    const input={shiftId:shift.id,decision:'OBSERVADA' as const,note:'Falta comprobante del depósito.',revision:closed.updatedAt.toISOString()};
    await expect(reviewShiftClosure(reception,input)).rejects.toThrow();
    await expect(reviewShiftClosure(supervisor,{...input,note:' '})).rejects.toThrow();
    const observed=await reviewShiftClosure(supervisor,input);
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    await expect(reviewShiftClosure(supervisor,{...input,decision:'VALIDADA'})).rejects.toThrow(/cambió/);
    const validated=await reviewShiftClosure(supervisor,{...input,decision:'VALIDADA',note:'Comprobantes revisados; depósito conforme.',revision:observed.updatedAt.toISOString()});
    expect(validated.closureReviewDecision).toBe('VALIDADA');
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).not.toContain(shift.id);
    expect(await prisma.auditLog.count({where:{entityId:shift.id,action:'CAMBIO_ESTADO',summary:{contains:'Cierre '}}})).toBe(2);
  });

  it('conserva alertas/tareas históricas, las oculta a recepción y dirige su acción al cierre concreto',async()=>{
    const {shift}=await sentShift(); await closeShift(reception,{shiftId:shift.id});
    await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const alert=await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`}});
    const task=await prisma.task.create({data:{title:'Validar cierre de turno',createdById:supervisor.id,alertId:alert.id,shiftId:shift.id}});
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const review=await getSupervisionData(supervisor);
    expect(review.blocks.find(b=>b.key==='alertas')!.rows.map(r=>r.id)).not.toContain(alert.id);
    expect(review.blocks.find(b=>b.key==='cierres-validacion')!.rows[0]!.href).toBe(`/supervision/cierres/${shift.id}`);
    expect((await getBookItems({kinds:['task','alert']},reception)).items.map(i=>i.id)).not.toContain(task.id);
    expect(await buildHandoverSnapshot(reception)).toHaveLength(0);
    const historic=[{section:'Alertas activas',level:'URGENTE' as const,title:alert.title,detail:'Histórico',refType:'alert',refId:alert.id}];
    expect(await visibleSnapshotItems(reception,historic,true)).toHaveLength(0);
    expect(await prisma.alert.findUnique({where:{id:alert.id}})).toMatchObject({title:alert.title,status:'NUEVA'});
    expect(await prisma.task.findUnique({where:{id:task.id}})).not.toBeNull();
  });

  it('Gestionar diferencia y garantía abre los registros concretos',async()=>{
    const {shift,handover}=await sentShift(); await closeShift(reception,{shiftId:shift.id});
    const alert=await prisma.alert.create({data:{title:'Diferencia de caja',message:'Falta USD 25',type:'OTRO',level:'CRITICA',handoverId:handover.id}});
    const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:reception.id,guestName:'Prueba concreta'}});
    const review=await getSupervisionData(supervisor);
    expect(review.blocks.find(b=>b.key==='alertas')!.rows.find(r=>r.id===alert.id)!.href).toBe(`/turno/entrega/${handover.id}`);
    expect(review.blocks.find(b=>b.key==='garantias')!.rows.find(r=>r.id===g.id)!.href).toBe(`/caja/garantias/${g.id}`);
  });

  it('por defecto se ve en todas las áreas y las novedades de Supervisión viajan en la entrega',async()=>{
    const e=await notice();
    expect(e.includeInReceptionHandover).toBe(true); expect(e.hiddenFromDepartments).toHaveLength(0);
    expect((await buildHandoverSnapshot(reception)).map(i=>i.refId)).toContain(e.id);
    expect((await getBookItems({kinds:['entry']},reception)).items.map(i=>i.id)).toContain(e.id);
  });

  it('creador o supervisor cambia áreas y entrega con auditoría; otros y revisiones viejas no pueden',async()=>{
    const e=await notice(reception); const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    const input={id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:false};
    await expect(updateEntryVisibility(other,input)).rejects.toThrow(/Sólo/);
    const hidden=await updateEntryVisibility(reception,input);
    expect(await prisma.auditLog.findFirst({where:{entityId:e.id,action:'EDITAR'}})).toMatchObject({after:{hiddenDepartmentIds:[area.id],includeInReceptionHandover:false}});
    expect((await getBookItems({kinds:['entry']},other)).items.map(i=>i.id)).not.toContain(e.id);
    expect((await getCoordinationBoard(other)).rows.map(i=>i.id)).not.toContain(e.id);
    expect((await getShiftBriefing(other,await createShift({userId:other.id,type:'DIA'}))).openEntries.map(i=>i.id)).not.toContain(e.id);
    await expect(addComment(other,{entryId:e.id,body:'Comentario sobre un asunto oculto'})).rejects.toThrow();
    expect((await searchOperationalRecords(other,String(e.humanId))).map(i=>i.entityId)).not.toContain(e.id);
    await expect(getSubjectEntry(other,e.id)).rejects.toThrow(/visible/);
    expect((await getSubjectEntry(reception,e.id)).id).toBe(e.id);
    expect((await getSubjectEntry(supervisor,e.id)).id).toBe(e.id);
    expect((await buildHandoverSnapshot(reception)).map(i=>i.refId)).not.toContain(e.id);
    await expect(updateEntryVisibility(supervisor,input)).rejects.toThrow(/cambió/);
    await updateEntryVisibility(supervisor,{...input,revision:hidden.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    expect((await buildHandoverSnapshot(other)).map(i=>i.refId)).toContain(e.id);
  });

  it('avisos históricos y push aplican el área actual sin borrar notificaciones',async()=>{
    const e=await notice(supervisor); const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    const n=await prisma.notification.create({data:{userId:other.id,type:'ACCION_REQUERIDA',title:e.title,entity:'OperationalEntry',entityId:e.id}});
    const ordinary=await prisma.notification.create({data:{userId:other.id,type:'ACTUALIZACION_OPERATIVA',title:'Aviso sin entidad'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const visible=await prisma.notification.findMany({where:await notificationWhereForUser(other.id)});
    expect(visible.map(row=>row.id)).not.toContain(n.id); expect(visible.map(row=>row.id)).toContain(ordinary.id);
    expect(await prisma.notification.findUnique({where:{id:n.id}})).not.toBeNull();
  });

  it('el selector de fuentes de otra área no muestra novedades ocultas',async()=>{
    const hk=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    await prisma.user.update({where:{id:hk.id},data:{departmentId:area.id}}); hk.departmentId=area.id;
    const e=await notice(supervisor,{departmentId:area.id});
    expect((await getHkSources(hk,area.id)).map(row=>row.id)).toContain(e.id);
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    expect((await getHkSources(hk,area.id)).map(row=>row.id)).not.toContain(e.id);
    expect((await getHkSources(hk,area.id,e.title)).map(row=>row.id)).not.toContain(e.id);
    expect((await getBookItems({kinds:['entry']},reception)).items.map(row=>row.id)).toContain(e.id);
  });

  it('avisos derivados, contador y push ocultan todos los vínculos y preservan su evidencia',async()=>{
    const e=await notice(supervisor);
    const t=await prisma.task.create({data:{title:'Tarea derivada oculta',createdById:supervisor.id,assigneeId:supervisor.id,entryId:e.id}});
    const a=await prisma.alert.create({data:{title:'Alerta derivada oculta',type:'OTRO',entryId:e.id}});
    const f=await prisma.followUp.create({data:{action:'Seguimiento derivado oculto',createdById:supervisor.id,ownerId:supervisor.id,entryId:e.id}});
    const notices=await Promise.all([['OperationalEntry',e.id],['Task',t.id],['Alert',a.id],['FollowUp',f.id]].map(([entity,entityId])=>prisma.notification.create({data:{userId:other.id,type:'ACCION_REQUERIDA',entity,entityId,title:'TEXTO_OCULTO'}})));
    const ordinary=await prisma.notification.create({data:{userId:other.id,type:'ACTUALIZACION_OPERATIVA',title:'Aviso visible'}});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const feed=await getNotificationFeedForUser(other.id);expect(feed.unread).toBe(1);expect(feed.items.map(n=>n.id)).toEqual([ordinary.id]);
    const endpoint='https://push.invalid/aroh-164-visibility';
    await prisma.pushSubscription.create({data:{userId:other.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    const push=await getWebPushPayload({userId:other.id,endpoint});expect(push.unread).toBe(1);expect(push.items.map(n=>n.id)).toEqual([ordinary.id]);
    for(const n of notices)expect(await markReadableNotifications(other.id,n.id)).toMatchObject({count:0});
    expect(await prisma.notification.count({where:{id:{in:notices.map(n=>n.id)},readAt:null}})).toBe(4);
  });

  it('un ID retenido no permite crear tarea, seguimiento directo/transversal ni comentario oculto',async()=>{
    const e=await notice(supervisor);const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const existingTask=await prisma.task.create({data:{entryId:e.id,title:'Origen oculto',createdById:supervisor.id}});
    const existingAlert=await prisma.alert.create({data:{entryId:e.id,title:'Origen oculto',type:'OTRO'}});
    const existingFollow=await prisma.followUp.create({data:{entryId:e.id,action:'Origen oculto',createdById:supervisor.id,ownerId:other.id}});
    const auditCount=await prisma.auditLog.count();const noticeCount=await prisma.notification.count();
    await expect(createTask(other,{entryId:e.id,title:'Trabajo prohibido',priority:'MEDIA',tags:[],checklist:[]})).rejects.toThrow();
    await expect(createFollowUp(other,{entryId:e.id,action:'Seguimiento prohibido'})).rejects.toThrow();
    await expect(createFollowUp(other,{sourceEntity:'OperationalEntry',sourceId:e.id,action:'Vínculo transversal prohibido'})).rejects.toThrow();
    for(const [sourceEntity,sourceId] of [['Task',existingTask.id],['Alert',existingAlert.id],['FollowUp',existingFollow.id]]) await expect(createFollowUp(other,{sourceEntity,sourceId,action:'Fuente retenida prohibida'})).rejects.toThrow();
    await expect(addComment(other,{entryId:e.id,body:'Comentario prohibido'})).rejects.toThrow();
    await expect(createTask(supervisor,{entryId:e.id,assigneeId:other.id,title:'Asignación invisible',priority:'MEDIA',tags:[],checklist:[]})).rejects.toThrow();
    await expect(createFollowUp(supervisor,{entryId:e.id,ownerId:other.id,action:'Responsable invisible'})).rejects.toThrow();
    expect(await prisma.task.count({where:{entryId:e.id}})).toBe(1);expect(await prisma.followUp.count({where:{OR:[{entryId:e.id},{sourceId:e.id}]}})).toBe(1);expect(await prisma.comment.count({where:{entryId:e.id}})).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditCount);expect(await prisma.notification.count()).toBe(noticeCount);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).requiresFollowUp).toBe(false);
  });

  it('los descendientes conservan el ocultamiento del origen en lectura, búsqueda y avisos',async()=>{
    const e=await notice(supervisor);const f=await createFollowUp(other,{entryId:e.id,action:'Fuente para descendiente'});
    const t=await createTask(other,{followUpId:f.id,title:'DESCENDIENTE_OCULTO',priority:'MEDIA',tags:[],checklist:[]});
    // Reassign pending linked work before hiding its source from the former owner.
    await prisma.followUp.update({where:{id:f.id},data:{ownerId:supervisor.id}});
    const n=await prisma.notification.create({data:{userId:other.id,type:'ACCION_REQUERIDA',entity:'Task',entityId:t.id,title:t.title}});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    await expect(getTask(t.id,other)).rejects.toThrow();
    expect((await searchOperationalRecords(other,t.title)).map(row=>row.entityId)).not.toContain(t.id);
    expect((await getNotificationFeedForUser(other.id)).items.map(row=>row.id)).not.toContain(n.id);
    expect(await prisma.task.findUnique({where:{id:t.id}})).not.toBeNull();
  });

  it('observar una alerta histórica materializa el pendiente aunque luego se resuelva la señal antigua',async()=>{
    const {shift}=await sentShift();await closeShift(reception,{shiftId:shift.id});
    const legacyShift=await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const a=await prisma.alert.create({data:{title:'Validar cierre de turno',type:'OTRO',dedupeKey:`shift-validation:${shift.id}`}});
    const observed=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'OBSERVADA',note:'Comprobante pendiente',revision:legacyShift.updatedAt.toISOString()});
    expect(observed.closureReviewRequestedAt).not.toBeNull();
    await prisma.alert.update({where:{id:a.id},data:{status:'RESUELTA'}});
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const validated=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Comprobante revisado',revision:observed.updatedAt.toISOString()});
    expect(validated.closureReviewDecision).toBe('VALIDADA');
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).not.toContain(shift.id);
  });

  it('el relevo conserva la regla de alerta viva: resueltas/pospuestas futuras no se congelan',async()=>{
    const now=new Date();const e=await notice();
    const resolved=await prisma.alert.create({data:{type:'OTRO',title:'Resuelta',status:'RESUELTA'}});
    const future=await prisma.alert.create({data:{type:'OTRO',title:'Pospuesta futura',status:'POSPUESTA',snoozedUntil:new Date(now.getTime()+3600000),entryId:e.id}});
    const resumed=await prisma.alert.create({data:{type:'OTRO',title:'Pospuesta vencida',status:'POSPUESTA',snoozedUntil:new Date(now.getTime()-1000)}});
    const live=await prisma.alert.create({data:{type:'OTRO',title:'Alerta viva',status:'NUEVA'}});
    const ids=(await buildHandoverSnapshot(reception,now)).map(i=>i.refId);
    expect(ids).not.toContain(resolved.id);expect(ids).not.toContain(future.id);expect(ids).toContain(resumed.id);expect(ids).toContain(live.id);
  });

  it('el contexto Fronti de entrega filtra fotografías históricas sin cambiar sus ítems',async()=>{
    const e=await notice(supervisor);const {handover}=await sentShift();
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await prisma.handoverItem.create({data:{handoverId:handover.id,section:'Tareas pendientes',title:'TAREA_HISTORICA_NO_MOSTRAR',detail:'Evidencia histórica',refType:'task',refId:'historica'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const context=await executeFrontiPageContextTool(other,resolveFrontiPageContext({pathname:`/turno/entrega/${handover.id}`}));
    expect(JSON.stringify(context)).not.toContain(e.title);expect(JSON.stringify(context)).not.toContain('TAREA_HISTORICA_NO_MOSTRAR');
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,refId:e.id}})).toBe(1);
    expect(await prisma.handoverItem.count({where:{handoverId:handover.id,title:'TAREA_HISTORICA_NO_MOSTRAR'}})).toBe(1);
  });

  it('Fronti lee sólo la garantía o cierre abiertos, con permisos y sin fallback general',async()=>{
    const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:reception.id,guestName:'Garantía concreta'}});
    const unrelated=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:10000,createdById:reception.id,guestName:'NO_MEZCLAR_GARANTIA'}});
    const gp=resolveFrontiPageContext({pathname:`/caja/garantias/${g.id}`});
    const result=await executeFrontiPageContextTool(reception,gp);expect(result).toMatchObject({snapshot:{found:true,id:g.id,guestName:g.guestName,outstandingAmount:50000}});expect(JSON.stringify(result)).not.toContain(unrelated.guestName);
    expect(await executeFrontiPageContextTool(reception,resolveFrontiPageContext({pathname:'/caja/garantias/no-existe'}))).toMatchObject({snapshot:{found:false}});
    await expect(executeFrontiPageContextTool({...reception,permissions:[]},gp)).rejects.toThrow(/permiso/);
    const {shift}=await sentShift();await closeShift(reception,{shiftId:shift.id});
    const sp=resolveFrontiPageContext({pathname:`/supervision/cierres/${shift.id}`});
    expect(await executeFrontiPageContextTool(supervisor,sp)).toMatchObject({snapshot:{found:true,id:shift.id,pending:true,href:`/supervision/cierres/${shift.id}`}});
    await expect(executeFrontiPageContextTool(reception,sp)).rejects.toThrow();
    expect(await executeFrontiPageContextTool(supervisor,resolveFrontiPageContext({pathname:'/supervision/cierres/no-existe'}))).toMatchObject({snapshot:{found:false}});
  });

  it('protege toda la cadena nativa novedad → alerta → tarea → seguimiento → alerta y sus ciclos',async()=>{
    const e=await notice(supervisor);const a=await prisma.alert.create({data:{entryId:e.id,title:'CADENA_ORIGEN',type:'OTRO'}});
    const t=await prisma.task.create({data:{alertId:a.id,title:'CADENA_TAREA',createdById:supervisor.id}});
    const f=await prisma.followUp.create({data:{taskId:t.id,action:'CADENA_SEGUIMIENTO',visibility:'OPERATIVO',ownerId:supervisor.id,createdById:other.id}});
    const tail=await prisma.alert.create({data:{followUpId:f.id,title:'CADENA_COLA',type:'OTRO'}});
    await prisma.task.update({where:{id:t.id},data:{followUpId:f.id}}); // Historical cycle must terminate.
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    await expect(getTask(t.id,other)).rejects.toThrow();
    expect(await prisma.alert.count({where:{id:tail.id,AND:[alertReadWhere(other)]}})).toBe(0);
    expect(await prisma.followUp.count({where:{id:f.id,AND:[followUpReadWhere(other)]}})).toBe(0);
    const notifications=await Promise.all([['Task',t.id],['FollowUp',f.id],['Alert',tail.id]].map(([entity,entityId])=>prisma.notification.create({data:{userId:other.id,type:'ACCION_REQUERIDA',entity,entityId,title:'CADENA_AVISO'}})));
    const feed=await getNotificationFeedForUser(other.id);
    for(const n of notifications)expect(feed.items.map(i=>i.id)).not.toContain(n.id);
    expect(await searchOperationalRecords(other,'CADENA')).toHaveLength(0);
    const count=await prisma.comment.count();
    for(const target of [{taskId:t.id},{followUpId:f.id},{alertId:tail.id}])await expect(addComment(other,{...target,body:'No debe escribir por vínculo indirecto'})).rejects.toThrow();
    expect(await prisma.comment.count()).toBe(count);
    expect(await prisma.task.findUnique({where:{id:t.id}})).not.toBeNull();
    expect(await prisma.alert.count({where:{id:tail.id,AND:[alertReadWhere(supervisor)]}})).toBe(1);
  });

  it('la asignación y el cambio de visibilidad rechazan responsables que perderían acceso',async()=>{
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await expect(notice(supervisor,{ownerId:other.id,hiddenDepartmentIds:[area.id]})).rejects.toThrow(/responsable no podrá ver/);
    const hidden=await notice(supervisor,{hiddenDepartmentIds:[area.id]});
    await expect(updateEntry(supervisor,{id:hidden.id,ownerId:other.id})).rejects.toThrow(/responsable no podrá ver/);
    const assigned=await notice(supervisor,{ownerId:other.id});const auditCount=await prisma.auditLog.count();
    await expect(updateEntryVisibility(supervisor,{id:assigned.id,revision:assigned.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true})).rejects.toThrow(/responsable no podrá ver/);
    expect(await prisma.auditLog.count()).toBe(auditCount);
    expect((await getSubjectEntry(other,assigned.id)).ownerId).toBe(other.id);
    const own=await notice(other,{ownerId:other.id,hiddenDepartmentIds:[area.id]});
    expect((await getSubjectEntry(other,own.id)).id).toBe(own.id);
  });

  it('la escritura derivada bloquea el origen y serializa un cambio concurrente de visibilidad',async()=>{
    const e=await notice(supervisor);const a=await prisma.alert.create({data:{entryId:e.id,title:'Bloqueo de fuente',type:'OTRO'}});
    const t=await prisma.task.create({data:{alertId:a.id,title:'Fuente derivada',createdById:supervisor.id}});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let ready!:()=>void;const locked=new Promise<void>(resolve=>{ready=resolve;});
    const write=prisma.$transaction(async tx=>{await lockEntrySourcesForRecord(tx,other,'task',t.id);ready();await gate;await tx.comment.create({data:{taskId:t.id,authorId:other.id,body:'Autorizado antes de ocultar'}});});
    await locked;let completed=false;
    const hide=updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true}).then(()=>{completed=true;});
    try{await new Promise(resolve=>setTimeout(resolve,60));expect(completed).toBe(false);}finally{release();}
    await Promise.all([write,hide]);
    await expect(addComment(other,{taskId:t.id,body:'Después de ocultar'})).rejects.toThrow();
    expect(await prisma.comment.count({where:{taskId:t.id}})).toBe(1);
  });

  it('HK filtra trabajos y fotografías existentes, sus contadores, búsqueda y avisos; rechaza destinos ocultos',async()=>{
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const manager=await createUser({roleKey:ROLE_KEYS.HK_MANAGER});const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    await prisma.user.updateMany({where:{id:{in:[manager.id,maid.id]}},data:{departmentId:area.id}});
    const e=await notice(supervisor,{title:'HK_ORIGEN_OCULTO'});const date=hotelDateKey(new Date());
    const work=await createHkWork(admin,{requestKey:'aroh164-hk-modern',title:'Vinculado',description:'Instrucción vinculada',sourceEntryId:e.id,departmentId:area.id,assignedToId:maid.id,workDate:date,workKind:'REPOSICION',location:'Zona de prueba',effortMinutes:20,priority:'MEDIA'});
    const legacyEntry=await notice(supervisor,{title:'HK_HISTORICO_OCULTO'});
    const legacy=await createHousekeepingRequest(admin,{requestKey:'aroh164-hk-legacy',sourceEntryId:legacyEntry.id,departmentId:area.id,priority:'MEDIA'});
    const photograph=await saveHkHandover(manager,{requestKey:'aroh164-hk-photo',departmentId:area.id,workDate:date,note:'Pendientes de prueba'});
    const before=JSON.stringify(photograph.snapshot);expect(before).toContain(e.title);expect(before).toContain(legacyEntry.title);
    // Active destinations cannot be stranded; cancel through the native flows first.
    await expect(updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true})).rejects.toThrow(/trabajo pendiente/);
    await changeHkWork(admin,{id:work.id,version:work.version,action:'CANCELAR',note:'Caso sintético finalizado antes de ocultar'});
    await changeHousekeepingRequest(admin,{id:legacy.id,version:legacy.version,action:'CANCELAR',note:'Caso sintético finalizado antes de ocultar'});
    for(const entry of [e,legacyEntry])await updateEntryVisibility(supervisor,{id:entry.id,revision:entry.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const day=await getHkWorkday(manager,{departmentId:area.id,date});expect(day.requests).toHaveLength(0);expect(day.total).toBe(0);expect(day.counts.active).toBe(0);
    expect(JSON.stringify(day.handovers)).not.toContain(e.title);expect(JSON.stringify(day.handovers)).not.toContain(legacyEntry.title);
    expect((await getHkWorkday(maid,{departmentId:area.id,date})).requests).toHaveLength(0);
    expect(await getHousekeepingBoard(manager)).toMatchObject({total:0,active:0});
    expect(await searchHousekeepingRecords(manager,'HK_')).toHaveLength(0);expect(await searchOperationalRecords(manager,'HK_')).toHaveLength(0);
    const n=await prisma.notification.create({data:{userId:maid.id,entity:'HousekeepingRequest',entityId:work.id,type:'ACCION_REQUERIDA',title:e.title}});
    expect((await getNotificationFeedForUser(maid.id)).items.map(row=>row.id)).not.toContain(n.id);
    expect(JSON.stringify((await prisma.housekeepingHandover.findUniqueOrThrow({where:{id:photograph.id}})).snapshot)).toBe(before);
    expect(await prisma.housekeepingRequest.count({where:{id:{in:[work.id,legacy.id]}}})).toBe(2);
    const hidden=await notice(supervisor,{hiddenDepartmentIds:[area.id]});
    await expect(createHkWork(admin,{requestKey:'aroh164-hk-denied',title:'No crear',description:'No crear',sourceEntryId:hidden.id,departmentId:area.id,assignedToId:maid.id,workDate:date,workKind:'REPOSICION',location:'Prueba',effortMinutes:20,priority:'MEDIA'})).rejects.toThrow(/área de destino/);
    await expect(createHousekeepingRequest(admin,{requestKey:'aroh164-hk-legacy-denied',sourceEntryId:hidden.id,departmentId:area.id,priority:'MEDIA'})).rejects.toThrow(/área de destino/);
  });

  it('las métricas de Inicio/turno y de indicadores no cuentan novedades ni fuentes ocultas al lector',async()=>{
    const shift=await createShift({userId:reception.id,type:'DIA'});await openShiftAs(reception,shift);
    const visible=await notice(supervisor,{includeInReceptionHandover:false});const hidden=await notice(supervisor,{type:'INCIDENCIA',severity:'CRITICA'});
    await prisma.operationalEntry.updateMany({where:{id:{in:[visible.id,hidden.id]}},data:{shiftId:shift.id}});
    await prisma.task.create({data:{shiftId:shift.id,entryId:hidden.id,createdById:supervisor.id,title:'Tarea de fuente oculta'}});
    await prisma.task.create({data:{shiftId:shift.id,entryId:visible.id,createdById:supervisor.id,title:'Visible aunque no viaje en entrega'}});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:hidden.id}});
    await updateEntryVisibility(supervisor,{id:hidden.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    expect(await getShiftMetrics(shift.id,reception)).toMatchObject({entries:1,incidents:0,tasksCreated:1});
    expect((await getDashboardData(reception)).shiftMetrics).toMatchObject({entries:1,incidents:0,tasksCreated:1});
    expect(await getShiftMetrics(shift.id,supervisor)).toMatchObject({entries:2,incidents:1,tasksCreated:2});
    const metrics=await getMetrics(defaultRange(),reception);expect(metrics.incidents.open).toBe(0);expect(metrics.volumeByShift.map(r=>r.count)).toEqual([1]);
  });

  it('una alerta manual comprueba y bloquea su fuente nativa, sin alerta ni auditoría ante un ID oculto',async()=>{
    const e=await notice(supervisor);const source=await prisma.task.create({data:{entryId:e.id,createdById:supervisor.id,title:'Fuente de alerta'}});
    const allowed=await createManualAlert(other,{entryId:e.id,type:'OTRO',level:'INFORMATIVA',title:'Alerta autorizada'});
    expect(allowed.entryId).toBe(e.id);
    const area=await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await updateEntryVisibility(supervisor,{id:e.id,revision:e.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const alerts=await prisma.alert.count();const audits=await prisma.auditLog.count();
    await expect(createManualAlert(other,{entryId:e.id,type:'OTRO',level:'INFORMATIVA',title:'No crear por ID retenido'})).rejects.toThrow();
    await expect(createManualAlert(other,{taskId:source.id,type:'OTRO',level:'INFORMATIVA',title:'No crear por derivado'})).rejects.toThrow();
    expect(await prisma.alert.count()).toBe(alerts);expect(await prisma.auditLog.count()).toBe(audits);
  });

  it('la creación rechaza áreas inexistentes y booleanos inválidos',async()=>{
    await expect(notice(supervisor,{hiddenDepartmentIds:['no-existe']})).rejects.toThrow(/áreas vigentes/);
    expect(entryCreateSchema.safeParse({type:'NOVEDAD',title:'Nueva',description:'Descripción válida',priority:'MEDIA',includeInReceptionHandover:'incorrecto'}).success).toBe(false);
  });

  it('ocultar solo en entrega conserva lectura por área y filtra también fotografías históricas',async()=>{
    const e=await notice(supervisor,{includeInReceptionHandover:false});
    expect((await getBookItems({kinds:['entry']},reception)).items.map(i=>i.id)).toContain(e.id);
    expect(await visibleSnapshotItems(reception,[{refType:'entry',refId:e.id,title:e.title,detail:e.description}],true)).toHaveLength(0);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).description).toBe(e.description);
  });
});
