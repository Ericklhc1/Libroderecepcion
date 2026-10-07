import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, createShift, prisma, resetOperationalData, ROLE_KEYS, seedCatalog } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import { createEntry, getSubjectEntry, updateEntryVisibility } from '@/server/services/entries';
import { acknowledgeOperationalAlarm, cancelOperationalAlarm, createOperationalAlarm, countMyActiveOperationalAlarms, dispatchDueAlarmsForUser, listMyOperationalAlarms } from '@/server/services/operational-alarms';
import { auditFollowUpReadWhere, followUpReadWhere, taskFollowUpReadWhere } from '@/server/services/followup-access';
import { markReadableNotifications, notificationWhereForUser } from '@/server/services/notification-access';
import { getWebPushPayload } from '@/server/services/web-push';
import { addComment, listComments } from '@/server/services/comments';
import { getHistory } from '@/server/services/history';
import { getManagementCockpit } from '@/server/services/management';
import { getManagementEvidence } from '@/server/services/management-evidence';
import { getAssignmentBoard } from '@/server/services/assignment-board';
import { deadlinesTool, roomTool } from '@/server/ai/reception-assistant';
import { executeFrontiV2ReadTool } from '@/server/ai/fronti-v2/read-tools';
import { changeHousekeepingRequest, createHousekeepingRequest } from '@/server/services/housekeeping';
import { organizeLegacyHkWork } from '@/server/services/housekeeping-work';
import {assertTaskSourceRecipients,assignTask,changeTaskStatus,createTask,updateTask,restoreTask} from '@/server/services/tasks';
import {buildSupervisorReport} from '@/server/services/supervisor-reports';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
import {getReservationOperationalContext,getReservationOperationalContextByCode,reservationModuleSignals} from '@/server/services/reservation-context';
import {getRoomDetail} from '@/server/services/rooms';
import {getMetrics,defaultRange} from '@/server/services/metrics';
import {entryReadWhere,entryReadSql,housekeepingEntryReadWhere} from '@/server/services/entry-visibility';
import {getAreaAttention,listAreaAttentions,decideAreaAttention} from '@/server/services/subject-distribution';
import {Prisma} from '@prisma/client';
import {restoreFollowUp} from '@/server/services/followups';
import {changeHkWork} from '@/server/services/housekeeping-work';
import { hotelDateKey } from '@/domain/time';

let reception: CurrentUser, supervisor: CurrentUser, management: CurrentUser;
let receptionArea: string, managementArea: string;
async function entry(extra: Partial<Parameters<typeof createEntry>[1]> = {}) {
  return createEntry(supervisor, { type:'NOVEDAD', title:'Origen confidencial 164', description:'Contexto confidencial', priority:'MEDIA', requiresFollowUp:false, tags:[], ...extra });
}
async function hide(id: string, areas: string[]) {
  const row=await prisma.operationalEntry.findUniqueOrThrow({where:{id}});
  return updateEntryVisibility(supervisor,{id,revision:row.updatedAt.toISOString(),hiddenDepartmentIds:areas,includeInReceptionHandover:true});
}

describe('visibilidad por origen nativo · revisión AROH 1.64',()=>{
  beforeAll(seedCatalog);
  beforeEach(async()=>{
    await resetOperationalData();
    reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    management=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});
    receptionArea=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    const dept=await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}});
    managementArea=dept.id;
    await prisma.user.update({where:{id:management.id},data:{departmentId:dept.id}});
    management.departmentId=dept.id;
  });


  for(const kind of ['task-assignee','task-collaborator','task-department','followup-owner'] as const)it(`restaurar ${kind} revalida destinatarios sin alterar la evidencia al rechazar`,async()=>{
    const e=await entry();const now=new Date();
    const follow=kind==='followup-owner'?await prisma.followUp.create({data:{entryId:e.id,action:'Continuidad restaurable',ownerId:reception.id,createdById:supervisor.id,visibility:'OPERATIVO',deletedAt:now}}):null;
    const task=follow?null:await prisma.task.create({data:{entryId:e.id,title:'Trabajo restaurable',createdById:supervisor.id,deletedAt:now,assigneeId:kind==='task-assignee'?reception.id:null,departmentId:kind==='task-department'?receptionArea:null,participants:kind==='task-collaborator'?{create:{userId:reception.id,assignedById:supervisor.id}}:undefined}});
    const restore=()=>follow?restoreFollowUp(supervisor,{id:follow.id}):restoreTask(supervisor,{id:task!.id});
    await hide(e.id,[receptionArea]);const audits=await prisma.auditLog.count();
    await expect(restore()).rejects.toThrow(/origen|visible|oculta/);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(follow?await prisma.followUp.findUnique({where:{id:follow.id}}):await prisma.task.findUnique({where:{id:task!.id}})).toMatchObject({deletedAt:now,status:'PENDIENTE'});
    await hide(e.id,[]);expect((await restore()).deletedAt).toBeNull();
    expect(await prisma.auditLog.count({where:{entityId:follow?.id??task!.id,action:'RESTAURAR'}})).toBe(1);
  });

  for(const workflowVersion of [0,1])for(const hiddenOrigin of ['source','maintenance'] as const)it(`reabrir HK v${workflowVersion} protege el destino en ${hiddenOrigin}`,async()=>{
    const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const source=await entry();const maintenance=await entry({title:'Dependencia de mantenimiento'});
    const work=await prisma.housekeepingRequest.create({data:{requestKey:'reopen-hk-164',sourceEntryId:source.id,maintenanceEntryId:maintenance.id,workflowVersion,departmentId:hk.id,status:'RESUELTO',createdById:sys.id,title:'Atención sintética',description:'Instrucción',workKind:'ZONA_COMUN',workDate:hotelDateKey(new Date()),effortMinutes:15}});
    const hidden=hiddenOrigin==='source'?source:maintenance;await hide(hidden.id,[hk.id]);const audits=await prisma.auditLog.count();
    const reopen=()=>workflowVersion===1?changeHkWork(sys,{id:work.id,version:work.version,action:'REABRIR',note:'Reapertura sintética'}):changeHousekeepingRequest(sys,{id:work.id,version:work.version,action:'REABRIR',note:'Reapertura sintética'});
    await expect(reopen()).rejects.toThrow(/oculta/);
    expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({status:'RESUELTO',version:work.version});expect(await prisma.auditLog.count()).toBe(audits);
    await hide(hidden.id,[]);await reopen();expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({status:'PENDIENTE',version:work.version+1});
  });


  it('reabrir HK revalida al responsable incluso cuando su área de destino sigue visible',async()=>{
    const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const worker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    await prisma.user.update({where:{id:worker.id},data:{departmentId:hk.id}});
    await prisma.scheduleCollaborator.create({data:{employeeCode:`REOPEN-HK-${worker.id}`,name:'Colaborador sintético',functionName:'HK',userId:worker.id,memberships:{create:{departmentId:managementArea}}}});
    const e=await entry();const work=await prisma.housekeepingRequest.create({data:{requestKey:'assigned-reopen-hk-164',sourceEntryId:e.id,departmentId:hk.id,assignedToId:worker.id,workflowVersion:1,status:'RESUELTO',createdById:sys.id,title:'Trabajo asignado',description:'Instrucción',workKind:'ZONA_COMUN',workDate:hotelDateKey(new Date()),effortMinutes:15}});
    await hide(e.id,[managementArea]);const audits=await prisma.auditLog.count();
    const reopen=()=>changeHkWork(sys,{id:work.id,version:work.version,action:'REABRIR',note:'Reapertura sintética'});
    await expect(reopen()).rejects.toThrow();expect(await prisma.auditLog.count()).toBe(audits);expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({status:'RESUELTO',version:work.version,assignedToId:worker.id});
    await hide(e.id,[]);await reopen();expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({status:'PENDIENTE',assignedToId:worker.id});
  });


  it('derivar un HK activo comprueba también la fuente de mantenimiento para el destino nuevo',async()=>{
    const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const source=await entry();const maintenance=await entry();
    const work=await prisma.housekeepingRequest.create({data:{requestKey:'transfer-maintenance-164',sourceEntryId:source.id,maintenanceEntryId:maintenance.id,departmentId:hk.id,createdById:sys.id,location:'Zona sintética'}});
    await hide(maintenance.id,[managementArea]);const audits=await prisma.auditLog.count();
    await expect(changeHousekeepingRequest(sys,{id:work.id,version:work.version,action:'DERIVAR',departmentId:managementArea,note:'Derivación sintética'})).rejects.toThrow(/oculta/);
    expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({departmentId:hk.id,status:'PENDIENTE',version:work.version});expect(await prisma.auditLog.count()).toBe(audits);
    await hide(maintenance.id,[]);await changeHousekeepingRequest(sys,{id:work.id,version:work.version,action:'DERIVAR',departmentId:managementArea,note:'Derivación sintética'});
    expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({departmentId:managementArea,version:work.version+1});
  });

  for(const contact of [false,true])it(`reabrir atención terminal revalida área y contacto urgente=${contact}`,async()=>{
    const previous=process.env.AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED;process.env.AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED='true';
    try{
      const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});const e=await entry();
      const attention=await prisma.subjectAreaAttention.create({data:{entryId:e.id,departmentId:hk.id,requestKey:'reopen-attention-164',createdById:supervisor.id,status:'INFORMADA',urgent:contact,urgentContactId:contact?reception.id:null}});
      await hide(e.id,[contact?receptionArea:hk.id]);const audits=await prisma.auditLog.count();
      const reopen=async()=>decideAreaAttention(sys,{id:attention.id,version:attention.version,sourceRevision:(await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).updatedAt.toISOString(),action:'REABRIR',note:'Reabrir atención'});
      await expect(reopen()).rejects.toThrow(/oculta|visible/);
      expect(await prisma.subjectAreaAttention.findUnique({where:{id:attention.id}})).toMatchObject({status:'INFORMADA',version:attention.version});expect(await prisma.auditLog.count()).toBe(audits);
      await hide(e.id,[]);await reopen();expect(await prisma.subjectAreaAttention.findUnique({where:{id:attention.id}})).toMatchObject({status:'POR_REVISAR',version:attention.version+1});
    }finally{if(previous===undefined)delete process.env.AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED;else process.env.AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED=previous;}
  });

  it('la ficha visible filtra atención HK con otro origen oculto y conserva el resultado histórico',async()=>{
    const source=await entry({title:'Origen público'});const maintenance=await entry();
    const work=await prisma.housekeepingRequest.create({data:{requestKey:'subject-hk-reader-164',sourceEntryId:source.id,maintenanceEntryId:maintenance.id,status:'RESUELTO',resolution:'MAINTENANCE_ONLY_SECRET',createdById:supervisor.id,inspectedById:supervisor.id}});
    expect((await getSubjectEntry(management,source.id)).housekeepingRequest?.resolution).toBe('MAINTENANCE_ONLY_SECRET');
    await hide(maintenance.id,[managementArea]);
    const visible=await getSubjectEntry(management,source.id);expect(visible.title).toBe('Origen público');expect(visible.housekeepingRequests).toEqual([]);expect(visible.housekeepingRequest).toBeNull();expect(JSON.stringify(visible)).not.toContain('MAINTENANCE_ONLY_SECRET');
    expect((await getSubjectEntry(supervisor,source.id)).housekeepingRequest?.resolution).toBe('MAINTENANCE_ONLY_SECRET');expect(await prisma.housekeepingRequest.findUnique({where:{id:work.id}})).toMatchObject({resolution:'MAINTENANCE_ONLY_SECRET',inspectedById:supervisor.id});
  });

  it('la incidencia automática valida destino bajo bloqueo y revierte novedad, hijos y auditoría juntos',async()=>{
    const input={type:'INCIDENCIA' as const,title:'Incidencia automática sintética',description:'Contexto',priority:'MEDIA' as const,severity:'ALTA' as const,requiresFollowUp:false,tags:[],departmentId:managementArea,hiddenDepartmentIds:[managementArea]};
    await expect(createEntry(supervisor,input,{incidentWorkflow:true})).rejects.toThrow(/oculta/);
    expect(await prisma.operationalEntry.count()).toBe(0);expect(await prisma.task.count()).toBe(0);expect(await prisma.followUp.count()).toBe(0);expect(await prisma.auditLog.count()).toBe(0);
    const source=await createEntry(supervisor,{...input,hiddenDepartmentIds:[]},{incidentWorkflow:true});
    expect(await prisma.task.findFirst({where:{entryId:source.id}})).toMatchObject({departmentId:managementArea,assigneeId:supervisor.id,status:'PENDIENTE'});
    expect(await prisma.followUp.findFirst({where:{entryId:source.id}})).toMatchObject({ownerId:supervisor.id,status:'PENDIENTE'});expect(await prisma.auditLog.count({where:{entityId:source.id,action:'CREAR'}})).toBe(1);
    await expect(hide(source.id,[managementArea])).rejects.toThrow(/trabajo pendiente/);
  });

  it('una atención informada no revela el origen oculto a miembros de su área, incluido acceso directo y paginado',async()=>{
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const worker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});await prisma.user.update({where:{id:worker.id},data:{departmentId:hk.id}});worker.departmentId=hk.id;
    const e=await entry();const attention=await prisma.subjectAreaAttention.create({data:{requestKey:'completed-attention-164',entryId:e.id,departmentId:hk.id,createdById:supervisor.id,status:'INFORMADA'}});
    expect((await getAreaAttention(worker,attention.id)).entry.title).toBe(e.title);
    expect((await listAreaAttentions(worker,{entryId:e.id})).rows.map(a=>a.id)).toEqual([attention.id]);
    await hide(e.id,[hk.id]);
    await expect(getAreaAttention(worker,attention.id)).rejects.toThrow();
    expect(await listAreaAttentions(worker,{entryId:e.id})).toMatchObject({rows:[],hasMore:false});
    expect((await getAreaAttention(supervisor,attention.id)).entry.id).toBe(e.id);
    expect(await prisma.subjectAreaAttention.findUnique({where:{id:attention.id}})).not.toBeNull();
  });

  for(const [closed,reopened] of [['VALIDADA','DEVUELTA'],['COMPLETADA','EN_CURSO'],['CANCELADA','PENDIENTE']] as const)it(`reactivar ${closed}→${reopened} exige responsables visibles y no modifica tarea/auditoría al rechazar`,async()=>{
    const e=await entry();const alert=await prisma.alert.create({data:{entryId:e.id,title:'Origen de reactivación',type:'OTRO'}});
    const task=await prisma.task.create({data:{alertId:alert.id,title:'Trabajo cerrado',status:closed,createdById:supervisor.id,assigneeId:management.id,participants:{create:{userId:management.id,assignedById:supervisor.id,role:'PRINCIPAL'}}}});
    await hide(e.id,[managementArea]);const audits=await prisma.auditLog.count({where:{entity:'Task',entityId:task.id}});
    await expect(changeTaskStatus(supervisor,{id:task.id,status:reopened,reason:'Reactivación sintética'})).rejects.toThrow(/no puede acceder/);
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe(closed);
    expect(await prisma.auditLog.count({where:{entity:'Task',entityId:task.id}})).toBe(audits);
    await assignTask(supervisor,{id:task.id,assigneeId:supervisor.id,reason:'Responsable autorizado'});
    expect((await changeTaskStatus(supervisor,{id:task.id,status:reopened,reason:'Reactivar con acceso'})).status).toBe(reopened);
  });

  it('reactivar también protege colaboradores y el destino, y crear/editar no permite destinos ocultos',async()=>{
    const e=await entry();
    const task=await prisma.task.create({data:{entryId:e.id,title:'Cerrada con colaborador',status:'CANCELADA',createdById:supervisor.id,assigneeId:supervisor.id,departmentId:managementArea,participants:{create:{userId:management.id,assignedById:supervisor.id,role:'COLABORADOR'}}}});
    await hide(e.id,[managementArea]);
    await expect(changeTaskStatus(supervisor,{id:task.id,status:'PENDIENTE',reason:'Reactivar'})).rejects.toThrow(/oculta al área de destino/);
    await prisma.task.update({where:{id:task.id},data:{departmentId:null}}); // Isolate historical collaborator evidence in this synthetic fixture.
    await expect(changeTaskStatus(supervisor,{id:task.id,status:'PENDIENTE',reason:'Reactivar'})).rejects.toThrow(/no puede acceder/);
    await expect(createTask(supervisor,{entryId:e.id,title:'Destino no visible',priority:'MEDIA',departmentId:managementArea,assigneeId:supervisor.id,tags:[],checklist:[]})).rejects.toThrow(/oculta al área de destino/);
    const open=await createTask(supervisor,{entryId:e.id,title:'Destino permitido',priority:'MEDIA',assigneeId:supervisor.id,tags:[],checklist:[]});
    await expect(updateTask(supervisor,{id:open.id,departmentId:managementArea})).rejects.toThrow(/oculta al área de destino/);
    await hide(e.id,[]);
    expect((await changeTaskStatus(supervisor,{id:task.id,status:'PENDIENTE',reason:'Origen visible otra vez'})).status).toBe('PENDIENTE');
  });

  it('pertenencias adicionales activas protegen ORM, SQL, HK y responsables incluso sin departamento primario',async()=>{
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const worker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});await prisma.user.update({where:{id:worker.id},data:{departmentId:null}});worker.departmentId=null;
    const c=await prisma.scheduleCollaborator.create({data:{employeeCode:'SYNTHETIC-MEMBER-164',name:'Membresía sintética',functionName:'HK',userId:worker.id,memberships:{create:{departmentId:hk.id}}}});
    const receptionC=await prisma.scheduleCollaborator.create({data:{employeeCode:'SYNTHETIC-CROSS-164',name:'Recepción adicional',functionName:'Recepción',userId:reception.id,memberships:{create:{departmentId:hk.id}}}});
    const e=await entry();
    const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});const request=await createHousekeepingRequest(sys,{requestKey:'membership-164',sourceEntryId:e.id,departmentId:hk.id,location:'Prueba sintética',priority:'MEDIA'});
    await changeHousekeepingRequest(sys,{id:request.id,version:request.version,action:'CANCELAR',note:'Fixture histórica terminada'});
    const task=await createTask(supervisor,{entryId:e.id,title:'Trabajo de miembro adicional',assigneeId:reception.id,priority:'MEDIA',tags:[],checklist:[]});
    await expect(hide(e.id,[hk.id])).rejects.toThrow(/trabajo pendiente/);
    await changeTaskStatus(supervisor,{id:task.id,status:'COMPLETADA',reason:'Fixture terminada'});
    await hide(e.id,[hk.id]);
    for(const reader of [worker,reception]){
      expect(await prisma.operationalEntry.count({where:{id:e.id,AND:[entryReadWhere(reader)]}})).toBe(0);
      expect(await prisma.$queryRaw(Prisma.sql`SELECT e.id FROM "OperationalEntry" e WHERE e.id=${e.id} AND (${entryReadSql(reader)})`)).toEqual([]);
      expect(await prisma.housekeepingRequest.count({where:{id:request.id,AND:[housekeepingEntryReadWhere(reader)]}})).toBe(0);
    }
    await prisma.scheduleMembership.update({where:{collaboratorId_departmentId:{collaboratorId:c.id,departmentId:hk.id}},data:{active:false}});
    expect(await prisma.operationalEntry.count({where:{id:e.id,AND:[entryReadWhere(worker)]}})).toBe(1);
    await prisma.scheduleCollaborator.update({where:{id:receptionC.id},data:{active:false}});
    expect(await prisma.operationalEntry.count({where:{id:e.id,AND:[entryReadWhere(reception)]}})).toBe(1);
  });

  it('reserva y Fronti no exponen entradas ni comentarios y trabajo derivados de un origen oculto',async()=>{
    const reservation=await prisma.reservationReference.create({data:{code:'SYNTHETIC-164-PRIVATE'}});
    const secret=await entry();const visible=await entry({title:'Contexto público',description:'Detalle público'});
    // Native legacy links, only synthetic rows: createEntry no longer creates PMS links.
    await prisma.operationalEntry.updateMany({where:{id:{in:[secret.id,visible.id]}},data:{reservationId:reservation.id}});
    await addComment(supervisor,{entryId:secret.id,body:'Comentario confidencial en reserva'});
    const hiddenAlert=await prisma.alert.create({data:{entryId:secret.id,reservationId:reservation.id,title:'Alerta confidencial en reserva',type:'OTRO'}});
    const crossTask=await prisma.task.create({data:{entryId:visible.id,alertId:hiddenAlert.id,title:'Derivado confidencial en padre público',createdById:supervisor.id}});
    await addComment(supervisor,{taskId:crossTask.id,body:'Comentario derivado confidencial'});
    await prisma.followUp.create({data:{entryId:visible.id,sourceEntity:'Task',sourceId:crossTask.id,action:'Seguimiento confidencial',createdById:supervisor.id,ownerId:supervisor.id}});
    await hide(secret.id,[managementArea]);
    for(const context of [await getReservationOperationalContext(reservation.id,management),await getReservationOperationalContextByCode(reservation.code,management)]){
      expect(context!.entries.map(e=>e.id)).toEqual([visible.id]);
      expect(reservationModuleSignals(context!)).toMatchObject({book:1,tasks:0,followUps:0,alerts:0,comments:0});
      expect(JSON.stringify(context)).not.toContain('confidencial');
    }
    expect(reservationModuleSignals((await getReservationOperationalContext(reservation.id,supervisor))!)).toMatchObject({book:2,tasks:1,followUps:1,alerts:1,comments:2});
    for(const pathname of [`/reservas/${reservation.code}`,`/huespedes/reservas/${reservation.id}`])expect(JSON.stringify(await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname})))).not.toContain('confidencial');
    expect(await prisma.comment.count()).toBe(2);
  });

  it('habitación, roomTool y contexto Fronti cuentan sólo incidencias visibles al lector',async()=>{
    const room=await prisma.room.findUniqueOrThrow({where:{number:'404'}});
    const e=await entry({type:'INCIDENCIA',severity:'BAJA',roomId:room.id});await hide(e.id,[managementArea]);
    expect(await getRoomDetail('404',management)).toMatchObject({openIncidents:0});
    expect(await getRoomDetail('404',supervisor)).toMatchObject({openIncidents:1});
    expect(await roomTool(management,{roomNumber:'404'})).toMatchObject({openIncidents:0});
    const context=await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname:'/habitaciones/404'}));
    expect(JSON.stringify(context)).toContain('"openIncidents":0');
    expect(await prisma.operationalEntry.findUnique({where:{id:e.id}})).not.toBeNull();
  });

  it('indicadores de alarmas respetan el área del lector y son independientes de inclusión en entrega',async()=>{
    const hidden=await entry();const publicEntry=await entry({title:'Visible fuera del relevo',includeInReceptionHandover:false});
    for(const e of [hidden,publicEntry])await createOperationalAlarm(supervisor,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'Indicador por lector',dueAt:new Date(Date.now()+60000),recipientIds:[supervisor.id],sourceEntity:'OperationalEntry',sourceId:e.id});
    await hide(hidden.id,[managementArea]);
    expect((await getMetrics(defaultRange(),management)).alerts.live).toBe(1);
    expect((await getMetrics(defaultRange(),supervisor)).alerts.live).toBe(2);
    expect((await getMetrics(defaultRange(),reception)).alerts.live).toBe(2);
    const context=await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname:'/indicadores'}));
    expect(JSON.stringify(context)).toContain('"live":1');
  });

  it('conserva restricciones de áreas ya ocultas desactivadas y rechaza agregar otras desactivadas',async()=>{
    const e=await entry();await hide(e.id,[managementArea]);
    await prisma.department.update({where:{id:managementArea},data:{active:false}});
    try{
      const before=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});
      const updated=await updateEntryVisibility(supervisor,{id:e.id,revision:before.updatedAt.toISOString(),hiddenDepartmentIds:[managementArea,receptionArea],includeInReceptionHandover:false});
      expect(updated.hiddenFromDepartments.map(d=>d.id).sort()).toEqual([managementArea,receptionArea].sort());
      expect(await prisma.operationalEntry.count({where:{id:e.id,AND:[(await import('@/server/services/entry-visibility')).entryReadWhere(management)]}})).toBe(0);
      const other=await entry();
      await expect(hide(other.id,[managementArea])).rejects.toThrow(/áreas vigentes/);
      expect(await prisma.auditLog.findFirst({where:{entityId:e.id,action:'EDITAR'},orderBy:{createdAt:'desc'}})).toMatchObject({after:{hiddenDepartmentIds:[managementArea,receptionArea],includeInReceptionHandover:false}});
    }finally{await prisma.department.update({where:{id:managementArea},data:{active:true}});}
  });

  it('bloquea la entrada ancestral de tareas derivadas durante la autorización de una reasignación',async()=>{
    const e=await entry();
    const alert=await prisma.alert.create({data:{entryId:e.id,title:'Origen derivado',type:'OTRO',level:'ATENCION'}});
    const task=await prisma.task.create({data:{alertId:alert.id,title:'Trabajo derivado',createdById:supervisor.id,assigneeId:supervisor.id}});
    let release!:()=>void;let ready!:()=>void;
    const held=new Promise<void>(r=>release=r);const locked=new Promise<void>(r=>ready=r);
    const writer=prisma.$transaction(async tx=>{await assertTaskSourceRecipients(tx,[management.id],task,true);ready();await held;});
    await locked;
    try {await expect(prisma.$transaction(tx=>tx.$queryRaw`SELECT id FROM "OperationalEntry" WHERE id=${e.id} FOR UPDATE NOWAIT`)).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});}
    finally {release();await writer;}
    await hide(e.id,[managementArea]);
    await expect(assignTask(supervisor,{id:task.id,assigneeId:management.id})).rejects.toThrow(/no puede acceder/);
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).assigneeId).toBe(supervisor.id);
  });

  it('no permite ocultar recordatorios activos hasta reconocerlos o cancelarlos mediante su motor',async()=>{
    const e=await entry();
    const task=await prisma.task.create({data:{entryId:e.id,title:'Origen de recordatorio',createdById:supervisor.id}});
    const alarms=[];
    for(const [sourceEntity,sourceId] of [['OperationalEntry',e.id],['Task',task.id]] as const)alarms.push(await createOperationalAlarm(supervisor,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'Pendiente asignado',dueAt:new Date(Date.now()+60000),recipientIds:[management.id],sourceEntity,sourceId}));
    const audits=await prisma.auditLog.count({where:{entity:'OperationalEntry',entityId:e.id}});
    await expect(hide(e.id,[managementArea])).rejects.toThrow(/trabajo pendiente/);
    expect(await prisma.auditLog.count({where:{entity:'OperationalEntry',entityId:e.id}})).toBe(audits);
    await acknowledgeOperationalAlarm(management,alarms[0]!.recipients[0]!.id);
    await expect(hide(e.id,[managementArea])).rejects.toThrow(/trabajo pendiente/);
    await cancelOperationalAlarm(supervisor,alarms[1]!.id);
    await hide(e.id,[managementArea]);
    expect(await prisma.operationalAlarm.count({where:{id:{in:alarms.map(a=>a.id)}}})).toBe(2);
  });

  it('informes de estado y contexto de Fronti agregan sólo lo visible al lector, con override de Supervisión',async()=>{
    const e=await entry();
    const task=await prisma.task.create({data:{entryId:e.id,title:'Trabajo secreto',createdById:supervisor.id}});
    await prisma.alert.create({data:{taskId:task.id,title:'Alerta secreta',type:'OTRO',level:'ATENCION'}});
    await hide(e.id,[managementArea]);
    const range={from:new Date(Date.now()-60000),to:new Date(Date.now()+60000)};
    const report=await buildSupervisorReport(management,'estado',range);
    expect(report.total).toBe(0);
    expect(report.summary).toContain('Estado vigente ahora · registros abiertos 0 · tareas abiertas 0 · alertas activas 0');
    expect((await buildSupervisorReport(supervisor,'estado',range)).total).toBe(3);
    expect((await buildSupervisorReport(reception,'estado',range)).total).toBe(3);
    const context=await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname:'/supervision/informes',search:'?reporte=estado'}));
    expect(JSON.stringify(context)).toContain('registros abiertos 0');
    expect(JSON.stringify(context)).not.toContain('registros abiertos 1');
  });

  it('oculta alarmas directas e indirectas, cuenta, despacho y notificaciones sin borrar sus registros',async()=>{
    const e=await entry();
    const task=await prisma.task.create({data:{entryId:e.id,title:'Tarea del origen',createdById:supervisor.id}});
    const alarms=[];
    for(const [sourceEntity,sourceId] of [['OperationalEntry',e.id],['Task',task.id]] as const) {
      alarms.push(await createOperationalAlarm(supervisor,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'Alarma confidencial',dueAt:new Date(Date.now()+60000),recipientIds:[reception.id],sourceEntity,sourceId}));
    }
    expect(await countMyActiveOperationalAlarms(reception.id)).toBe(2);
    const notifications=[];
    for(const alarm of alarms) notifications.push(await prisma.notification.create({data:{userId:reception.id,type:'ALARMA',title:'Alarma confidencial',entity:'OperationalAlarmRecipient',entityId:alarm.recipients[0]!.id}}));
    await expect(hide(e.id,[receptionArea])).rejects.toThrow(/trabajo pendiente/);
    // Historical anomaly only in synthetic fixtures; current writes must reject it above.
    await prisma.operationalEntry.update({where:{id:e.id},data:{hiddenFromDepartments:{set:[{id:receptionArea}]}}});
    expect(await listMyOperationalAlarms(reception.id)).toEqual([]);
    expect(await countMyActiveOperationalAlarms(reception.id)).toBe(0);
    expect(JSON.stringify((await executeFrontiV2ReadTool(reception,'consultar_alertas',{})).result)).not.toContain('Alarma confidencial');
    await prisma.operationalAlarm.updateMany({where:{id:{in:alarms.map(a=>a.id)}},data:{dueAt:new Date(Date.now()-1000)}});
    expect(await dispatchDueAlarmsForUser(reception.id)).toBe(0);
    expect(await prisma.operationalAlarmRecipient.count({where:{alarmId:{in:alarms.map(a=>a.id)},lastTriggeredAt:{not:null}}})).toBe(0);
    expect(await prisma.notification.findMany({where:await notificationWhereForUser(reception.id)})).toEqual([]);
    const endpoint='https://push.invalid/native-alarm-164';
    await prisma.pushSubscription.create({data:{userId:reception.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    expect(await getWebPushPayload({userId:reception.id,endpoint})).toMatchObject({unread:0,items:[]});
    for(const n of notifications) await markReadableNotifications(reception.id,n.id);
    expect(await prisma.notification.count({where:{id:{in:notifications.map(n=>n.id)},readAt:{not:null}}})).toBe(0);
    await expect(createOperationalAlarm(supervisor,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'No exponer',dueAt:new Date(Date.now()+60000),recipientIds:[reception.id],sourceEntity:'Task',sourceId:task.id})).rejects.toThrow(/destinatario/);
    expect(await prisma.operationalAlarm.count()).toBe(2);
    expect(await prisma.notification.count()).toBe(notifications.length);
  });

  it('filtra auditoría y Fronti por el origen de entradas, tareas, alertas, comentarios, alarmas y señales históricas',async()=>{
    const e=await entry();
    const task=await prisma.task.create({data:{entryId:e.id,title:'Tarea confidencial',createdById:supervisor.id}});
    const alert=await prisma.alert.create({data:{taskId:task.id,title:'Alerta confidencial',type:'OTRO',level:'ATENCION'}});
    const comment=await addComment(supervisor,{entryId:e.id,body:'Comentario confidencial'});
    const alarm=await createOperationalAlarm(supervisor,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'Alarma del origen',dueAt:new Date(Date.now()+60000),recipientIds:[management.id],sourceEntity:'Task',sourceId:task.id});
    const auditIds:string[]=[];
    for(const [entity,entityId] of [['OperationalEntry',e.id],['Task',task.id],['Alert',alert.id],['Comment',comment.id],['OperationalAlarm',alarm.id],['OperationalAlarmRecipient',alarm.recipients[0]!.id]] as const) {
      auditIds.push((await prisma.auditLog.create({data:{entity,entityId,action:'EDITAR',summary:'Resumen confidencial',userId:supervisor.id}})).id);
    }
    const signal=await prisma.auditLog.create({data:{entity:'FrontiProactiveSignal',entityId:'synthetic-164-signal',action:'CREAR',summary:'Señal confidencial',after:{sourceEntity:'Task',sourceEntityId:task.id}}});
    auditIds.push(signal.id);
    const ordinary=await prisma.auditLog.create({data:{entity:'User',entityId:supervisor.id,action:'EDITAR',summary:'Auditoría sin origen de novedad'}});
    const signalNotification=await prisma.notification.create({data:{userId:management.id,type:'ACTUALIZACION_OPERATIVA',title:'Señal confidencial',entity:'FrontiProactiveSignal',entityId:signal.entityId}});
    await expect(hide(e.id,[managementArea])).rejects.toThrow(/trabajo pendiente/);
    await prisma.operationalEntry.update({where:{id:e.id},data:{hiddenFromDepartments:{set:[{id:managementArea}]}}});
    const visible=await prisma.auditLog.findMany({where:auditFollowUpReadWhere(management)});
    expect(visible.map(a=>a.id)).toContain(ordinary.id);
    expect(visible.map(a=>a.id).filter(id=>auditIds.includes(id))).toEqual([]);
    expect(await getHistory({entity:'OperationalEntry',entityId:e.id},management)).toEqual([]);
    expect(await listComments({entryId:e.id},management)).toEqual([]);
    const fronti=await executeFrontiV2ReadTool(management,'consultar_auditoria',{limit:50});
    expect(JSON.stringify(fronti.result)).not.toContain('confidencial');
    expect(await prisma.notification.findMany({where:await notificationWhereForUser(management.id)})).toEqual([]);
    const endpoint='https://push.invalid/native-signal-164';
    await prisma.pushSubscription.create({data:{userId:management.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    expect(await getWebPushPayload({userId:management.id,endpoint})).toMatchObject({unread:0,items:[]});
    expect(await prisma.notification.findUnique({where:{id:signalNotification.id}})).not.toBeNull();
    expect(await prisma.auditLog.count({where:{id:{in:auditIds},AND:[auditFollowUpReadWhere(supervisor)]}})).toBe(auditIds.length);
    expect(await prisma.comment.findUnique({where:{id:comment.id}})).not.toBeNull();
  });

  it('Gerencia aplica su propia área antes de contar o paginar evidencias y conserva la selección de recepción independiente',async()=>{
    const e=await entry({type:'INCIDENCIA',severity:'CRITICA',priority:'CRITICA',dueAt:new Date(Date.now()-60000)});
    const task=await prisma.task.create({data:{entryId:e.id,title:'Tarea crítica confidencial',createdById:supervisor.id,dueAt:new Date(Date.now()-60000)}});
    await hide(e.id,[managementArea]);
    const cockpit=await getManagementCockpit(management);
    expect(cockpit.execution).toMatchObject({overdueTasks:0,openIncidents:0,criticalOpenIncidents:0,incidentsWithoutDate:0});
    expect(JSON.stringify(cockpit)).not.toContain('confidencial');
    for(const kind of ['tasks-overdue','critical-incidents']) expect(await getManagementEvidence(management,{kind})).toMatchObject({total:0,rows:[]});
    expect(await prisma.task.count({where:{id:task.id,AND:[taskFollowUpReadWhere(reception)]}})).toBe(1);
    await hide(e.id,[receptionArea]);
    expect(await getManagementEvidence(management,{kind:'critical-incidents'})).toMatchObject({total:1});
    expect(await getManagementEvidence(management,{kind:'tasks-overdue'})).toMatchObject({total:1});
    expect(await prisma.task.findUnique({where:{id:task.id}})).not.toBeNull();
  });

  it('Fronti vencimientos y carga por responsable excluyen novedades ocultas antes de ordenar y contar',async()=>{
    const secret=await entry({priority:'CRITICA',ownerId:supervisor.id,dueAt:new Date(Date.now()+60000)});
    const publicEntry=await entry({title:'Novedad visible',ownerId:supervisor.id,dueAt:new Date(Date.now()+60000)});
    await hide(secret.id,[managementArea]);
    const deadlines=await deadlinesTool(management,{hours:24});
    expect(deadlines.items.map(i=>i.id)).toEqual([publicEntry.id]);
    expect((await deadlinesTool(supervisor,{hours:24})).items.map(i=>i.id)).toContain(secret.id);
    const workload=(await getAssignmentBoard(management)).workload.find(p=>p.userId===supervisor.id);
    expect(workload).toMatchObject({openEntries:1,urgent:0});
    expect((await getAssignmentBoard(supervisor)).workload.find(p=>p.userId===supervisor.id)).toMatchObject({openEntries:2,urgent:1});
  });

  it('DERIVAR y organizar avisos HK históricos rechazan áreas ocultas y no alteran estado, versión ni auditoría',async()=>{
    const sys=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const destination=await prisma.department.findUniqueOrThrow({where:{key:'AREAS_PUBLICAS'}});
    const e=await entry();
    const request=await createHousekeepingRequest(sys,{requestKey:'legacy-review164',sourceEntryId:e.id,departmentId:hk.id,location:'Zona sintética',priority:'MEDIA'});
    await hide(e.id,[destination.id]);
    const before=await prisma.auditLog.count();
    await expect(changeHousekeepingRequest(sys,{id:request.id,version:request.version,action:'DERIVAR',departmentId:destination.id,note:'Derivación sintética'})).rejects.toThrow(/oculta/);
    expect(await prisma.housekeepingRequest.findUnique({where:{id:request.id}})).toMatchObject({departmentId:hk.id,version:request.version,workflowVersion:0});
    expect(await prisma.auditLog.count()).toBe(before);
    await expect(hide(e.id,[hk.id])).rejects.toThrow(/trabajo pendiente/);
    // Historical inconsistent fixture: the write guard must still reject its destination.
    await prisma.operationalEntry.update({where:{id:e.id},data:{hiddenFromDepartments:{set:[{id:hk.id}]}}});
    await expect(organizeLegacyHkWork(sys,{id:request.id,version:request.version,departmentId:hk.id,workDate:hotelDateKey(new Date()),workKind:'ZONA_COMUN',effortMinutes:15,requiresInspection:false,note:'Organización sintética'})).rejects.toThrow(/oculta/);
    expect(await prisma.housekeepingRequest.findUnique({where:{id:request.id}})).toMatchObject({workflowVersion:0,version:request.version});
  });
});

describe('procedencia acotada: auditoría de áreas, responsables y resumen',()=>{
  beforeAll(seedCatalog);
  beforeEach(async()=>{
    await resetOperationalData();reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});management=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});
    receptionArea=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;
    managementArea=(await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}})).id;
    await prisma.user.update({where:{id:management.id},data:{departmentId:managementArea}});management.departmentId=managementArea;
  });

  it('rechaza ocultar responsables activos de tareas indirectas, participantes y seguimientos; permite tras reasignar o finalizar',async()=>{
    const e=await entry();const alert=await prisma.alert.create({data:{entryId:e.id,type:'OTRO',title:'Origen indirecto'}});
    const task=await prisma.task.create({data:{alertId:alert.id,title:'Pendiente asignado',createdById:supervisor.id,assigneeId:reception.id}});
    const participant=await prisma.taskAssignment.create({data:{taskId:task.id,userId:reception.id,assignedById:supervisor.id,role:'COLABORADOR'}});
    const followUp=await prisma.followUp.create({data:{taskId:task.id,ownerId:reception.id,createdById:supervisor.id,action:'Pendiente vinculado'}});
    const audits=await prisma.auditLog.count();
    await expect(hide(e.id,[receptionArea])).rejects.toThrow(/responsable de trabajo pendiente/);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id},include:{hiddenFromDepartments:true}})).hiddenFromDepartments).toEqual([]);
    await prisma.task.update({where:{id:task.id},data:{assigneeId:supervisor.id}});
    await expect(hide(e.id,[receptionArea])).rejects.toThrow(/responsable de trabajo pendiente/);
    await prisma.taskAssignment.update({where:{id:participant.id},data:{removedAt:new Date()}});
    await expect(hide(e.id,[receptionArea])).rejects.toThrow(/responsable de trabajo pendiente/);
    await prisma.followUp.update({where:{id:followUp.id},data:{status:'CUMPLIDO'}});
    await prisma.task.update({where:{id:task.id},data:{departmentId:receptionArea}});
    await expect(hide(e.id,[receptionArea])).rejects.toThrow(/trabajo pendiente vinculado para un área/);
    await prisma.task.update({where:{id:task.id},data:{departmentId:null}});
    await hide(e.id,[receptionArea]);
    expect(await prisma.task.count({where:{id:task.id,AND:[taskFollowUpReadWhere(supervisor)]}})).toBe(1);
    expect(await prisma.task.findUnique({where:{id:task.id}})).toMatchObject({assigneeId:supervisor.id,status:'PENDIENTE'});
    expect(await prisma.followUp.findUnique({where:{id:followUp.id}})).toMatchObject({status:'CUMPLIDO'});
  });

  it('los comprobantes de distribución y la auditoría de atención heredan la visibilidad de su novedad sin hijos',async()=>{
    const e=await entry();
    const attention=await prisma.subjectAreaAttention.create({data:{entryId:e.id,departmentId:managementArea,requestKey:'native-attention-164',createdById:supervisor.id,status:'INFORMADA'}});
    const audit=await prisma.auditLog.create({data:{entity:'SubjectAreaAttention',entityId:attention.id,userId:supervisor.id,action:'EDITAR',summary:'Atención confidencial',reason:'Motivo confidencial',after:{status:'INFORMADA',version:1,urgent:false,taskId:null,housekeepingId:null}}});
    const receipt=await prisma.auditLog.create({data:{entity:'SubjectDistribution',entityId:'distribution:synthetic:164:receipt',userId:supervisor.id,action:'CREAR',summary:'Distribución confidencial',after:{attentionIds:[attention.id],departmentIds:[managementArea]}}});
    await hide(e.id,[managementArea]);
    expect(await prisma.auditLog.count({where:{id:{in:[audit.id,receipt.id]},AND:[auditFollowUpReadWhere(management)]}})).toBe(0);
    expect(JSON.stringify((await executeFrontiV2ReadTool(management,'consultar_auditoria',{})).result)).not.toContain('confidencial');
    expect(await prisma.auditLog.count({where:{id:{in:[audit.id,receipt.id]},AND:[auditFollowUpReadWhere(supervisor)]}})).toBe(2);
    expect(await prisma.subjectAreaAttention.findUnique({where:{id:attention.id}})).not.toBeNull();
  });

  it('los comentarios directos de una entrada oculta se filtran antes del límite en el resumen de turno',async()=>{
    const secret=await entry();const publicEntry=await entry({title:'Novedad pública'});
    await addComment(supervisor,{entryId:secret.id,body:'COMENTARIO_CONFIDENCIAL_164'});
    const visible=await addComment(supervisor,{entryId:publicEntry.id,body:'Comentario público'});
    await hide(secret.id,[receptionArea]);
    const {getShiftBriefing}=await import('@/server/services/shifts');
    const shift=await createShift({userId:reception.id,type:'DIA'});
    const briefing=await getShiftBriefing(reception,shift);
    expect(briefing.comments.map(c=>c.id)).toEqual([visible.id]);
    expect(JSON.stringify(briefing)).not.toContain('COMENTARIO_CONFIDENCIAL_164');
    expect(await prisma.comment.count()).toBe(2);
  });

  it('una consulta Prisma de una tarea usa su índice y recorrido propio aun con miles de auditorías y avisos ajenos',async()=>{
    const {PrismaClient}=await import('@prisma/client');
    const e=await entry();const task=await prisma.task.create({data:{entryId:e.id,title:'Objetivo acotado',createdById:supervisor.id}});
    await prisma.task.createMany({data:Array.from({length:800},(_,i)=>({title:`Ruido tarea ${i}`,createdById:supervisor.id}))});
    await prisma.auditLog.createMany({data:Array.from({length:4000},(_,i)=>({entity:'User',entityId:supervisor.id,action:'EDITAR' as const,summary:`Ruido auditoría ${i}`}))});
    await prisma.notification.createMany({data:Array.from({length:4000},(_,i)=>({userId:management.id,type:'ACTUALIZACION_OPERATIVA' as const,entity:'User',entityId:supervisor.id,title:`Ruido aviso ${i}`}))});
    const queries:{query:string;params:string}[]=[];
    const client=new PrismaClient({log:[{level:'query',emit:'event'}]});client.$on('query',q=>queries.push(q));
    try {
      expect(await client.task.findFirst({where:{id:task.id,AND:[taskFollowUpReadWhere(management)]},select:{id:true}})).toEqual({id:task.id});
      const query=queries.find(q=>q.query.includes('BoundedTaskSourceEntry'))!;
      const rows=await client.$queryRawUnsafe<Record<string,unknown>[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,...JSON.parse(query.params));
      const plan=(rows[0]!['QUERY PLAN'] as {Plan:Record<string,unknown>}[])[0]!.Plan;
      const buffers=Number(plan['Shared Hit Blocks']??0)+Number(plan['Shared Read Blocks']??0);
      // At most 2.4 MiB of reads: the unrelated history must not be a recursive seed.
      expect(buffers).toBeLessThan(300);
      expect(await client.scopedTaskSourceEntry.findMany({where:{taskId:task.id}})).toMatchObject([{taskId:task.id,entryId:e.id}]);
    } finally { await client.$disconnect(); }
  });
  it('los conteos anidados del Libro preservan la reserva sin compilar cada recorrido de origen en el SQL padre',async()=>{
    const {PrismaClient}=await import('@prisma/client');
    const e=await entry();const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const reserved=await prisma.followUp.create({data:{entryId:e.id,action:'Seguimiento privado',visibility:'PRIVADO',createdById:supervisor.id,ownerId:supervisor.id}});
    await prisma.comment.create({data:{entryId:e.id,followUpId:reserved.id,authorId:supervisor.id,body:'Comentario reservado'}});
    const queries:{query:string;params:string}[]=[];
    const client=new PrismaClient({log:[{level:'query',emit:'event'}]});client.$on('query',q=>queries.push(q));
    const read=(user:CurrentUser)=>client.operationalEntry.findMany({where:{deletedAt:null},orderBy:{occurredAt:'desc'},take:60,include:{_count:{select:{comments:{where:{OR:[{followUpId:null},{followUp:followUpReadWhere(user)}]}},followUps:{where:followUpReadWhere(user)}}}}});
    try {
      expect((await read(admin))[0]!._count).toEqual({comments:0,followUps:0});
      expect((await read(management))[0]!._count).toEqual({comments:0,followUps:0});
      expect((await read(supervisor))[0]!._count).toEqual({comments:1,followUps:1});
      const query=queries.find(q=>q.query.includes('BoundedFollowUpSourceEntry'))!;
      // The suite shares this synthetic DB and deletes fixtures between tests.
      // Refresh estimates for this measured fixture, not earlier files' row counts.
      await client.$executeRawUnsafe('ANALYZE "OperationalEntry", "FollowUp", "Task", "Alert", "Comment"');
      // Force expression compilation on this isolated connection only, so the
      // regression cannot hide behind warm plans or CI's table-statistics mix.
      await client.$executeRawUnsafe('SET jit_above_cost=0');
      const rows=await client.$queryRawUnsafe<{'QUERY PLAN':{Plan:Record<string,unknown>;JIT?:{Functions:number};'Execution Time':number}[]}[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,...JSON.parse(query.params));
      const plan=rows[0]!['QUERY PLAN'][0]!;
      expect(Number(plan.Plan['Total Cost'])).toBeLessThan(10000);
      expect(plan.JIT?.Functions??0).toBeLessThan(1000);
      expect(plan['Execution Time']).toBeLessThan(4000);
      expect(await prisma.followUp.findUnique({where:{id:reserved.id}})).not.toBeNull();
    } finally {await client.$disconnect();}
  });

});
