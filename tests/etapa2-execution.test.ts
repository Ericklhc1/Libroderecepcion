import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { prepareExecution, executePlan, cancelExecution, readExecution } from '@/server/ai/execution/service';
import * as taskServices from '@/server/services/tasks';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { saveAutomation, simulateAutomation, runOperationalAutomations, revokeAutomation } from '@/server/services/operational-automation';
import type { FrontiStep } from '@/domain/fronti-execution';
import { escalateUnreceivedWork } from '@/server/services/coordination';
import { invokeNativeAction } from '@/server/ai/execution/catalog';
import { revisionForStep } from '@/server/ai/execution/revision';
import { hotelDateKey } from '@/domain/time';
let actor:CurrentUser;
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:async()=> {
  const row=await prisma.user.findUnique({where:{id:actor.id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  if(!row?.active)return null;
  return {...actor,permissions:row.role.permissions.map(p=>p.permission.key),roleId:row.roleId};
}}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
const taskStep=(title='Tarea sintética')=>({action:'createTaskAction',fields:{title,description:'Verificar resultado',priority:'MEDIA',targetType:'PROPIO'}});
const plan=(steps: FrontiStep[]=[taskStep()])=>prepareExecution({requestKey:randomUUID(),instruction:'Registrar trabajo sintético explícitamente',steps});
describe('Etapa 2: PostgreSQL y servicios nativos',()=>{
  let admin:CurrentUser,other:CurrentUser,area:string;
  beforeAll(seedCatalog);
  beforeEach(async()=>{await resetOperationalData();admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});other=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});actor=admin;area=(await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}})).id;await prisma.user.updateMany({where:{id:{in:[admin.id,other.id]}},data:{departmentId:area}});process.env.AROH_AUTOMATION_EXECUTION_ENABLED='false';});
  it('ejecuta directamente dos pasos y los reintentos concurrentes no duplican efectos',async()=>{
    const p=await plan([taskStep('Trabajo uno'),taskStep('Trabajo dos')]);
    await Promise.all([executePlan(p.id,true),executePlan(p.id,true)]);
    const result=await executePlan(p.id,true);
    expect(result.steps.map(s=>s.status)).toEqual(['SUCCEEDED','SUCCEEDED']);expect(await prisma.task.count()).toBe(2);
    expect(await prisma.auditLog.count({where:{entity:'FrontiExecution',entityId:p.id}})).toBe(2);
  });
  it('deduplica mensajes simultáneos con distintas claves y rechaza cambios con misma clave',async()=>{
    const input={requestKey:randomUUID(),instruction:'Crear tarea explícita',steps:[taskStep()]};
    const [a,b]=await Promise.all([prepareExecution(input),prepareExecution({...input,requestKey:randomUUID()})]);expect(a.id).toBe(b.id);
    await expect(prepareExecution({...input,instruction:'Una instrucción diferente'})).rejects.toThrow('reintento');
  });
  it('conserva el primer efecto y detiene los siguientes ante fallo; cancelar no deshace',async()=>{
    const p=await plan([taskStep('Primera válida'),{action:'createTaskAction',fields:{title:'x'}},taskStep('Nunca ejecutar')]);
    const result=await executePlan(p.id,true);expect(result.steps.map(s=>s.status)).toEqual(['SUCCEEDED','INTERVENTION','PENDING']);expect(await prisma.task.count()).toBe(1);
    await cancelExecution(p.id);await expect(executePlan(p.id,true)).rejects.toThrow('cancelada');expect(await prisma.task.count()).toBe(1);
  });
  it('rechaza sesión desactivada y autorización caducada',async()=>{
    const p=await plan();await prisma.user.update({where:{id:actor.id},data:{active:false}});await expect(executePlan(p.id,true)).rejects.toThrow();await prisma.user.update({where:{id:actor.id},data:{active:true}});
    await prisma.frontiExecution.update({where:{id:p.id},data:{expiresAt:new Date(0)}});await expect(executePlan(p.id,true)).rejects.toThrow('caducó');expect(await prisma.task.count()).toBe(0);
  });
  it('revalida permisos tras preparar y no permite leer planes ajenos',async()=>{
    const p=await plan();const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.HK_ATTENDANT}});await prisma.user.update({where:{id:admin.id},data:{roleId:role.id}});
    const result=await executePlan(p.id,true);expect(result.steps[0]!.status).toBe('INTERVENTION');expect(await prisma.task.count()).toBe(0);
    actor={...other,isSystemAdmin:true};await expect(readExecution(p.id)).rejects.toThrow();
  });
  it('un cambio posterior a la propuesta exige una nueva autorización',async()=>{
    const t=await createTask(admin,{title:'Estado protegido',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[]});
    const p=await plan([{action:'changeTaskStatusAction',fields:{id:t.id,status:'EN_CURSO'}}]);await prisma.task.update({where:{id:t.id},data:{title:'Modificado'}});
    expect((await executePlan(p.id,true)).steps[0]!.status).toBe('CHANGED');expect((await prisma.task.findUniqueOrThrow({where:{id:t.id}})).status).toBe('PENDIENTE');
  });
  it('el ejecutor no puede aportar la validación independiente',async()=>{
    const t=await createTask(admin,{title:'Inspección independiente',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[],requiresIndependentValidation:true,evidenceRequired:'Foto declarada'});
    await changeTaskStatus(admin,{id:t.id,status:'EN_CURSO'});await expect(changeTaskStatus(admin,{id:t.id,status:'COMPLETADA'})).rejects.toThrow('independientes');
    await changeTaskStatus(admin,{id:t.id,status:'REALIZADA',evidenceProvided:'Resultado declarado por ejecutor'});await expect(changeTaskStatus(admin,{id:t.id,status:'VALIDADA'})).rejects.toThrow('otra persona');await changeTaskStatus(other,{id:t.id,status:'VALIDADA'});
  });
  it('registra Caja autorizada una vez y conserva el resultado del procedimiento nativo',async()=>{
    const p=await plan([{action:'createManualCashMovementAction',fields:{direction:'ENTRADA',currency:'CLP',amount:'1500',reference:'Ingreso sintético declarado',notes:'Dinero contado y comunicado por el usuario'}}]);
    const result=await executePlan(p.id,true);expect(result.steps[0]!.status).toBe('SUCCEEDED');
    expect(await prisma.cashMovement.count({where:{reference:'Ingreso sintético declarado'}})).toBe(1);
    await executePlan(p.id,true);expect(await prisma.cashMovement.count({where:{reference:'Ingreso sintético declarado'}})).toBe(1);
  });
  it('registra entrega y devolución de llave con la identidad del declarante',async()=>{
    const room=await prisma.room.findUniqueOrThrow({where:{number:'401'}});const code='E2-'+randomUUID().slice(0,8).toUpperCase();
    const p=await plan([{action:'createPhysicalKeyAction',fields:{code,roomId:room.id,type:'COPIA',notes:'Llave sintética'}}]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('SUCCEEDED');
    const key=await prisma.roomKey.findUniqueOrThrow({where:{code}});
    const delivery=await plan([{action:'assignPhysicalKeyAction',fields:{keyId:key.id,roomId:room.id,note:'Declaro que entregué esta llave'}}]);expect((await executePlan(delivery.id,true)).steps[0]!.status).toBe('SUCCEEDED');
    expect((await prisma.roomKey.findUniqueOrThrow({where:{id:key.id}})).assignedById).toBe(admin.id);
    const returned=await plan([{action:'returnPhysicalKeyAction',fields:{keyId:key.id,note:'Declaro que recibí físicamente la devolución'}}]);expect((await executePlan(returned.id,true)).steps[0]!.status).toBe('SUCCEEDED');expect((await prisma.roomKey.findUniqueOrThrow({where:{id:key.id}})).status).toBe('DISPONIBLE');
  });
  it('inicia turno mediante el control nativo sin cerrarlo ni aportar segunda aprobación',async()=>{
    const p=await plan([{action:'openShiftAction',fields:{}}]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('SUCCEEDED');expect(await prisma.shift.count()).toBe(1);
    const shift=await prisma.shift.findFirstOrThrow();const close=await plan([{action:'closeShiftAction',fields:{shiftId:shift.id}}]);expect((await executePlan(close.id,true)).steps[0]!.status).toBe('INTERVENTION');expect((await prisma.shift.findUniqueOrThrow({where:{id:shift.id}})).status).not.toBe('CERRADO');
  });
  it('permite configurar un área con permiso real de administración',async()=>{
    const key='E2_'+randomUUID().slice(0,8).toUpperCase();const p=await plan([{action:'saveDepartmentAction',fields:{key,name:'Área sintética',order:'99',active:'true'}}]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('SUCCEEDED');expect((await prisma.department.findUniqueOrThrow({where:{key}})).active).toBe(true);await prisma.department.delete({where:{key}});
  });
  it('conserva datos de usuario y bloquea cambios entre autorización y escritura nativa',async()=>{
    const current=await prisma.user.findUniqueOrThrow({where:{id:other.id}});
    const step={action:'updateUserAction',fields:{id:other.id,name:'Nombre actualizado',email:current.email??'',roleId:current.roleId,departmentId:area,phone:current.phone??'',emailNotificationsEnabled:String(current.emailNotificationsEnabled),hiddenFromSelectors:String(current.hiddenFromSelectors),active:'true'}};
    const revision=await revisionForStep(step);await prisma.user.update({where:{id:other.id},data:{phone:'123456'}});
    expect((await invokeNativeAction(step,revision)).ok).toBe(false);
    const p=await plan([{...step,fields:{...step.fields,phone:'123456'}}]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('SUCCEEDED');
    const after=await prisma.user.findUniqueOrThrow({where:{id:other.id}});expect(after.name).toBe('Nombre actualizado');expect(after.active).toBe(true);expect(after.phone).toBe('123456');expect(after.email).toBe(current.email);
  });
  it('sustituye matriz completa explícita y rechaza revisión obsoleta dentro de la transacción',async()=>{
    const role=await prisma.role.create({data:{key:'E2_'+randomUUID(),name:'Rol sintético'}});
    try {
      const step={action:'updateRolePermissionsAction',fields:{roleId:role.id,permissions:['task.create'],approvalRequired:[],permissionsBefore:[],approvalRequiredBefore:[],replacementAcknowledged:'REEMPLAZAR_MATRIZ_COMPLETA'}};
      const p=await plan([step]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('SUCCEEDED');
      const revision=await revisionForStep(step);const permission=await prisma.permission.findUniqueOrThrow({where:{key:'task.assign'}});await prisma.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});
      expect((await invokeNativeAction(step,revision)).ok).toBe(false);expect(await prisma.rolePermission.count({where:{roleId:role.id}})).toBe(2);
    } finally {await prisma.role.delete({where:{id:role.id}});}
  });
  it('Housekeeping usa el registro original y Equipo conserva usuario y horas semanales',async()=>{
    const hk=await plan([{action:'createHousekeepingAction',fields:{requestKey:randomUUID(),title:'Solicitud sintética',description:'Revisar filtro informado por Recepción',departmentId:area}}]);
    expect((await executePlan(hk.id,true)).steps[0]!.status).toBe('SUCCEEDED');await executePlan(hk.id,true);expect(await prisma.housekeepingRequest.count()).toBe(1);
    const day=hotelDateKey(new Date());const schedule=await plan([{action:'saveScheduleCollaboratorAction',fields:{userId:other.id,departmentIds:[area],weeklyHours:'40',functionName:'Supervisor'}},{action:'createSchedulePlanAction',fields:{departmentId:area,startDate:day,endDate:day}}]);
    expect((await executePlan(schedule.id,true)).steps.map(s=>s.status)).toEqual(['SUCCEEDED','SUCCEEDED']);expect((await prisma.scheduleCollaborator.findUniqueOrThrow({where:{userId:other.id}})).weeklyMinutes).toBe(2400);expect(await prisma.schedulePlan.count()).toBe(1);
  });
  it('reglas configuradas sustituyen el plazo original sin avisos duplicados y vuelven al pausar',async()=>{
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';const now=new Date();
    const task=await createTask(admin,{title:'Recepción con plazo configurable',assigneeId:other.id,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    await prisma.task.update({where:{id:task.id},data:{workAssignedAt:new Date(now.getTime()-35*60000)}});
    const input={name:'Recepción a 45 minutos',departmentId:area,kind:'ESCALATION',configuration:{trigger:'UNRECEIVED',kind:'task',priority:'MEDIA',receiptMinutes:45,recipientId:other.id},expiresAt:new Date(Date.now()+86400000),enabled:true};
    const policy=await saveAutomation(admin,input);expect((await simulateAutomation(admin,policy.id,now)).effects).toHaveLength(0);expect((await escalateUnreceivedWork(now)).escalated).toBe(0);
    await expect(saveAutomation(admin,{...input,name:'Duplicada'})).rejects.toThrow('Ya existe');
    await prisma.task.update({where:{id:task.id},data:{workAssignedAt:new Date(now.getTime()-60*60000)}});
    const result=await runOperationalAutomations(now);expect(result.failed).toBe(0);expect(result.attempted).toBe(1);expect((await escalateUnreceivedWork(now)).escalated).toBe(0);
    await runOperationalAutomations(now);expect(await prisma.notification.count({where:{entity:'OperationalAutomation'}})).toBe(1);
    const next=await createTask(admin,{title:'Plazo original tras pausar',assigneeId:other.id,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});await prisma.task.update({where:{id:next.id},data:{workAssignedAt:new Date(now.getTime()-35*60000)}});
    await saveAutomation(admin,{...input,id:policy.id,version:1,enabled:false});expect((await escalateUnreceivedWork(now)).escalated).toBe(1);
  });
  it('la simulación limitada no presenta candidatos parciales como operación completa',async()=>{
    for(const title of ['Pendiente uno','Pendiente dos'])await createTask(admin,{title,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    const p=await saveAutomation(admin,{name:'Vista previa de un candidato',departmentId:area,kind:'ESCALATION',configuration:{trigger:'UNASSIGNED',kind:'task',receiptMinutes:30,recipientId:other.id,maxItems:1},expiresAt:new Date(Date.now()+86400000)});
    const preview=await simulateAutomation(admin,p.id);expect(preview.effects).toHaveLength(1);expect(preview.complete).toBe(false);expect(await prisma.notification.count({where:{entity:'OperationalAutomation'}})).toBe(0);
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';const current=await prisma.operationalAutomation.findUniqueOrThrow({where:{id:p.id}});await saveAutomation(admin,{id:p.id,version:current.version,name:current.name,departmentId:area,kind:current.kind,configuration:current.configuration,expiresAt:current.expiresAt,enabled:true});
    await runOperationalAutomations();await runOperationalAutomations();await runOperationalAutomations();expect(await prisma.notification.count({where:{entity:'OperationalAutomation'}})).toBe(2);
    const task=await prisma.task.findFirstOrThrow();await prisma.task.update({where:{id:task.id},data:{title:'Cambio de título sin alterar condición'}});await runOperationalAutomations();expect(await prisma.notification.count({where:{entity:'OperationalAutomation'}})).toBe(2);
  });
  it('preserva tiempo del cron y pausa con historial si se revoca al autorizador',async()=>{
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';const policy=await saveAutomation(admin,{name:'Regla acotada',departmentId:area,kind:'ESCALATION',configuration:{trigger:'UNASSIGNED',receiptMinutes:30,recipientId:other.id},expiresAt:new Date(Date.now()+86400000),enabled:true});
    expect((await runOperationalAutomations(new Date(),Date.now())).attempted).toBe(0);
    await prisma.user.update({where:{id:admin.id},data:{active:false}});expect((await runOperationalAutomations()).failed).toBe(1);expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:policy.id}})).enabled).toBe(false);expect(await prisma.operationalAutomationRun.count({where:{policyId:policy.id,status:'INTERVENTION'}})).toBe(1);
  });
  it('interrumpe recurrencias restantes si el autorizador se desactiva durante el primer efecto',async()=>{
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';const now=new Date();
    const policy=await saveAutomation(admin,{name:'Revocación durante barrido',departmentId:area,kind:'PROCEDURE',configuration:{title:'Revisar filtro sintético',description:'Declaración pendiente',ownerId:other.id,priority:'MEDIA',nextAction:'Informar evidencia',evidenceRequired:'Resultado comunicado',checklist:['Inspeccionar'],startDate:hotelDateKey(new Date(now.getTime()-3*86400000)),localTime:'01:00',weekdays:[0,1,2,3,4,5,6],deadlineMinutes:60,catchUpDays:2,maxOccurrences:3},expiresAt:new Date(now.getTime()+86400000),enabled:true});
    const original=taskServices.createTask;let effects=0;const spy=vi.spyOn(taskServices,'createTask').mockImplementation(async(...args)=>{const task=await original(...args);if(++effects===1)await prisma.user.update({where:{id:admin.id},data:{active:false}});return task;});
    try {const result=await runOperationalAutomations(now);expect(result.attempted).toBe(1);expect(result.failed).toBe(1);expect(await prisma.task.count()).toBe(1);expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:policy.id}})).enabled).toBe(false);} finally {spy.mockRestore();}
  });
  it('simula sin efectos; pausa, concurrencia, versiones y revocación conservan historial',async()=>{
    const now=new Date();const config={title:'Revisión preventiva',description:'Procedimiento sintético',ownerId:other.id,priority:'MEDIA',nextAction:'Registrar evidencia',evidenceRequired:'Observación',checklist:['Revisar'],startDate:hotelDateKey(now),localTime:'01:00',weekdays:[0,1,2,3,4,5,6],deadlineMinutes:60};
    const input={name:config.title,departmentId:area,kind:'PROCEDURE',configuration:config,expiresAt:new Date(Date.now()+86400000),enabled:false};const p=await saveAutomation(admin,input);
    const future=new Date(now);future.setUTCHours(23,0,0,0);
    expect((await simulateAutomation(admin,p.id,future)).effects.length).toBeGreaterThan(0);expect(await prisma.task.count()).toBe(0);
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';await runOperationalAutomations(future);expect(await prisma.task.count()).toBe(0);
    await saveAutomation(admin,{...input,id:p.id,version:1,enabled:true});await Promise.all([runOperationalAutomations(future),runOperationalAutomations(future)]);expect(await prisma.task.count()).toBe(1);
    expect(await prisma.operationalAutomationRun.count({where:{status:'SUCCEEDED'}})).toBe(1);await revokeAutomation(admin,p.id);await runOperationalAutomations(future);expect(await prisma.task.count()).toBe(1);
  });
});
