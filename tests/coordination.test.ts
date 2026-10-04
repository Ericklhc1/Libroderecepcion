import { randomUUID } from 'node:crypto';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { prisma,seedCatalog,resetOperationalData,createUser,createShift,ROLE_KEYS } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import { coordinateWork,getCoordinationBoard,escalateUnreceivedWork,getCoordinationTeam,coordinationMetrics } from '@/server/services/coordination';
import { createTask,assignTask,changeTaskStatus } from '@/server/services/tasks';
import { createEntry,changeEntryStatus,updateEntry } from '@/server/services/entries';
import { createHkWork,changeHkWork,saveHkHandover,receiveHkHandover,acceptHkHandover,organizeLegacyHkWork } from '@/server/services/housekeeping-work';
import { escalateHousekeepingRequests } from '@/server/services/housekeeping';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { receiptDueAt } from '@/domain/coordination';
import { hotelDateKey, hotelWallDateTime } from '@/domain/time';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));

describe('Etapa 1: coordinación con fuentes reales y continuidad',()=>{
  let admin:CurrentUser,a:CurrentUser,b:CurrentUser,maid:CurrentUser,area:string,hkArea:string;
  beforeAll(seedCatalog);
  beforeEach(async()=>{
    await resetOperationalData();
    admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});a=await createUser({roleKey:ROLE_KEYS.SUPERVISOR,name:'Responsable A'});b=await createUser({roleKey:ROLE_KEYS.SUPERVISOR,name:'Responsable B'});maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    area=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;hkArea=(await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}})).id;
    await prisma.user.updateMany({where:{id:{in:[admin.id,a.id,b.id]}},data:{departmentId:area}});
    await prisma.user.update({where:{id:maid.id},data:{departmentId:hkArea}});
  });
  const entry=()=>createEntry(admin,{type:'NOVEDAD',title:'Solicitud sintética',description:'Atención con continuidad',departmentId:area,ownerId:a.id,priority:'MEDIA',requiresFollowUp:false,tags:[]});
  const task=()=>createTask(admin,{title:'Trabajo sintético',assigneeId:a.id,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
  async function mutate(user:CurrentUser,id:string,kind:'task'|'entry',action:'RECIBIR'|'ASIGNAR'|'SIGUIENTE',ownerId?:string){const row=kind==='task'?await prisma.task.findUniqueOrThrow({where:{id}}):await prisma.operationalEntry.findUniqueOrThrow({where:{id}});return coordinateWork(user,{kind,id,updatedAt:row.updatedAt,requestKey:randomUUID(),action,ownerId,nextAction:'Verificar y registrar resultado'});}
  it('asigna, recibe, atiende y resuelve usando la tarea original',async()=>{
    const t=await task();await mutate(a,t.id,'task','RECIBIR');
    expect((await prisma.task.findUniqueOrThrow({where:{id:t.id}})).status).toBe('ACEPTADA');
    await changeTaskStatus(a,{id:t.id,status:'EN_CURSO'});await changeTaskStatus(a,{id:t.id,status:'REALIZADA',evidenceProvided:'Trabajo verificado'});await changeTaskStatus(b,{id:t.id,status:'VALIDADA'});
    expect((await getCoordinationBoard(a)).rows.some(r=>r.id===t.id)).toBe(false);
    const result=(await getCoordinationBoard(a,{history:true})).rows.find(r=>r.id===t.id)!;expect(result.receivedAt).not.toBeNull();expect(result.startedAt).not.toBeNull();expect(result.completedAt).not.toBeNull();expect(await prisma.task.count()).toBe(1);
  });
  it('rechaza recepción ajena y lectura/escritura desde una cuenta exclusiva del área',async()=>{
    const t=await task();await expect(mutate(b,t.id,'task','RECIBIR')).rejects.toThrow();await expect(mutate(maid,t.id,'task','RECIBIR')).rejects.toThrow();expect((await getCoordinationBoard(maid)).rows).toHaveLength(0);
  });
  it('reasignar obliga nueva recepción; el responsable saliente no puede confirmar',async()=>{
    const t=await task();await mutate(a,t.id,'task','RECIBIR');await mutate(admin,t.id,'task','ASIGNAR',b.id);
    const reassigned=await prisma.task.findUniqueOrThrow({where:{id:t.id}});expect(reassigned.workAcknowledgedAt).toBeNull();expect(reassigned.assigneeId).toBe(b.id);expect((await getCoordinationBoard(b)).rows.find(r=>r.id===t.id)!.nextAction).toBe('Verificar y registrar resultado');
    await expect(mutate(a,t.id,'task','RECIBIR')).rejects.toThrow();await mutate(b,t.id,'task','RECIBIR');
    expect(await prisma.taskAssignment.count({where:{taskId:t.id,userId:b.id,role:'PRINCIPAL',removedAt:null}})).toBe(1);
    await assignTask(admin,{id:t.id,assigneeId:a.id,reason:'Relevo desde pantalla original'});expect((await prisma.task.findUniqueOrThrow({where:{id:t.id}})).workAcknowledgedAt).toBeNull();
  });
  it('el reintento tras perder respuesta no duplica auditoría ni notificaciones',async()=>{
    const e=await entry();const input={kind:'entry' as const,id:e.id,updatedAt:e.updatedAt,requestKey:randomUUID(),action:'ASIGNAR' as const,ownerId:b.id,nextAction:'Atender solicitud'};
    await Promise.all([coordinateWork(admin,input),coordinateWork(admin,input)]);
    expect(await prisma.auditLog.count({where:{entityId:e.id,summary:{contains:'Coordinación'}}})).toBe(1);
    expect(await prisma.notification.count({where:{entityId:e.id,title:{contains:'por recibir'}}})).toBe(1);
    await expect(coordinateWork(admin,{...input,nextAction:'Cambiar el contenido con la misma clave'})).rejects.toThrow('reintento');
  });
  it('dos reasignaciones con la misma versión no se sobrescriben',async()=>{
    const e=await entry();const input={kind:'entry' as const,id:e.id,updatedAt:e.updatedAt,action:'ASIGNAR' as const,nextAction:'Continuar atención'};
    const results=await Promise.allSettled([coordinateWork(admin,{...input,requestKey:randomUUID(),ownerId:b.id}),coordinateWork(admin,{...input,requestKey:randomUUID(),ownerId:a.id})]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  });
  it('un pendiente sobrevive al cierre de turno; recepción y cambio de responsable siguen explícitos',async()=>{
    const old=await createShift({type:'DIA',userId:a.id,status:'ACTIVO'});const e=await entry();await prisma.operationalEntry.update({where:{id:e.id},data:{shiftId:old.id}});
    await prisma.shift.update({where:{id:old.id},data:{status:'CERRADO'}});
    await createShift({type:'NOCHE',userId:b.id,status:'ACTIVO'});
    expect((await getCoordinationBoard(b)).rows.some(r=>r.id===e.id)).toBe(true);await mutate(admin,e.id,'entry','ASIGNAR',b.id);await mutate(b,e.id,'entry','RECIBIR');
    await changeEntryStatus(b,{id:e.id,status:'EN_CURSO'});await changeEntryStatus(b,{id:e.id,status:'CERRADO',resolution:'Solicitud atendida'});
    expect((await getCoordinationBoard(b,{history:true})).rows.some(r=>r.id===e.id)).toBe(true);expect(await prisma.cashMovement.count()).toBe(0);
  });
  it('agrupa tareas y seguimientos por asunto y no filtra privacidad por contador',async()=>{
    const e=await entry();const f=await prisma.followUp.create({data:{action:'PRIVADO_NO_MOSTRAR',ownerId:a.id,createdById:admin.id,entryId:e.id,visibility:'PRIVADO'}});
    await prisma.task.create({data:{title:'PRIVADO_TAREA',createdById:admin.id,assigneeId:a.id,followUpId:f.id,entryId:e.id}});
    await createTask(admin,{title:'Atención visible',entryId:e.id,assigneeId:a.id,priority:'MEDIA',tags:[],checklist:[]});
    const board=await getCoordinationBoard(a);expect(board.rows).toHaveLength(1);expect(board.rows[0]!.children).toHaveLength(1);expect(board.total).toBe(1);expect(board.byArea.reduce((total,row)=>total+row.total,0)).toBe(1);expect(JSON.stringify(board)).not.toContain('PRIVADO');
  });
  it('la carga por área incluye las páginas restantes sin duplicar fuentes',async()=>{
    await prisma.task.createMany({data:Array.from({length:27},(_,i)=>({title:`Carga sintética ${i}`,createdById:admin.id,assigneeId:a.id,departmentId:area}))});
    const first=await getCoordinationBoard(a,{mine:true});const second=await getCoordinationBoard(a,{mine:true,page:2});
    expect(first.rows).toHaveLength(25);expect(second.rows).toHaveLength(2);expect(first.total).toBe(27);expect(first.hasMore).toBe(true);expect(second.hasMore).toBe(false);expect(first.byArea).toEqual(second.byArea);expect(first.byArea[0]!.total).toBe(27);
  });
  it('incluye seguimientos independientes autorizados y enlaces al recorrido existente',async()=>{
    const visible=await prisma.followUp.create({data:{action:'Continuidad independiente',ownerId:a.id,createdById:admin.id,nextAction:'Verificar resultado',visibility:'OPERATIVO'}});
    await prisma.followUp.create({data:{action:'PRIVADO_OCULTO',ownerId:a.id,createdById:admin.id,visibility:'PRIVADO'}});
    const board=await getCoordinationBoard(a,{departmentId:area});expect(board.total).toBe(1);expect(board.rows[0]!.id).toBe(visible.id);expect(board.rows[0]!.href).toBe(`/seguimientos?q=${visible.humanId}&estado=todos`);expect(JSON.stringify(board)).not.toContain('PRIVADO_OCULTO');
  });
  it('escalamiento persistente una sola vez y cancelado por la recepción',async()=>{
    const t=await task();const old=new Date(Date.now()-3600000);await prisma.task.update({where:{id:t.id},data:{workAssignedAt:old}});
    const results=await Promise.all([escalateUnreceivedWork(),escalateUnreceivedWork()]);expect(results.reduce((n,r)=>n+r.escalated,0)).toBe(1);
    await mutate(a,t.id,'task','RECIBIR');expect((await escalateUnreceivedWork()).escalated).toBe(0);
    expect((await getCoordinationBoard(a)).rows.some(r=>r.id===t.id)).toBe(true);
  });
  it('recibir un trabajo HK no lo comienza; reasignar obliga una nueva recepción',async()=>{
    const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Reponer toallas',description:'Atención sintética',departmentId:hkArea,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',location:'Zona sintética',priority:'MEDIA',effortMinutes:10,assignedToId:maid.id});
    await prisma.housekeepingRequest.update({where:{id:r.id},data:{workAssignedAt:new Date(Date.now()-3600000)}});
    // El plazo comienza cuando el trabajo está disponible. Cerca de medianoche
    // «asignado hace una hora» no implica treinta minutos del nuevo día.
    const escalationAt=new Date(Math.max(Date.now(),hotelWallDateTime(r.workDate!,0,0).getTime()+1800001));
    expect((await escalateHousekeepingRequests(escalationAt)).escalated).toBe(1);expect((await escalateHousekeepingRequests(escalationAt)).escalated).toBe(0);
    const received=await changeHkWork(maid,{id:r.id,version:r.version,action:'RECIBIR'});expect(received.status).toBe('RECIBIDO');expect(received.startedAt).toBeNull();
    const started=await changeHkWork(maid,{id:r.id,version:received.version,action:'COMENZAR'});expect(started.acknowledgedAt).toEqual(received.acknowledgedAt);expect(started.startedAt).not.toBeNull();
  });
  it('distingue entregar, recibir y aceptar continuidad sin cerrar el trabajo',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});await prisma.user.update({where:{id:supervisor.id},data:{departmentId:hkArea}});
    const h=await saveHkHandover(admin,{requestKey:randomUUID(),departmentId:hkArea,workDate:hotelDateKey(new Date()),note:'Revisar pendientes y custodias'});
    await expect(acceptHkHandover(supervisor,h.id)).rejects.toThrow();await receiveHkHandover(supervisor,h.id);
    expect((await prisma.housekeepingHandover.findUniqueOrThrow({where:{id:h.id}})).acceptedAt).toBeNull();await acceptHkHandover(supervisor,h.id);await acceptHkHandover(supervisor,h.id);
    expect(await prisma.auditLog.count({where:{entityId:h.id,summary:{contains:'ACEPTAR_CONTINUIDAD'}}})).toBe(1);
  });
  it('Mantenimiento recibe una única incidencia con gravedad, tarea y continuidad atómicas',async()=>{
    const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Revisar zona',description:'Solicitud sintética',departmentId:hkArea,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',location:'Zona sintética',priority:'ALTA',effortMinutes:10,assignedToId:maid.id});
    const blocked=await changeHkWork(maid,{id:r.id,version:r.version,action:'IMPEDIMENTO',note:'Fuga de agua'});
    await expect(changeHkWork(admin,{id:r.id,version:blocked.version,action:'MANTENIMIENTO',note:'Revisar fuga'})).rejects.toThrow('gravedad');
    const updated=await changeHkWork(admin,{id:r.id,version:blocked.version,action:'MANTENIMIENTO',note:'Revisar fuga',severity:'ALTA'});
    expect(await prisma.task.count({where:{entryId:updated.maintenanceEntryId}})).toBe(1);expect(await prisma.followUp.count({where:{entryId:updated.maintenanceEntryId}})).toBe(1);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:updated.maintenanceEntryId!}})).severity).toBe('ALTA');
    await expect(changeHkWork(admin,{id:r.id,version:blocked.version,action:'MANTENIMIENTO',note:'Reintento',severity:'ALTA'})).rejects.toThrow();expect(await prisma.operationalEntry.count()).toBe(1);
  });
  it('una tarea de otro responsable o de un origen cerrado sigue visible en mis pendientes',async()=>{
    const e=await entry();await prisma.operationalEntry.update({where:{id:e.id},data:{status:'CERRADO'}});
    const t=await createTask(admin,{title:'Continuidad aún abierta',entryId:e.id,assigneeId:b.id,priority:'MEDIA',tags:[],checklist:[]});
    expect((await getCoordinationBoard(b,{mine:true})).rows.some(r=>r.id===t.id)).toBe(true);
  });
  it('la programación futura no genera escalamiento prematuro',async()=>{
    const t=await task();await prisma.task.update({where:{id:t.id},data:{workAssignedAt:new Date(Date.now()-3600000),startsAt:new Date(Date.now()+3600000)}});
    expect((await escalateUnreceivedWork()).escalated).toBe(0);await expect(mutate(a,t.id,'task','RECIBIR')).rejects.toThrow('programación');
  });

  it('quitar responsable elimina el plazo y no escala filas históricas sin dueño',async()=>{
    const t=await task();const e=await entry();
    await assignTask(admin,{id:t.id,assigneeId:null,reason:'Pendiente de nueva cobertura'});await updateEntry(admin,{id:e.id,ownerId:null});
    expect((await prisma.task.findUniqueOrThrow({where:{id:t.id}})).workAssignedAt).toBeNull();expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).workAssignedAt).toBeNull();
    const old=new Date(Date.now()-3600000);await prisma.task.update({where:{id:t.id},data:{workAssignedAt:old}});await prisma.operationalEntry.update({where:{id:e.id},data:{workAssignedAt:old}});
    expect((await escalateUnreceivedWork()).escalated).toBe(0);expect(await prisma.notification.count({where:{title:{contains:'sin confirmar recepción'}}})).toBe(0);
  });
  it('iniciar una novedad desde su fuente confirma recepción sólo para su responsable',async()=>{
    const e=await entry();await prisma.operationalEntry.update({where:{id:e.id},data:{workAssignedAt:new Date(Date.now()-3600000)}});
    await changeEntryStatus(a,{id:e.id,status:'EN_CURSO'});const started=await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}});expect(started.workAcknowledgedAt).toEqual(started.workStartedAt);expect(started.workAcknowledgedById).toBe(a.id);expect((await escalateUnreceivedWork()).escalated).toBe(0);
    const other=await entry();await changeEntryStatus(b,{id:other.id,status:'EN_CURSO'});expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:other.id}})).workAcknowledgedAt).toBeNull();
  });
  it('organizar un aviso antiguo marca la nueva asignación y permite escalamiento',async()=>{
    const old=await prisma.housekeepingRequest.create({data:{requestKey:randomUUID(),title:'Aviso antiguo',description:'Reponer',location:'Zona sintética',departmentId:hkArea,createdById:admin.id}});
    await organizeLegacyHkWork(admin,{id:old.id,version:old.version,departmentId:hkArea,workDate:hotelDateKey(new Date()),workKind:'REPOSICION',effortMinutes:10,requiresInspection:false,assignedToId:maid.id,note:'Continuar trabajo'});
    const organized=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:old.id}});expect(organized.workAssignedAt).not.toBeNull();expect((await escalateHousekeepingRequests(new Date(organized.workAssignedAt!.getTime()+1800001))).escalated).toBe(1);
  });
  it('el plazo HK empieza en su día disponible y coincide entre pantalla y cron',async()=>{
    const workDate='2030-10-02';const start=hotelWallDateTime(workDate,0,0);
    const r=await createHkWork(admin,{requestKey:randomUUID(),title:'Programado',description:'Futuro',departmentId:hkArea,workDate,workKind:'REPOSICION',location:'Zona sintética',priority:'MEDIA',effortMinutes:10,assignedToId:maid.id});
    await prisma.housekeepingRequest.update({where:{id:r.id},data:{workAssignedAt:new Date(start.getTime()-86400000)}});
    const row=(await getCoordinationBoard(maid)).rows.find(v=>v.id===r.id)!;expect(row.availableAt).toEqual(start);expect(receiptDueAt(row.assignedAt,row.availableAt)).toEqual(new Date(start.getTime()+1800000));
    expect(coordinationMetrics([row],new Date(start.getTime()-1)).receiptLate).toBe(0);expect((await escalateHousekeepingRequests(new Date(start.getTime()+1799999))).escalated).toBe(0);expect((await escalateHousekeepingRequests(new Date(start.getTime()+1800000))).escalated).toBe(1);
  });
  it('escala al coordinador de Mantenimiento que puede actuar y no al creador HK sin acceso',async()=>{
    const maintenance=(await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}})).id;
    await prisma.user.updateMany({where:{id:{in:[a.id,b.id]}},data:{departmentId:maintenance}});
    const e=await prisma.operationalEntry.create({data:{type:'INCIDENCIA',title:'Derivación sintética',description:'Revisar',createdById:maid.id,ownerId:a.id,departmentId:maintenance,workAssignedAt:new Date(Date.now()-3600000)}});
    expect((await escalateUnreceivedWork()).escalated).toBe(1);
    const notifications=await prisma.notification.findMany({where:{entityId:e.id,title:{contains:'sin confirmar recepción'}}});expect(notifications.map(n=>n.userId)).toContain(b.id);expect(notifications.map(n=>n.userId)).not.toContain(maid.id);
  });
  it('escalar una tarea reservada no revela su existencia a coordinadores sin acceso',async()=>{
    const f=await prisma.followUp.create({data:{action:'Reservado',createdById:admin.id,ownerId:a.id,visibility:'PRIVADO'}});
    const t=await prisma.task.create({data:{title:'Reservada',createdById:admin.id,assigneeId:a.id,departmentId:area,followUpId:f.id,workAssignedAt:new Date(Date.now()-3600000)}});
    await escalateUnreceivedWork();const notifications=await prisma.notification.findMany({where:{entityId:t.id,title:{contains:'sin confirmar recepción'}}});expect(notifications.map(n=>n.userId)).toEqual([admin.id]);
  });
  it('Fronti lee Coordinación con los mismos permisos y filtros de Recepción y HK',async()=>{
    const receptionist=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});await task();
    const page=resolveFrontiPageContext({pathname:'/coordinacion',search:`?area=${area}`});expect(page.moduleKey).toBe('coordinacion');expect(page.recommendedTools).toContain('consultar_contexto_pantalla');
    const reception=await executeFrontiPageContextTool(receptionist,page) as {snapshot:{total:number}};expect(reception.snapshot.total).toBe(1);
    const hk=await executeFrontiPageContextTool(maid,page) as {snapshot:{total:number}};expect(hk.snapshot.total).toBe(0);
  });

  it('equipo conserva usuarios existentes y no expone horario sin permiso',async()=>{
    const team=await getCoordinationTeam(a,area);expect(team.some(u=>u.id===b.id)).toBe(true);
    const without={...a,permissions:a.permissions.filter(p=>!p.startsWith('schedule.'))};expect((await getCoordinationTeam(without,area)).every(u=>!u.scheduleVisible&&!u.scheduled)).toBe(true);
    expect(await getCoordinationTeam(maid,area)).toEqual([]);
  });
});
