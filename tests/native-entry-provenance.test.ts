import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createUser, createShift, prisma, resetOperationalData, ROLE_KEYS, seedCatalog } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import { createEntry, updateEntryVisibility } from '@/server/services/entries';
import { createOperationalAlarm, countMyActiveOperationalAlarms, dispatchDueAlarmsForUser, listMyOperationalAlarms } from '@/server/services/operational-alarms';
import { auditFollowUpReadWhere, taskFollowUpReadWhere } from '@/server/services/followup-access';
import { markReadableNotifications, notificationWhereForUser } from '@/server/services/notification-access';
import { getWebPushPayload } from '@/server/services/web-push';
import { addComment, listComments } from '@/server/services/comments';
import { getHistory } from '@/server/services/history';
import { getManagementCockpit } from '@/server/services/management';
import { getManagementEvidence } from '@/server/services/management-evidence';
import { getAssignmentBoard } from '@/server/services/assignment-board';
import { deadlinesTool } from '@/server/ai/reception-assistant';
import { executeFrontiV2ReadTool } from '@/server/ai/fronti-v2/read-tools';
import { changeHousekeepingRequest, createHousekeepingRequest } from '@/server/services/housekeeping';
import { organizeLegacyHkWork } from '@/server/services/housekeeping-work';
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
    await hide(e.id,[receptionArea]);
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
    await hide(e.id,[managementArea]);
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
      const query=queries.find(q=>q.query.includes('ScopedTaskSourceEntry'))!;
      const rows=await client.$queryRawUnsafe<Record<string,unknown>[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`,...JSON.parse(query.params));
      const plan=(rows[0]!['QUERY PLAN'] as {Plan:Record<string,unknown>}[])[0]!.Plan;
      const buffers=Number(plan['Shared Hit Blocks']??0)+Number(plan['Shared Read Blocks']??0);
      // At most 2.4 MiB of reads: the unrelated history must not be a recursive seed.
      expect(buffers).toBeLessThan(300);
      expect(await client.scopedTaskSourceEntry.findMany({where:{taskId:task.id}})).toMatchObject([{taskId:task.id,entryId:e.id}]);
    } finally { await client.$disconnect(); }
  });
});
