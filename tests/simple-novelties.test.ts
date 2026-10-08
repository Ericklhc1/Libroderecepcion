import {getAssignmentBoard} from '@/server/services/assignment-board';
import {ensureIncidentWorkflow} from '@/server/services/incident-workflow';
import {createNativeEntry,lockNativeNoveltyCreation} from '@/server/services/native-entry-creation';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { prisma,seedCatalog,resetOperationalData,createUser,createShift,ROLE_KEYS } from './helpers';
import { createEntry,updateEntry,changeEntryStatus,updateEntryVisibility } from '@/server/services/entries';
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

async function flag(value:boolean){await prisma.systemSetting.upsert({where:{key:'book.simpleNovelties'},create:{key:'book.simpleNovelties',value,category:'pruebas'},update:{value}});}
describe('prueba de novedades simples sobre el libro existente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('el tablero de asignación conserva tareas y excluye novedades simples en lista y total',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const row=await createEntry(supervisor,{type:'NOVEDAD',title:'Área sin persona',description:'Prueba',priority:'MEDIA',tags:[],requiresFollowUp:false});
    await prisma.task.create({data:{title:'Tarea asignable',createdById:supervisor.id}});
    const before=await getAssignmentBoard(supervisor);expect(before.unassigned.some(item=>item.id===row.id)).toBe(true);expect(before.unassignedTotal).toBe(2);
    await flag(true);const after=await getAssignmentBoard(supervisor);expect(after.unassigned.map(item=>item.kind)).toEqual(['task']);expect(after.unassignedTotal).toBe(1);
  });
  it('incidencias de formulario anterior y Fronti no generan cadenas con el modo simple encendido',async()=>{
    const author=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});await flag(true);
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
    const row=await createSimpleNovelty(author,{title:'Área oculta',description:'No perder el aviso'});
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
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
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
    const row=await createSimpleNovelty(outgoing,{title:'Novedad pendiente',description:'Ya fue atendida'});
    const withoutClose={...other,permissions:other.permissions.filter(p=>!['entry.close','incident.close'].includes(p))};
    const resolved=await resolveSimpleNovelty(withoutClose,row.id,operationalRecordRevision('entries',row));
    expect(resolved.status).toBe('RESUELTO');expect(await prisma.auditLog.count({where:{entityId:row.id,userId:other.id,action:'CAMBIO_ESTADO'}})).toBe(1);
    await expect(resolveSimpleNovelty(outgoing,row.id,operationalRecordRevision('entries',row))).rejects.toThrow(/cambió/);
    const next=await createSimpleNovelty(outgoing,{title:'Salida de turno',description:'Atendida por saliente'});
    expect((await resolveSimpleNovelty({...outgoing,permissions:withoutClose.permissions},next.id,operationalRecordRevision('entries',next))).status).toBe('RESUELTO');
    await flag(false);const legacy=await createEntry(outgoing,{type:'NOVEDAD',title:'Flag off',description:'Permiso anterior',priority:'MEDIA',tags:[],requiresFollowUp:false});
    await expect(changeEntryStatus(withoutClose,{id:legacy.id,status:'RESUELTO'})).rejects.toThrow(/permiso/);
  });
  it('el área ve sólo sus novedades; internas no salen por ORM, SQL, búsquedas ni contadores',async()=>{
    await flag(true);const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
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
