import {getSimpleNoveltyContinuity} from '@/server/services/simple-novelty-continuity';
import {createEntryAction} from '@/server/actions/entries';
import {getAssignmentBoard} from '@/server/services/assignment-board';
import {ensureIncidentWorkflow} from '@/server/services/incident-workflow';
import {createNativeEntry,lockNativeNoveltyCreation} from '@/server/services/native-entry-creation';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { prisma,seedCatalog,resetOperationalData,createUser,createShift,ROLE_KEYS } from './helpers';
import { createEntry,updateEntry,changeEntryStatus,updateEntryVisibility,restoreEntry,softDeleteEntry } from '@/server/services/entries';
import { createSimpleNovelty,listSimpleNovelties,resolveSimpleNovelty,simpleNoveltiesEnabled,updateSimpleNovelty } from '@/server/services/simple-novelties';
import { entryReadSql,readEntries } from '@/server/services/entry-visibility';
import { operationalRecordRevision } from '@/server/security/authorized-revision';
import { getBookItems } from '@/server/services/book';
import { Prisma } from '@prisma/client';
import type {CurrentUser} from '@/server/auth/current-user';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePermission:async()=>auth.user}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {saveSettingAction} from '@/server/actions/admin';
import {coordinateWork} from '@/server/services/coordination';
import {notifyNativeWork} from '@/server/services/work-notifications';
import {getWebPushPayload} from '@/server/services/web-push';

async function activateReception(user:CurrentUser){const shift=await createShift({userId:user.id,type:'DIA',status:'ACTIVO'});await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id},data:{activatedAt:new Date()}});return shift;}
async function flag(value:boolean){await prisma.systemSetting.upsert({where:{key:'book.simpleNovelties'},create:{key:'book.simpleNovelties',value,category:'pruebas'},update:{value}});}
describe('prueba de novedades simples sobre el libro existente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  for(const status of [null,'INICIADO','PREPARANDO_ENTREGA'] as const)it(`el modo simple sólo permite resolver al terminar la operación activa: ${status??'sin turno'}`,async()=>{
    await flag(true);const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const shift=await activateReception(author);
    const novelty=await createSimpleNovelty(author,{title:'Formulario creado durante el turno',description:'Guardar después del cambio de puerta'});
    if(status)await prisma.shift.update({where:{id:shift.id},data:{status}});else await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id},data:{leftAt:new Date()}});
    const caja=await prisma.operationalEntry.create({data:{type:'CAJA',title:'Caja sintética protegida',description:'No habilitar por estar bajo /libro',createdById:author.id,ownerId:author.id}});
    await expect(changeEntryStatus(author,{id:caja.id,status:'RESUELTO'})).rejects.toThrow(/turno|operación|operar|cierre/i);
    await expect(updateEntry(author,{id:caja.id,title:'Edición no autorizada'})).rejects.toThrow(/turno|operación|operar|cierre/i);
    await expect(updateSimpleNovelty(author,{id:novelty.id,title:'Edición fuera de turno',description:'No guardar',departmentId:null,workNextAction:null},operationalRecordRevision('entries',novelty))).rejects.toThrow(/turno|operación|operar|cierre/i);
    await expect(updateEntry(author,{id:novelty.id,description:'Formulario legado fuera de turno'})).rejects.toThrow(/turno|operación|operar|cierre/i);
    await expect(createSimpleNovelty(author,{title:'Nueva fuera de turno',description:'No crear'})).rejects.toThrow(/turno|operación|operar|cierre/i);
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:caja.id}})).toMatchObject({status:'ABIERTO',title:caja.title});
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:novelty.id}})).toMatchObject({title:novelty.title,description:novelty.description});
    expect((await resolveSimpleNovelty(author,novelty.id,operationalRecordRevision('entries',novelty))).status).toBe('RESUELTO');
  });
  for(const kind of ['task-alert','followup-alert','housekeeping-maintenance'] as const)it(`detalle y cierre comparten la obligación indirecta ${kind}`,async()=>{
    await flag(true);const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const novelty=await createSimpleNovelty(admin,{title:'Origen de obligación indirecta',description:'No resolver antes del trabajo'});
    const alert=await prisma.alert.create({data:{type:'TAREA_VENCIDA',title:'Alerta del origen',entryId:novelty.id}});
    const task=kind==='task-alert'?await prisma.task.create({data:{alertId:alert.id,title:'Tarea indirecta pendiente',createdById:admin.id}}):null;
    const follow=kind==='followup-alert'?await prisma.followUp.create({data:{sourceEntity:'Alert',sourceId:alert.id,action:'Seguimiento indirecto pendiente',createdById:admin.id,ownerId:admin.id,visibility:'OPERATIVO'}}):null;
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const hk=kind==='housekeeping-maintenance'?await prisma.housekeepingRequest.create({data:{requestKey:kind,maintenanceEntryId:novelty.id,departmentId:area.id,createdById:admin.id,title:'Mantenimiento vinculado',description:'Trabajo nativo de mantenimiento'}}):null;
    const work=await getSimpleNoveltyContinuity(novelty.id,admin);expect(task?work.tasks.map(row=>row.id):follow?work.followups.map(row=>row.id):work.housekeeping.map(row=>row.id)).toContain(task?.id??follow?.id??hk!.id);
    await expect(resolveSimpleNovelty(admin,novelty.id,operationalRecordRevision('entries',novelty))).rejects.toThrow(/trabajo|seguimiento|Housekeeping/);
    expect((await readEntries(prisma,admin).findUniqueOrThrow({where:{id:novelty.id}})).status).toBe('ABIERTO');
    if(task)await prisma.task.update({where:{id:task.id},data:{status:'VALIDADA'}});if(follow)await prisma.followUp.update({where:{id:follow.id},data:{status:'CUMPLIDO'}});if(hk)await prisma.housekeepingRequest.update({where:{id:hk.id},data:{status:'RESUELTO'}});
    const cleared=await getSimpleNoveltyContinuity(novelty.id,admin);expect(cleared.tasks.length+cleared.followups.length+cleared.housekeeping.length).toBe(0);expect((await resolveSimpleNovelty(admin,novelty.id,operationalRecordRevision('entries',novelty))).status).toBe('RESUELTO');
  });
  it('apagado conserva la barrera legada para obligaciones indirectas',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const entry=await createEntry(admin,{type:'NOVEDAD',title:'Cierre legado',description:'Flag apagado',priority:'MEDIA',tags:[],requiresFollowUp:false});
    const alert=await prisma.alert.create({data:{type:'TAREA_VENCIDA',title:'Alerta legada',entryId:entry.id}});await prisma.task.create({data:{alertId:alert.id,title:'Trabajo indirecto legado',createdById:admin.id}});
    expect(await simpleNoveltiesEnabled()).toBe(false);expect((await changeEntryStatus(admin,{id:entry.id,status:'RESUELTO'})).status).toBe('RESUELTO');
  });
  it('conserva y muestra las obligaciones legadas sin permitir resolver antes de atenderlas',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const other=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const incident=await createEntry(author,{type:'INCIDENCIA',title:'Trabajo anterior pendiente',description:'No perder al encender',priority:'MEDIA',tags:[],requiresFollowUp:true,severity:'ALTA'},{incidentWorkflow:true});
    const privateFollow=await prisma.followUp.create({data:{entryId:incident.id,action:'Seguimiento privado anterior',visibility:'PRIVADO',ownerId:author.id,createdById:author.id}});
    await flag(true);const work=await getSimpleNoveltyContinuity(incident.id,author);expect(work.tasks).toHaveLength(1);expect(work.followups).toHaveLength(2);
    const otherWork=await getSimpleNoveltyContinuity(incident.id,other);expect(otherWork.followups.map(row=>row.id)).not.toContain(privateFollow.id);
    const activeIncident=await readEntries(prisma,author).findUniqueOrThrow({where:{id:incident.id}});await expect(resolveSimpleNovelty(author,incident.id,operationalRecordRevision('entries',activeIncident),'Atendida')).rejects.toThrow(/tarea|seguimiento|pendiente/i);
    expect(await prisma.task.count({where:{entryId:incident.id}})).toBe(1);
    const hiddenReader=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});const receptionArea=await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}});await prisma.user.update({where:{id:hiddenReader.id},data:{departmentId:receptionArea.id}});hiddenReader.departmentId=receptionArea.id;
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:incident.id}});await updateEntryVisibility(author,{id:incident.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[receptionArea.id],includeInReceptionHandover:false});
    await expect(getSimpleNoveltyContinuity(incident.id,hiddenReader)).rejects.toThrow();
  });
  for(const enabled of [true,false])it(`el mensaje de creación describe el trabajo realmente creado: simple=${enabled}`,async()=>{
    await flag(enabled);auth.user=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const form=new FormData();for(const [key,value] of Object.entries({type:'INCIDENCIA',title:'Mensaje sintético de incidencia',description:'No anunciar cadenas omitidas',priority:'MEDIA',severity:'ALTA',requiresFollowUp:'true'}))form.set(key,value);
    const result=await createEntryAction(null,form);expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);expect(result.message).toContain('creada');
    expect(result.message?.includes('con tarea y seguimiento')).toBe(!enabled);expect(await prisma.task.count()).toBe(enabled?0:1);expect(await prisma.followUp.count()).toBe(enabled?0:1);
  });
  it('el tablero de asignación conserva tareas y excluye novedades simples en lista y total',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const row=await createEntry(supervisor,{type:'NOVEDAD',title:'Área sin persona',description:'Prueba',priority:'MEDIA',tags:[],requiresFollowUp:false});
    await prisma.task.create({data:{title:'Tarea asignable',createdById:supervisor.id}});
    const before=await getAssignmentBoard(supervisor);expect(before.unassigned.some(item=>item.id===row.id)).toBe(true);expect(before.unassignedTotal).toBe(2);
    await flag(true);const after=await getAssignmentBoard(supervisor);expect(after.unassigned.map(item=>item.kind)).toEqual(['task']);expect(after.unassignedTotal).toBe(1);
  });
  it('incidencias de formulario anterior y Fronti no generan cadenas con el modo simple encendido',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});await activateReception(author);await flag(true);
    const row=await createEntry(author,{type:'INCIDENCIA',title:'Formulario ya abierto',description:'Guardar tras interruptor',priority:'MEDIA',tags:[],requiresFollowUp:true,severity:'ALTA'},{incidentWorkflow:true});
    await ensureIncidentWorkflow(row.id);
    await updateEntry(author,{id:row.id,title:'Edición sin cadena'});
    expect(await prisma.task.count({where:{entryId:row.id}})).toBe(0);expect(await prisma.followUp.count({where:{entryId:row.id}})).toBe(0);
    const current=await readEntries(prisma,author).findUniqueOrThrow({where:{id:row.id}});
    expect((await resolveSimpleNovelty(author,row.id,operationalRecordRevision('entries',current),'Atendida')).status).toBe('RESUELTO');
    await flag(false);const legacy=await createEntry(author,{type:'INCIDENCIA',title:'Modo anterior',description:'Conservar motor',priority:'MEDIA',tags:[],requiresFollowUp:true,severity:'ALTA'},{incidentWorkflow:true});expect(await prisma.task.count({where:{entryId:legacy.id}})).toBe(1);expect(await prisma.followUp.count({where:{entryId:legacy.id}})).toBe(1);
  });
  it('creadores nativos invalidan borradores visibles y conservan las entregas enviadas',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const shift=await createShift({userId:author.id,type:'DIA'});await flag(true);const now=new Date();
    const draft=await prisma.shiftHandover.create({data:{fromShiftId:shift.id,issuedById:author.id,finalReviewAt:now,urgentAcknowledgedAt:now,pendingsReviewedAt:now}});
    const entry=await prisma.$transaction(async tx=>{await lockNativeNoveltyCreation(tx);return createNativeEntry(tx,{data:{type:'INCIDENCIA',title:'Incidencia de motor nativo',description:'Mantenimiento, garantía o lavandería',createdById:author.id,ownerId:author.id}});});
    expect(entry.ownerId).toBeNull();expect((await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id}}))).toMatchObject({receptionSummaryRevision:1,finalReviewAt:null,urgentAcknowledgedAt:null,pendingsReviewedAt:null});
    await prisma.shiftHandover.update({where:{id:draft.id},data:{status:'ENVIADA',finalReviewAt:now}});
    await prisma.$transaction(tx=>createNativeEntry(tx,{data:{type:'NOVEDAD',title:'Otra novedad nativa',description:'No cambiar fotografía',createdById:author.id}}));expect((await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id}})).finalReviewAt).toEqual(now);
  });
  it('restaurar una novedad abierta invalida revisión final y la eliminación también invalida su fotografía',async()=>{
    await flag(true);const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const shift=await createShift({userId:author.id,type:'DIA'});
    await activateReception(author);const entry=await createSimpleNovelty(author,{title:'Novedad recuperada',description:'No omitir al enviar'});await softDeleteEntry(admin,{id:entry.id,reason:'Prueba sintética'});const now=new Date();const draft=await prisma.shiftHandover.create({data:{fromShiftId:shift.id,issuedById:author.id,finalReviewAt:now,urgentAcknowledgedAt:now,pendingsReviewedAt:now}});
    await restoreEntry(admin,{id:entry.id});expect(await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id}})).toMatchObject({receptionSummaryRevision:1,finalReviewAt:null,urgentAcknowledgedAt:null,pendingsReviewedAt:null});
    await prisma.handoverItem.create({data:{handoverId:draft.id,refType:'entry',section:'novedades',refId:entry.id,title:entry.title,level:'INFORMATIVO'}});await prisma.shiftHandover.update({where:{id:draft.id},data:{finalReviewAt:now}});await softDeleteEntry(admin,{id:entry.id,reason:'Retirar evidencia sintética'});expect(await prisma.shiftHandover.findUniqueOrThrow({where:{id:draft.id}})).toMatchObject({receptionSummaryRevision:2,finalReviewAt:null});
    expect((await prisma.auditLog.findFirstOrThrow({where:{entityId:entry.id,action:'RESTAURAR'}})).after).toMatchObject({invalidatedDrafts:[draft.id]});
  });
  it('guardar apagado por primera vez conserva las revisiones de borradores y entregas enviadas',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});auth.user=admin;const now=new Date();
    const handovers=[];
    for(const status of ['BORRADOR','ENVIADA'] as const){
      const shift=await createShift({userId:admin.id,type:'DIA'});handovers.push(await prisma.shiftHandover.create({data:{fromShiftId:shift.id,issuedById:admin.id,status,finalReviewAt:now,urgentAcknowledgedAt:now,receiverFinalReviewAt:now,receiverUrgentAcknowledgedAt:now,receiverFinalSummaryKey:'synthetic-summary'}}));
    }
    const form=new FormData();form.set('key','book.simpleNovelties');form.set('value','false');
    expect((await saveSettingAction(null,form)).ok).toBe(true);expect(await simpleNoveltiesEnabled()).toBe(false);
    for(const original of handovers)expect(await prisma.shiftHandover.findUnique({where:{id:original.id}})).toMatchObject({finalReviewAt:now,urgentAcknowledgedAt:now,receiverFinalReviewAt:now,receiverUrgentAcknowledgedAt:now,receiverFinalSummaryKey:'synthetic-summary'});
  });
  it('pagina más de cuarenta novedades del área sin perder la más antigua',async()=>{
    await flag(true);const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});maid.departmentId=area.id;
    await prisma.operationalEntry.createMany({data:Array.from({length:41},(_,index)=>({type:'NOVEDAD' as const,title:`Paginación ${index}`,description:'Prueba del área',createdById:author.id,departmentId:area.id,occurredAt:new Date(Date.UTC(2026,9,8,0,index))}))});
    const first=await listSimpleNovelties(maid,{area:area.id,page:1,q:'Paginación'});const next=await listSimpleNovelties(maid,{area:area.id,page:2,q:'Paginación'});
    expect(first.total).toBe(41);expect(first.general).toHaveLength(40);expect(next.general.map(row=>row.title)).toEqual(['Paginación 0']);
    expect(new Set([...first.general,...next.general].map(row=>row.id)).size).toBe(41);
  });
  it('rechaza cambiar a un área oculta hasta ajustar la visibilidad auditada',async()=>{
    await flag(true);const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    await activateReception(author);const row=await createSimpleNovelty(author,{title:'Área oculta',description:'No perder el aviso'});
    await updateEntryVisibility(author,{id:row.id,revision:row.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const hidden=await readEntries(prisma,author).findUniqueOrThrow({where:{id:row.id}});
    await expect(updateSimpleNovelty(author,{id:row.id,title:row.title,description:row.description,departmentId:area.id,workNextAction:null},operationalRecordRevision('entries',hidden))).rejects.toThrow(/área relacionada está oculta/);
    expect((await readEntries(prisma,author).findUniqueOrThrow({where:{id:row.id}})).departmentId).toBeNull();
    await updateEntryVisibility(author,{id:row.id,revision:hidden.updatedAt.toISOString(),hiddenDepartmentIds:[],includeInReceptionHandover:true});
    const visible=await readEntries(prisma,author).findUniqueOrThrow({where:{id:row.id}});
    expect((await updateSimpleNovelty(author,{id:row.id,title:row.title,description:row.description,departmentId:area.id,workNextAction:null},operationalRecordRevision('entries',visible))).departmentId).toBe(area.id);
  });
  it('serializa la recepción individual con un encendido concurrente, incluso sin fila de parámetro',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const row=await createEntry(author,{type:'NOVEDAD',title:'Recibir después del encendido',description:'Prueba concurrente',priority:'MEDIA',tags:[],requiresFollowUp:false,ownerId:author.id});
    let unlock!:()=>void;let locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});const release=new Promise<void>(resolve=>{unlock=resolve;});
    const switching=prisma.$transaction(async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('setting:book.simpleNovelties'))`;await tx.systemSetting.create({data:{key:'book.simpleNovelties',value:true,category:'pruebas'}});locked();await release;});
    await ready;
    const receiving=coordinateWork(author,{kind:'entry',id:row.id,updatedAt:row.updatedAt,requestKey:'mode-concurrent',action:'RECIBIR',nextAction:'Continuar'});
    const rejected=expect(receiving).rejects.toThrow(/no se asignan ni reciben/);
    let waiting=false;
    try{for(let attempt=0;attempt<100;attempt++){
      const rows=await prisma.$queryRaw<Array<{waiting:boolean}>>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`;
      if(rows[0]?.waiting){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
    }}finally{unlock();}
    await switching;await rejected;expect(waiting).toBe(true);
    expect((await readEntries(prisma,author).findUniqueOrThrow({where:{id:row.id}})).workAcknowledgedAt).toBeNull();
  });
  it('Sysadmin recibe avisos y payload push de trabajo aunque su área esté oculta',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    await prisma.user.update({where:{id:admin.id},data:{departmentId:area.id}});admin.departmentId=area.id;
    const source=await createEntry(author,{type:'NOVEDAD',title:'Origen oculto al área',description:'Sysadmin conserva acceso',priority:'MEDIA',tags:[],requiresFollowUp:false,hiddenDepartmentIds:[area.id]});
    const task=await prisma.task.create({data:{title:'Trabajo nativo de prueba',createdById:author.id,entryId:source.id,assigneeId:admin.id}});
    await prisma.$transaction(tx=>notifyNativeWork(tx,{kind:'task',id:task.id,actorId:author.id,ids:[admin.id],title:task.title}));
    expect(await prisma.notification.count({where:{userId:admin.id,entity:'Task',entityId:task.id}})).toBe(1);
    const endpoint='https://push.invalid/simple-sysadmin';await prisma.pushSubscription.create({data:{userId:admin.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    expect(JSON.stringify(await getWebPushPayload({userId:admin.id,endpoint}))).toContain(task.title);
  });
  it('arranca apagada y conserva filas, permisos y asignaciones del modo anterior',async()=>{
    const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const row=await createEntry(receptionist,{type:'NOVEDAD',title:'Modo anterior',description:'Seguimiento vigente',priority:'MEDIA',tags:[],requiresFollowUp:false});
    expect(await simpleNoveltiesEnabled()).toBe(false);
    const before=await getBookItems({kinds:['entry']},receptionist);
    await expect(createSimpleNovelty(receptionist,{title:'No crear',description:'Prueba'})).rejects.toThrow(/apagada/);
    await expect(resolveSimpleNovelty(receptionist,row.id,operationalRecordRevision('entries',row))).rejects.toThrow(/apagada/);
    await flag(false);
    expect(await getBookItems({kinds:['entry']},receptionist)).toEqual(before);
    expect((await updateEntry(receptionist,{id:row.id,ownerId:receptionist.id})).ownerId).toBe(receptionist.id);
  });
  it('sólo Sysadmin enciende la prueba y el cambio queda auditado',async()=>{
    auth.user=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const form=new FormData();form.set('key','book.simpleNovelties');form.set('value','true');
    expect((await saveSettingAction(null,form)).ok).toBe(false);
    expect(await simpleNoveltiesEnabled()).toBe(false);
    auth.user=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    expect((await saveSettingAction(null,form)).ok).toBe(true);
    expect(await simpleNoveltiesEnabled()).toBe(true);
    expect(await prisma.auditLog.count({where:{entity:'SystemSetting',userId:auth.user.id}})).toBe(1);
  });
  it('guarda reserva, HAB, seguimiento y área sin responsable ni tareas nuevas',async()=>{
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});await activateReception(receptionist);
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const room=await prisma.room.findFirstOrThrow();
    const row=await createSimpleNovelty(receptionist,{title:'Toalla manchada',description:'Cobrar al huésped',departmentId:area.id,roomId:room.id,reservationReference:'7484708',workNextAction:'Revisar al check-out'});
    expect(row).toMatchObject({type:'NOVEDAD',ownerId:null,departmentId:area.id,roomId:room.id,reservationReference:'7484708',workNextAction:'Revisar al check-out'});
    expect(await prisma.task.count()).toBe(0);expect(await prisma.subjectAreaAttention.count()).toBe(0);
    await expect(updateEntry(receptionist,{id:row.id,ownerId:receptionist.id})).rejects.toThrow(/no se asignan/);
    await expect(createEntry(receptionist,{type:'NOVEDAD',title:'Asignación anterior',description:'No crear cadena',priority:'MEDIA',tags:[],requiresFollowUp:false,ownerId:receptionist.id})).rejects.toThrow(/no se asignan/);
    expect((await updateSimpleNovelty(receptionist,{id:row.id,title:row.title,description:row.description,departmentId:area.id,workNextAction:'Lavandería informada'},operationalRecordRevision('entries',row))).workNextAction).toBe('Lavandería informada');
  });
  it('cualquier recepcionista sin turno ni permiso de cierre puede resolver; no exige supervisor',async()=>{
    await flag(true);const outgoing=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const other=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const creator=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const row=await createSimpleNovelty(creator,{title:'Novedad pendiente',description:'Ya fue atendida'});
    const withoutClose={...other,permissions:other.permissions.filter(p=>!['entry.close','incident.close'].includes(p))};
    const resolved=await resolveSimpleNovelty(withoutClose,row.id,operationalRecordRevision('entries',row));
    expect(resolved.status).toBe('RESUELTO');expect(await prisma.auditLog.count({where:{entityId:row.id,userId:other.id,action:'CAMBIO_ESTADO'}})).toBe(1);
    await expect(resolveSimpleNovelty(outgoing,row.id,operationalRecordRevision('entries',row))).rejects.toThrow(/cambió/);
    const next=await createSimpleNovelty(creator,{title:'Salida de turno',description:'Atendida por saliente'});
    expect((await resolveSimpleNovelty({...outgoing,permissions:withoutClose.permissions},next.id,operationalRecordRevision('entries',next))).status).toBe('RESUELTO');
    await flag(false);const legacy=await createEntry(outgoing,{type:'NOVEDAD',title:'Flag off',description:'Permiso anterior',priority:'MEDIA',tags:[],requiresFollowUp:false});
    await expect(changeEntryStatus(withoutClose,{id:legacy.id,status:'RESUELTO'})).rejects.toThrow(/permiso/);
  });
  it('el área ve sólo sus novedades; internas no salen por ORM, SQL, búsquedas ni contadores',async()=>{
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});await activateReception(receptionist);const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});await prisma.user.update({where:{id:maid.id},data:{departmentId:area.id}});maid.departmentId=area.id;
    const related=await createSimpleNovelty(receptionist,{title:'HSK_VISIBLE',description:'Solicita limpieza',departmentId:area.id});
    await createSimpleNovelty(receptionist,{title:'RECEP_OTHER',description:'Para Recepción'});
    const internal=await createSimpleNovelty(receptionist,{title:'INTERNA_PRIVADA',description:'Fondo de recepción',departmentId:area.id,internal:true});
    const data=await listSimpleNovelties(maid);expect(data.total).toBe(1);expect(data.general.map(row=>row.id)).toEqual([related.id]);expect(data.internalTotal).toBe(0);
    expect(await readEntries(prisma,maid).findMany({where:{OR:[{id:internal.id},{title:internal.title}]}})).toEqual([]);
    expect(await prisma.$queryRaw(Prisma.sql`SELECT e.id FROM "OperationalEntry" e WHERE e.id=${internal.id} AND (${entryReadSql(maid)})`)).toEqual([]);
    expect((await listSimpleNovelties(receptionist)).internalTotal).toBe(1);
    await expect(resolveSimpleNovelty(maid,related.id,operationalRecordRevision('entries',related))).rejects.toThrow();
    await expect(updateEntryVisibility(receptionist,{id:related.id,revision:related.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true})).rejects.toThrow(/área relacionada debe poder ver/);
    expect((await listSimpleNovelties(maid,{q:'HSK_VISIBLE'})).total).toBe(1);
    expect((await listSimpleNovelties(await createUser({roleKey:ROLE_KEYS.SUPERVISOR}))).total).toBe(2);
  });
});
