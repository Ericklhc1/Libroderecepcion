import {createOperationalAlarm,dispatchDueAlarmsForUser,listMyOperationalAlarms} from '@/server/services/operational-alarms';
import {runReceptionAssistant} from '@/server/ai/reception-assistant';
import {acknowledgeAlert} from '@/server/services/alerts';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
import {getRoomMonitorDetail,getRoomMonitorOverview} from '@/server/services/room-monitor';
import {searchOperationalRecords} from '@/server/services/global-search';
import {getSupervisionData} from '@/server/services/supervision';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,createShift,ROLE_KEYS} from './helpers';
import {getFormOptions} from '@/server/services/options';
import {getHistory} from '@/server/services/history';
import {getBookItems} from '@/server/services/book';
import {taskFollowUpReadWhere,followUpReadWhere,alertReadWhere} from '@/server/services/followup-access';
import {createEntry,getSubjectEntry,changeEntryStatus} from '@/server/services/entries';
import {createTask,changeTaskStatus,getTask,assignTask,toggleChecklistItem,softDeleteTask,restoreTask} from '@/server/services/tasks';
import {changeTaskStatusAction} from '@/server/actions/tasks';
import {updateEntryAction} from '@/server/actions/entries';
import {sendBookItemMailAction} from '@/server/actions/book-mail';
import {addComment,listComments} from '@/server/services/comments';
import {restoreFollowUp} from '@/server/services/followups';
import {buildHandoverSnapshot,visibleSnapshotItems} from '@/server/services/handover-snapshot';
import {getShiftBriefing} from '@/server/services/shifts';
import {coordinateWork} from '@/server/services/coordination';
import {getAssignmentBoard} from '@/server/services/assignment-board';
import {getUserPerformance} from '@/server/services/performance';
import {sendMail} from '@/server/mail';
const auth=vi.hoisted(()=>({current:vi.fn(),chat:vi.fn()}));
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:auth.current}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/mail',async original=>({...await original<object>(),sendMail:vi.fn()}));
vi.mock('@/server/ai/fronti-provider',async original=>({...await original<object>(),chatWithFrontiProviderChain:auth.chat,resolveFrontiProviderChainRuntime:async()=>[{provider:'groq',model:'synthetic'}]}));
vi.mock('@/server/ai/fronti-config',async original=>{const actual=await original<typeof import('@/server/ai/fronti-config')>();return {...actual,getFrontiConfig:async()=>({...await actual.getFrontiConfig(),enabled:true,tools:{room:true,priorities:true,deadlines:true,checkout:true,reminder:true,fine:true}})};});

describe('AROH Simple · reserva y revisión independiente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('asignar desde el formulario conserva causa y resultado, y permite corregirlos explícitamente',async()=>{
    const actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const assignee=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const source=await createEntry(actor,{type:'INCIDENCIA',title:'Causa documentada antes de asignar',description:'Contexto',priority:'ALTA',severity:'ALTA',requiresFollowUp:false,tags:[]});
    await prisma.operationalEntry.update({where:{id:source.id},data:{rootCause:'Causa comprobada',resolution:'Resultado anterior conservado'}});
    const form=new FormData();form.set('id',source.id);form.set('ownerId',assignee.id);
    auth.current.mockResolvedValue(actor);
    expect((await updateEntryAction(null,form)).ok).toBe(true);
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:source.id}})).toMatchObject({ownerId:assignee.id,rootCause:'Causa comprobada',resolution:'Resultado anterior conservado'});
    form.set('rootCause','Causa corregida');form.set('resolution','Resultado corregido');
    expect((await updateEntryAction(null,form)).ok).toBe(true);
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:source.id}})).toMatchObject({rootCause:'Causa corregida',resolution:'Resultado corregido'});
  });
  it('no crea ni notifica trabajo reservado a personas que no pueden recibirlo',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const receiver=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    for(const visibility of ['PRIVADO','SUPERVISION'] as const){
      const follow=await prisma.followUp.create({data:{action:'Origen reservado',visibility,ownerId:owner.id,createdById:owner.id}});
      const alert=await prisma.alert.create({data:{followUpId:follow.id,title:'Alerta reservada',message:'Evidencia',type:'SEGUIMIENTO_VENCIDO',level:'ATENCION'}});
      await expect(createTask(owner,{title:'No debe notificarse',alertId:alert.id,assigneeId:receiver.id,priority:'MEDIA',tags:[],checklist:[]})).rejects.toThrow('origen reservado');
      expect(await prisma.task.count({where:{alertId:alert.id}})).toBe(0);
    }
    expect(await prisma.notification.count({where:{userId:receiver.id}})).toBe(0);
  });
  it('protege IDs conocidos en comentarios, correo, Fronti, asignación, rendimiento y relevo',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const follow=await prisma.followUp.create({data:{action:'Contenido reservado de continuidad',visibility:'PRIVADO',ownerId:owner.id,createdById:owner.id}});
    const task=await prisma.task.create({data:{title:'Contenido reservado de ejecución',followUpId:follow.id,createdById:owner.id,assigneeId:owner.id,dueAt:new Date(Date.now()-3600000)}});
    const alert=await prisma.alert.create({data:{taskId:task.id,title:'Contenido reservado de señal',message:'Evidencia reservada',type:'TAREA_VENCIDA',level:'CRITICA'}});
    await expect(createTask(reader,{title:'Origen oculto',alertId:alert.id,priority:'MEDIA',tags:[],checklist:[]})).rejects.toThrow();
    const recipient=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    await prisma.user.update({where:{id:recipient.id},data:{departmentId:area.id}});
    const assignedSource=await prisma.task.update({where:{id:task.id},data:{departmentId:area.id}});
    await expect(assignTask(owner,{id:task.id,assigneeId:recipient.id})).rejects.toThrow('origen reservado');
    await expect(coordinateWork(owner,{kind:'task',id:task.id,updatedAt:assignedSource.updatedAt,requestKey:randomUUID(),action:'ASIGNAR',ownerId:recipient.id,nextAction:'Asignación debe respetar la reserva'})).rejects.toThrow('origen reservado');
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).assigneeId).toBe(owner.id);
    expect(await prisma.notification.count({where:{userId:recipient.id}})).toBe(0);
    const derived=await createTask(owner,{title:'Contenido reservado derivado',alertId:alert.id,priority:'MEDIA',tags:[],checklist:[]});
    expect(derived.followUpId).toBe(follow.id);
    expect((await searchOperationalRecords(reader,'Contenido reservado')).some(row=>row.entityId===derived.id)).toBe(false);
    for(const target of [{taskId:task.id},{followUpId:follow.id},{alertId:alert.id}]){
      await expect(addComment(reader,{...target,body:'No debe guardarse ni notificarse'})).rejects.toThrow();
      expect(await listComments(target,reader)).toHaveLength(0);
    }
    expect(await prisma.comment.count()).toBe(0);
    await addComment(owner,{taskId:task.id,body:`@${reader.username} Resultado reservado comentado`});
    expect(await prisma.notification.count({where:{userId:reader.id}})).toBe(0);
    expect(await listComments({taskId:task.id},reader)).toHaveLength(0);
    expect(await listComments({taskId:task.id},owner)).toHaveLength(1);
    auth.current.mockResolvedValue(reader);vi.mocked(sendMail).mockClear();
    for(const [kind,id] of [['task',task.id],['followup',follow.id],['alert',alert.id]]){
      const form=new FormData();form.set('kind',kind!);form.set('id',id!);form.set('to','synthetic@example.invalid');
      expect((await sendBookItemMailAction(null,form)).ok).toBe(false);
    }
    expect(sendMail).not.toHaveBeenCalled();
    const context=await executeFrontiPageContextTool(reader,resolveFrontiPageContext({pathname:'/alertas/sistema'}));
    expect(JSON.stringify(context)).not.toContain('Contenido reservado');
    const board=await getAssignmentBoard(reader);
    expect(board.unassigned.some(row=>row.id===derived.id)).toBe(false);
    expect(board.workload.find(row=>row.userId===owner.id)?.openTasks).toBe(0);
    const range={from:new Date(Date.now()-86400000),to:new Date(Date.now()+86400000)};
    expect(JSON.stringify(await getUserPerformance(reader,owner.id,range))).not.toContain('Contenido reservado');
    const shift=await createShift({type:'DIA'});
    expect(JSON.stringify(await getShiftBriefing(reader,shift))).not.toContain('Contenido reservado');
    expect(JSON.stringify(await buildHandoverSnapshot(reader))).not.toContain('Contenido reservado');
    // Even its author must not copy private content into a shared reception delivery.
    expect(JSON.stringify(await buildHandoverSnapshot(owner))).not.toContain('Contenido reservado');
    const historical=[{refType:'task',refId:task.id,title:task.title,detail:'Evidencia reservada'}];
    expect(await visibleSnapshotItems(reader,historical)).toMatchObject([{title:'Asunto reservado',refId:null}]);
    expect(await visibleSnapshotItems(owner,historical)).toEqual(historical);
    await prisma.followUp.update({where:{id:follow.id},data:{deletedAt:new Date()}});
    await expect(restoreFollowUp(reader,{id:follow.id})).rejects.toThrow();
    expect((await prisma.followUp.findUniqueOrThrow({where:{id:follow.id}})).deletedAt).not.toBeNull();
    await restoreFollowUp(owner,{id:follow.id});
  });
  it('Fronti no entrega vencimientos ni propone completar una fuente reservada',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const follow=await prisma.followUp.create({data:{action:'FRONTI_SECRETO_FOLLOWUP',visibility:'PRIVADO',createdById:owner.id,ownerId:reader.id,scheduledAt:new Date(Date.now()-1000)}});
    const task=await prisma.task.create({data:{title:'FRONTI_SECRETO_TASK',followUpId:follow.id,createdById:owner.id,assigneeId:reader.id,dueAt:new Date(Date.now()-1000)}});
    auth.current.mockResolvedValue(reader);
    for(const [tool,args,text] of [['consultar_vencimientos',{},'Consulta vencimientos'],['proponer_resolver_tarea',{taskId:task.id},`Completa tarea #${task.humanId}`]] as const){
      auth.chat.mockReset();
      const call={id:randomUUID(),type:'function',function:{name:tool,arguments:JSON.stringify(args)}};
      auth.chat.mockResolvedValueOnce({text:null,toolCalls:[call],assistantMessage:{role:'assistant',content:null,tool_calls:[call]},providerUsed:'groq',modelUsed:'synthetic'}).mockResolvedValueOnce({text:'Consulta terminada.',toolCalls:[],assistantMessage:{role:'assistant',content:'Consulta terminada.'},providerUsed:'groq',modelUsed:'synthetic'});
      const result=await runReceptionAssistant(reader,[{role:'user',content:text}]);
      expect(result.confirmations).toHaveLength(0);
      expect(auth.chat).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(auth.chat.mock.calls[1])).not.toContain('FRONTI_SECRETO');
    }
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('PENDIENTE');
  });
  it('resuelve cadenas históricas completas y ciclos sin perder reserva ni trabajo archivado',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const source=await prisma.followUp.create({data:{action:'Reserva profunda',visibility:'PRIVADO',createdById:owner.id,ownerId:owner.id}});
    let previous=await prisma.task.create({data:{title:'Reserva profunda 0',followUpId:source.id,createdById:owner.id,assigneeId:owner.id}});
    const first=previous;
    for(let i=1;i<=5;i++){
      const alert=await prisma.alert.create({data:{title:`Reserva profunda alerta ${i}`,taskId:previous.id,type:'TAREA_VENCIDA'}});
      previous=await prisma.task.create({data:{title:`Reserva profunda ${i}`,alertId:alert.id,createdById:owner.id,assigneeId:owner.id}});
      expect(await prisma.alert.count({where:{id:alert.id,AND:[alertReadWhere(reader)]}})).toBe(0);
    }
    const cycle=await prisma.alert.create({data:{title:'Reserva profunda ciclo',taskId:previous.id,type:'TAREA_VENCIDA'}});
    await prisma.task.update({where:{id:first.id},data:{alertId:cycle.id}});
    await prisma.followUp.update({where:{id:source.id},data:{deletedAt:new Date()}});
    const area=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    await prisma.user.update({where:{id:owner.id},data:{departmentId:area.id}});
    await prisma.task.update({where:{id:first.id},data:{assigneeId:null,departmentId:area.id}});
    await assignTask(owner,{id:first.id,assigneeId:owner.id});
    expect((await getTask(first.id,owner)).assigneeId).toBe(owner.id);
    const latest=await prisma.task.findUniqueOrThrow({where:{id:first.id}});
    await coordinateWork(owner,{kind:'task',id:first.id,updatedAt:latest.updatedAt,requestKey:randomUUID(),action:'ASIGNAR',ownerId:owner.id,nextAction:'Continuar trabajo cuyo origen fue archivado'});
    expect((await getTask(previous.id,owner)).id).toBe(previous.id);
    await expect(getTask(previous.id,reader)).rejects.toThrow();
    expect((await searchOperationalRecords(reader,'Reserva profunda')).some(r=>r.entityId===previous.id)).toBe(false);
    expect((await searchOperationalRecords(owner,'Reserva profunda')).some(r=>r.entityId===previous.id)).toBe(true);
    await changeTaskStatus(owner,{id:previous.id,status:'ACEPTADA'});
    expect((await getTask(previous.id,owner)).workAcknowledgedById).toBe(owner.id);
    expect(await prisma.taskSourceFollowUp.count({where:{taskId:previous.id,followUpId:source.id}})).toBe(1);
  });
  it('los recordatorios reservados respetan fuente antes de habitación, bandeja y aviso',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const source=await prisma.followUp.create({data:{action:'Recordatorio reservado',visibility:'PRIVADO',createdById:owner.id,ownerId:owner.id}});
    const room=await prisma.room.findFirstOrThrow({where:{number:'512'}});
    const task=await prisma.task.create({data:{title:'Origen reservado del recordatorio',roomId:room.id,followUpId:source.id,createdById:owner.id}});
    await expect(createOperationalAlarm(owner,{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'No copiar secreto',dueAt:new Date(Date.now()+3600000),recipientIds:[reader.id],sourceEntity:'Task',sourceId:task.id})).rejects.toThrow('origen reservado');
    expect(await prisma.operationalAlarm.count()).toBe(0);
    // Legacy record already assigned to an outsider must not leak on dispatch or room reads.
    const alarm=await prisma.operationalAlarm.create({data:{kind:'RECORDATORIO',scope:'INDIVIDUAL',title:'Contenido reservado de recordatorio',note:'Evidencia privada',dueAt:new Date(Date.now()-1000),createdById:owner.id,roomNumber:'512',sourceEntity:'Task',sourceId:task.id,sourceLink:`/tareas/${task.id}`,recipients:{create:{userId:reader.id}}}});
    expect((await getRoomMonitorDetail('512',reader)).alarms.some(a=>a.id===alarm.id)).toBe(false);
    expect((await getRoomMonitorDetail('512',owner)).alarms.some(a=>a.id===alarm.id)).toBe(true);
    expect(await listMyOperationalAlarms(reader.id)).toHaveLength(0);
    expect(await dispatchDueAlarmsForUser(reader.id)).toBe(0);
    expect(await prisma.notification.count({where:{userId:reader.id}})).toBe(0);
    expect(await prisma.operationalAlarmRecipient.findFirst({where:{alarmId:alarm.id}})).toMatchObject({lastTriggeredAt:null});
  });
  it('filtra Housekeeping histórico reservado antes del contexto sin ocultar la novedad',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const reader=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const source=await createEntry(admin,{type:'NOVEDAD',title:'Origen público',description:'Contexto',priority:'MEDIA',requiresFollowUp:false,tags:[]});
    await prisma.housekeepingRequest.create({data:{requestKey:randomUUID(),sourceEntryId:source.id,isDemo:true,resolution:'Resultado reservado',createdById:admin.id}});
    expect((await getSubjectEntry(reader,source.id)).title).toBe('Origen público');
    expect((await getSubjectEntry(reader,source.id)).housekeepingRequest).toBeNull();
    expect((await getSubjectEntry(admin,source.id)).housekeepingRequest?.resolution).toBe('Resultado reservado');
  });
  it('no proyecta seguimiento privado de otra persona ni la tarea que lo ejecuta',async()=>{
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const source=await createEntry(reader,{type:'NOVEDAD',title:'Origen común',description:'Contexto',priority:'MEDIA',requiresFollowUp:false,tags:[]});
    const room=await prisma.room.findFirstOrThrow({where:{number:'512'}});
    const reserved=await prisma.followUp.create({data:{action:'Reservado',visibility:'PRIVADO',createdById:owner.id,ownerId:owner.id,entryId:source.id}});
    const task=await prisma.task.create({data:{title:'Trabajo reservado',createdById:owner.id,entryId:source.id,followUpId:reserved.id,roomId:room.id,dueAt:new Date(Date.now()-3600000)}});
    expect(await prisma.followUp.count({where:{entryId:source.id,AND:[followUpReadWhere(reader)]}})).toBe(0);
    expect(await prisma.task.count({where:{entryId:source.id,AND:[taskFollowUpReadWhere(reader)]}})).toBe(0);
    expect(JSON.stringify((await getFormOptions(reader)).openTasks)).not.toContain('Trabajo reservado');
    await prisma.comment.create({data:{entryId:source.id,followUpId:reserved.id,authorId:owner.id,body:'Comentario reservado'}});
    const history=await getHistory({entity:'OperationalEntry',entityId:source.id},reader);
    expect(history.some(event=>event.id===reserved.id)).toBe(false);
    expect(JSON.stringify(history)).not.toContain('Comentario reservado');
    expect((await getHistory({entity:'OperationalEntry',entityId:source.id},owner)).some(event=>event.id===reserved.id)).toBe(true);
    expect((await getBookItems({},reader)).items.some(item=>item.id===task.id||item.id===reserved.id)).toBe(false);
    expect((await getBookItems({kinds:['task']},owner)).items.some(item=>item.id===task.id)).toBe(true);
    for(const origin of [{followUpId:reserved.id},{taskId:task.id}]){
      const alert=await prisma.alert.create({data:{title:'Aviso reservado',message:'Resultado reservado del origen',type:'TAREA_VENCIDA',level:'CRITICA',createdById:owner.id,...origin}});
      expect((await searchOperationalRecords(reader,'Aviso reservado')).some(row=>row.entityId===alert.id)).toBe(false);
      expect((await searchOperationalRecords(owner,'Aviso reservado')).some(row=>row.entityId===alert.id)).toBe(true);
      await expect(acknowledgeAlert(reader,alert.id)).rejects.toThrow();
      expect((await prisma.alert.findUniqueOrThrow({where:{id:alert.id}})).status).toBe('NUEVA');
    }
    await expect(getTask(task.id,reader)).rejects.toThrow();
    const context=await executeFrontiPageContextTool(reader,resolveFrontiPageContext({pathname:`/tareas/${task.id}`}));
    expect(context).toMatchObject({snapshot:{found:false}});
    expect(JSON.stringify(context)).not.toContain('Trabajo reservado');
    expect((await getTask(task.id,owner)).title).toBe('Trabajo reservado');
    expect((await getRoomMonitorOverview(reader)).rooms.find(r=>r.number==='512')?.openTasks).toBe(0);
    expect((await getRoomMonitorOverview(owner)).rooms.find(r=>r.number==='512')?.openTasks).toBe(1);
    expect((await getRoomMonitorDetail('512',reader)).tasks).toHaveLength(0);
    expect((await searchOperationalRecords(reader,'Trabajo reservado')).some(row=>row.entityId===task.id)).toBe(false);
    expect((await searchOperationalRecords(owner,'Trabajo reservado')).some(row=>row.entityId===task.id)).toBe(true);
    expect(JSON.stringify(await getSupervisionData(reader))).not.toContain('Trabajo reservado');
    const item=await prisma.taskChecklistItem.create({data:{taskId:task.id,text:'Paso reservado',order:0}});
    await expect(assignTask(reader,{id:task.id,assigneeId:reader.id})).rejects.toThrow();
    await expect(toggleChecklistItem(reader,{itemId:item.id,done:true})).rejects.toThrow();
    await expect(softDeleteTask(reader,{id:task.id,reason:'ID conocido fuera de alcance'})).rejects.toThrow();
    expect((await prisma.taskChecklistItem.findUniqueOrThrow({where:{id:item.id}})).done).toBe(false);
    await softDeleteTask(owner,{id:task.id,reason:'Archivo autorizado'});
    await expect(restoreTask(reader,{id:task.id})).rejects.toThrow();
    await restoreTask(owner,{id:task.id});
    await expect(changeTaskStatus(reader,{id:task.id,status:'EN_CURSO'})).rejects.toThrow();
    const attempt=new FormData();attempt.set('id',task.id);attempt.set('status','EN_CURSO');
    auth.current.mockResolvedValue(reader);
    await expect(changeTaskStatusAction(null,attempt)).resolves.toMatchObject({ok:false});
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('PENDIENTE');
  });
  it('resolver o cerrar una incidencia exige un resultado real en el servicio',async()=>{
    const actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    for(const status of ['RESUELTO','CERRADO'] as const){
      const incident=await createEntry(actor,{type:'INCIDENCIA',title:'Falla que requiere resultado',description:'Contexto real del procedimiento',priority:'ALTA',severity:'ALTA',requiresFollowUp:false,tags:[]});
      await expect(changeEntryStatus(actor,{id:incident.id,status})).rejects.toThrow('resolvió');
      await expect(changeEntryStatus(actor,{id:incident.id,status,resolution:'   '})).rejects.toThrow('resolvió');
      expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:incident.id}})).status).toBe('ABIERTO');
      await changeEntryStatus(actor,{id:incident.id,status,resolution:'Falla reparada y comprobada'});
      expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:incident.id}})).resolution).toBe('Falla reparada y comprobada');
    }
  });
  it('la aceptación registra recepción sólo por el responsable asignado',async()=>{
    const creator=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const receiver=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const task=await createTask(creator,{title:'Por recibir',assigneeId:receiver.id,priority:'MEDIA',tags:[],checklist:[]});
    await expect(changeTaskStatus(creator,{id:task.id,status:'ACEPTADA'})).rejects.toThrow('responsable');
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).workAcknowledgedAt).toBeNull();
    await changeTaskStatus(receiver,{id:task.id,status:'ACEPTADA'});
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).workAcknowledgedById).toBe(receiver.id);
  });
  it('permite validar con el permiso específico y conserva separación de ejecutor y reserva',async()=>{
    const executor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const reviewer=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});
    reviewer.permissions=['supervision.task.validate'];
    const task=await createTask(executor,{title:'Trabajo sujeto a revisión',priority:'MEDIA',tags:[],checklist:[],requiresIndependentValidation:true});
    await changeTaskStatus(executor,{id:task.id,status:'EN_CURSO'});
    await changeTaskStatus(executor,{id:task.id,status:'REALIZADA',evidenceProvided:'Resultado del ejecutor'});
    const form=new FormData();form.set('id',task.id);form.set('status','VALIDADA');
    auth.current.mockResolvedValue(executor);
    expect((await changeTaskStatusAction(null,form)).ok).toBe(false);
    auth.current.mockResolvedValue(reviewer);
    expect((await changeTaskStatusAction(null,form)).ok).toBe(true);
    expect(await prisma.task.findUnique({where:{id:task.id}})).toMatchObject({status:'VALIDADA',validatedById:reviewer.id,completedById:executor.id});
    const reserved=await prisma.followUp.create({data:{action:'Reservado',visibility:'PRIVADO',createdById:executor.id,ownerId:executor.id}});
    const privateTask=await prisma.task.create({data:{title:'Trabajo reservado',createdById:executor.id,followUpId:reserved.id,status:'REALIZADA',completedById:executor.id}});
    form.set('id',privateTask.id);
    expect((await changeTaskStatusAction(null,form)).ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({where:{id:privateTask.id}})).status).toBe('REALIZADA');
  });
});
