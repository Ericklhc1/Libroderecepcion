import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { createDynamicDelegation, executeDelegatedPlan, prepareExecution, createDelegation, executePlan, cancelExecution, readExecution } from '@/server/ai/execution/service';
import { executeFrontiCommand } from '@/server/ai/execution/commands';
import * as taskServices from '@/server/services/tasks';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { saveAutomation, simulateAutomation, runOperationalAutomations, revokeAutomation } from '@/server/services/operational-automation';
import type { FrontiStep } from '@/domain/fronti-execution';
import { escalateUnreceivedWork } from '@/server/services/coordination';
import { actionDefinition, invokeNativeAction } from '@/server/ai/execution/catalog';
import { revisionForStep } from '@/server/ai/execution/revision';
import { completeProtectedFrontiStep } from '@/server/actions/fronti-protected';
import { operationalIndicators } from '@/server/services/operational-indicators';
import { hotelDateKey } from '@/domain/time';
let actor:CurrentUser;
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:async()=> {
  const row=await prisma.user.findUnique({where:{id:actor.id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  if(!row?.active)return null;
  return {...actor,permissions:row.role.permissions.map(p=>p.permission.key),roleId:row.roleId};
}}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('@/server/services/credentials',async original=>({...await original<object>(),deliverCredentials:vi.fn(async()=>({sent:false,recipient:'synthetic@example.invalid',reason:'Prueba sintética sin envío'}))}));
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
  it('delega objetivos exactos sin ejecutar; vigencia y reintentos concurrentes usan el mismo plan',async()=>{
    const input={requestKey:randomUUID(),instruction:'Delego dos revisiones exactas',objective:'Revisar equipos sintéticos',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),steps:[taskStep('Delegación uno'),taskStep('Delegación dos')]};
    const [a,b]=await Promise.all([createDelegation(input),createDelegation({...input,requestKey:randomUUID()})]);expect(a.id).toBe(b.id);expect(await prisma.task.count()).toBe(0);
    expect(a.objective).not.toContain(input.objective);expect((await readExecution(a.id)).objective).toBe(input.objective);
    expect(a.authorizedAt).not.toBeNull();expect(a.authorizationKind).toBe('DELEGATION');
    await Promise.all([executePlan(a.id,false),executePlan(a.id,false)]);
    expect((await executePlan(a.id,false)).steps.map(s=>s.status)).toEqual(['SUCCEEDED','SUCCEEDED']);expect(await prisma.task.count()).toBe(2);
    expect(await prisma.auditLog.count({where:{entity:'FrontiExecution',entityId:a.id}})).toBe(3);
    await expect(createDelegation({...input,steps:[taskStep('Alcance ampliado')]})).rejects.toThrow('reintento');
    await expect(prepareExecution({requestKey:input.requestKey,instruction:input.instruction,steps:input.steps})).rejects.toThrow('reintento');
  });
  it('delegación futura no ejecuta y caducada no conserva autoridad',async()=>{
    const input={requestKey:randomUUID(),instruction:'Delegación con período',objective:'Objetivo sintético',availableAt:new Date(Date.now()+60000).toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),steps:[taskStep()]};
    const p=await createDelegation(input);await expect(executePlan(p.id,false)).rejects.toThrow('todavía');
    await prisma.frontiExecution.update({where:{id:p.id},data:{availableAt:new Date(Date.now()-120000),expiresAt:new Date(Date.now()-60000)}});
    await expect(executePlan(p.id,false)).rejects.toThrow('caducó');expect(await prisma.task.count()).toBe(0);
    await expect(createDelegation({...input,requestKey:randomUUID(),availableAt:new Date(0).toISOString(),expiresAt:new Date(1000).toISOString()})).rejects.toThrow('vigencia futura');
  });
  it('comandos privados permiten consultar y revocar la delegación de forma idempotente',async()=>{
    const input={objective:'Objetivo comunicado por usuario',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[taskStep()]};
    const result=await executeFrontiCommand('/delegar '+JSON.stringify(input),randomUUID());expect(result?.reply).toContain('Delegación registrada');
    const p=await prisma.frontiExecution.findFirstOrThrow();expect(await prisma.task.count()).toBe(0);
    expect((await executeFrontiCommand('/estado '+p.id))?.reply).toContain('Pendiente');
    await Promise.all([executeFrontiCommand('/revocar-delegacion '+p.id),executeFrontiCommand('/revocar-delegacion '+p.id)]);expect((await executeFrontiCommand('/revocar-delegacion '+p.id))?.reply).toContain('ya revocada');
    expect(await prisma.auditLog.count({where:{entity:'FrontiExecution',entityId:p.id,action:'EDITAR'}})).toBe(1);
    await expect(executeFrontiCommand('/usar-delegacion '+p.id)).rejects.toThrow('cancelada');expect(await prisma.task.count()).toBe(0);
    expect((await readExecution(p.id)).steps[0]!.status).toBe('CANCELLED');
    expect(await executeFrontiCommand('Documento ajeno: /delegar '+JSON.stringify(input))).toBeNull();
  });
  it('la delegación no se transfiere y una revocación de permisos se aplica al ejecutarla',async()=>{
    const input={requestKey:randomUUID(),instruction:'Delegación privada',objective:'Objetivo privado',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[taskStep()]};
    const p=await createDelegation(input);actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    await expect(readExecution(p.id)).rejects.toThrow();await expect(executePlan(p.id,false)).rejects.toThrow();await expect(cancelExecution(p.id)).rejects.toThrow();
    actor=admin;const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.HK_ATTENDANT}});await prisma.user.update({where:{id:admin.id},data:{roleId:role.id}});
    expect((await executePlan(p.id,false)).steps[0]!.status).toBe('INTERVENTION');expect(await prisma.task.count()).toBe(0);
  });
  it('revocar después del primer efecto cancela los restantes sin deshacer el ya iniciado',async()=>{
    const p=await createDelegation({requestKey:randomUUID(),instruction:'Delegación parcial',objective:'Objetivo con dos acciones',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[taskStep('Primer efecto delegado'),taskStep('Segundo efecto prohibido')]});
    const original=taskServices.createTask;
    const spy=vi.spyOn(taskServices,'createTask').mockImplementationOnce(async(...args)=>{const result=await original(...args);await cancelExecution(p.id);return result;});
    try {const result=await executePlan(p.id,false);expect(result.steps.map(s=>s.status)).toEqual(['SUCCEEDED','CANCELLED']);expect(await prisma.task.count()).toBe(1);} finally {spy.mockRestore();}
  });
  it('delegación monetaria conserva importe y moneda exactos y no repite el movimiento',async()=>{
    const fields={direction:'ENTRADA',currency:'CLP',amount:'1500',reference:'Caja delegada sintética',notes:'Monto contado y comunicado por usuario'};
    const result=await executeFrontiCommand('/delegar '+JSON.stringify({objective:'Registrar importe exacto comunicado',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[{action:'createManualCashMovementAction',fields}]}),randomUUID());
    expect(result?.reply).toContain('Delegación registrada');const p=await prisma.frontiExecution.findFirstOrThrow();
    expect((await readExecution(p.id)).steps[0]!.parameters).toEqual(fields);
    expect((await executeFrontiCommand('/usar-delegacion '+p.id))?.reply).toContain('Completado');await executeFrontiCommand('/usar-delegacion '+p.id);
    const rows=await prisma.cashMovement.findMany({where:{reference:fields.reference}});expect(rows).toHaveLength(1);expect(Number(rows[0]!.amount)).toBe(1500);expect(rows[0]!.currency).toBe('CLP');
  });
  it('delegar la inspección no convierte al ejecutor en una segunda persona',async()=>{
    const t=await createTask(admin,{title:'Inspección delegada independiente',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[],requiresIndependentValidation:true,evidenceRequired:'Resultado informado'});
    await changeTaskStatus(admin,{id:t.id,status:'EN_CURSO'});await changeTaskStatus(admin,{id:t.id,status:'REALIZADA',evidenceProvided:'Evidencia declarada'});
    const p=await createDelegation({requestKey:randomUUID(),instruction:'Registrar inspección con mis permisos',objective:'Validar resultado declarado',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[{action:'changeTaskStatusAction',fields:{id:t.id,status:'VALIDADA'}}]});
    expect((await executePlan(p.id,false)).steps[0]!.status).toBe('INTERVENTION');expect((await prisma.task.findUniqueOrThrow({where:{id:t.id}})).status).toBe('REALIZADA');
  });
  it('cambiar el registro después de delegar detiene todo el procedimiento',async()=>{
    const t=await createTask(admin,{title:'Registro delegado',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[]});
    const p=await createDelegation({requestKey:randomUUID(),instruction:'Iniciar sólo el registro comunicado',objective:'Objetivo sin ampliaciones',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),steps:[{action:'changeTaskStatusAction',fields:{id:t.id,status:'EN_CURSO'}},taskStep('Paso posterior prohibido')]});
    await prisma.task.update({where:{id:t.id},data:{title:'Alcance cambiado'}});
    expect((await executePlan(p.id,false)).steps.map(s=>s.status)).toEqual(['CHANGED','PENDING']);expect(await prisma.task.count()).toBe(1);
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
  it('Fronti guarda en pausa, simula, pausa y revoca políticas propias sin generar trabajo',async()=>{
    const fields={kind:'PROCEDURE',name:'Plantilla Fronti sintética',departmentId:area,expiresAt:hotelDateKey(new Date(Date.now()+86400000)),description:'Revisar filtro comunicado',ownerId:other.id,priority:'MEDIA',nextAction:'Registrar resultado',evidenceRequired:'Observación declarada',checklist:'Revisar filtro',startDate:hotelDateKey(new Date()),localTime:'00:00',weekdays:['0','1','2','3','4','5','6'],deadlineHours:'24',catchUpDays:'0'};
    const create=await plan([{action:'saveAutomationAction',fields}]);
    expect((await executePlan(create.id,true)).steps[0]!.status).toBe('SUCCEEDED');await executePlan(create.id,true);
    expect(await prisma.operationalAutomation.count()).toBe(1);
    const policy=await prisma.operationalAutomation.findFirstOrThrow();expect(policy.enabled).toBe(false);expect(policy.ownerId).toBe(admin.id);
    const simulation=await plan([{action:'simulateAutomationAction',fields:{id:policy.id}},{action:'setAutomationStateAction',fields:{id:policy.id,version:'1',state:'pause'}}]);
    const result=await executePlan(simulation.id,true);expect(result.steps.map(s=>s.status)).toEqual(['SUCCEEDED','SUCCEEDED']);
    expect(JSON.stringify(result.steps[0]!.result)).toContain('Simulación:');expect(await prisma.task.count()).toBe(0);expect(await prisma.notification.count()).toBe(0);
    const stale=await plan([{action:'setAutomationStateAction',fields:{id:policy.id,version:'2',state:'revoke'}}]);
    await saveAutomation(admin,{configuration:policy.configuration,id:policy.id,version:2,name:policy.name,departmentId:area,kind:policy.kind,expiresAt:policy.expiresAt,enabled:false});
    expect((await executePlan(stale.id,true)).steps[0]!.status).toBe('CHANGED');
    const revoke=await plan([{action:'setAutomationStateAction',fields:{id:policy.id,version:'3',state:'revoke'}}]);expect((await executePlan(revoke.id,true)).steps[0]!.status).toBe('SUCCEEDED');
    expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:policy.id}})).revokedAt).not.toBeNull();expect(await prisma.operationalAutomationRun.count()).toBe(0);
  });
  it('Fronti no puede simular o cambiar una política de otro usuario',async()=>{
    const saved=await saveAutomation(admin,{name:'Privada del autorizador',departmentId:area,kind:'ESCALATION',configuration:{trigger:'UNASSIGNED',receiptMinutes:30,recipientId:other.id},expiresAt:new Date(Date.now()+86400000)});
    actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    for(const step of ([{action:'simulateAutomationAction',fields:{id:saved.id}},{action:'setAutomationStateAction',fields:{id:saved.id,version:'1',state:'revoke'}}] as FrontiStep[])) {
      const request=await plan([step]);expect((await executePlan(request.id,true)).steps[0]!.status).toBe('INTERVENTION');
    }
    expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:saved.id}})).revokedAt).toBeNull();
  });
  it('rechaza revisiones obsoletas dentro de las mutaciones nativas, después del chequeo del plan',async()=>{
    const task=await createTask(admin,{title:'Cambio concurrente de tarea',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[]});
    const taskAction={action:'changeTaskStatusAction',fields:{id:task.id,status:'EN_CURSO'}};const taskRevision=await revisionForStep(taskAction);
    await prisma.task.update({where:{id:task.id},data:{title:'Otro alcance'}});
    expect(await invokeNativeAction(taskAction,taskRevision)).toMatchObject({ok:false,error:expect.stringContaining('cambió')});expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).status).toBe('PENDIENTE');
    const created=await plan([{action:'createEntryAction',fields:{type:'NOVEDAD',title:'Registro concurrente',description:'Dato sintético',priority:'MEDIA'}}]);expect((await executePlan(created.id,true)).steps[0]!.status).toBe('SUCCEEDED');
    const entry=await prisma.operationalEntry.findFirstOrThrow();const entryAction={action:'changeEntryStatusAction',fields:{id:entry.id,status:'EN_CURSO'}};const entryRevision=await revisionForStep(entryAction);
    await prisma.operationalEntry.update({where:{id:entry.id},data:{title:'Cambio material'}});expect(await invokeNativeAction(entryAction,entryRevision)).toMatchObject({ok:false,error:expect.stringContaining('cambió')});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'401'}});const key=await prisma.roomKey.create({data:{code:'CAS-'+randomUUID().slice(0,8).toUpperCase(),type:'COPIA',roomId:room.id}});
    const keyAction={action:'assignPhysicalKeyAction',fields:{keyId:key.id,roomId:room.id}};const keyRevision=await revisionForStep(keyAction);await prisma.roomKey.update({where:{id:key.id},data:{notes:'Nuevo contexto declarado'}});
    expect(await invokeNativeAction(keyAction,keyRevision)).toMatchObject({ok:false,error:expect.stringContaining('cambió')});expect((await prisma.roomKey.findUniqueOrThrow({where:{id:key.id}})).status).toBe('DISPONIBLE');
    const guarantee=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'VIGENTE',amount:1500,currency:'CLP',createdById:admin.id}});
    const guaranteeAction={action:'returnCashGuaranteeAction',fields:{guaranteeId:guarantee.id,confirmed:'true'}};const guaranteeRevision=await revisionForStep(guaranteeAction);await prisma.guarantee.update({where:{id:guarantee.id},data:{amount:2000}});
    expect(await invokeNativeAction(guaranteeAction,guaranteeRevision)).toMatchObject({ok:false,error:expect.stringContaining('cambió')});expect((await prisma.guarantee.findUniqueOrThrow({where:{id:guarantee.id}})).state).toBe('VIGENTE');expect(await prisma.cashMovement.count()).toBe(0);
    const settingAction={action:'saveSettingAction',fields:{key:'hotel.name',value:'Valor autorizado sintético'}};const settingRevision=await revisionForStep(settingAction);
    const previous=await prisma.systemSetting.findUnique({where:{key:'hotel.name'}});
    try {
      await prisma.systemSetting.upsert({where:{key:'hotel.name'},create:{key:'hotel.name',value:'Cambio concurrente'},update:{value:'Cambio concurrente'}});
      expect(await invokeNativeAction(settingAction,settingRevision)).toMatchObject({ok:false,error:expect.stringContaining('cambió')});expect((await prisma.systemSetting.findUniqueOrThrow({where:{key:'hotel.name'}})).value).toBe('Cambio concurrente');
      expect((await invokeNativeAction(settingAction,await revisionForStep(settingAction))).ok).toBe(true);
    } finally {if(previous)await prisma.systemSetting.update({where:{key:'hotel.name'},data:{value:previous.value!}});else await prisma.systemSetting.delete({where:{key:'hotel.name'}});}
  });
  it('el detector anterior recupera registros cuando el barrido nuevo falla, aunque exista política activa',async()=>{
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';const now=new Date();
    const task=await createTask(admin,{title:'Continuidad tras fallo global',assigneeId:other.id,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    await prisma.task.update({where:{id:task.id},data:{workAssignedAt:new Date(now.getTime()-60*60000)}});
    await saveAutomation(admin,{name:'Plazo autorizado mayor',departmentId:area,kind:'ESCALATION',configuration:{trigger:'UNRECEIVED',kind:'task',receiptMinutes:120,recipientId:other.id},expiresAt:new Date(Date.now()+86400000),enabled:true});
    expect((await escalateUnreceivedWork(now)).escalated).toBe(0);
    expect((await escalateUnreceivedWork(now,false)).escalated).toBe(1);expect((await escalateUnreceivedWork(now,false)).escalated).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).workEscalatedAt).not.toBeNull();
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
    await expect(saveAutomation(admin,{...input,id:p.id})).rejects.toThrow('versión vigente');
    const future=new Date(now);future.setUTCHours(23,0,0,0);
    expect((await simulateAutomation(admin,p.id,future)).effects.length).toBeGreaterThan(0);expect(await prisma.task.count()).toBe(0);
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';await runOperationalAutomations(future);expect(await prisma.task.count()).toBe(0);
    await saveAutomation(admin,{...input,id:p.id,version:1,enabled:true});await Promise.all([runOperationalAutomations(future),runOperationalAutomations(future)]);expect(await prisma.task.count()).toBe(1);
    expect(await prisma.operationalAutomationRun.count({where:{status:'SUCCEEDED'}})).toBe(1);await expect(revokeAutomation(admin,p.id,1)).rejects.toThrow();await revokeAutomation(admin,p.id,2);await runOperationalAutomations(future);expect(await prisma.task.count()).toBe(1);
  });
  const dynamicTask=(maxExecutions=2)=>({requestKey:randomUUID(),instruction:'Delego tareas sintéticas con límite explícito',objective:'Preparar revisiones',availableAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),maxExecutions,maxActions:3,rules:[{action:'createTaskAction',fixedFields:{description:'Revisión autorizada',priority:'MEDIA',targetType:'PROPIO'},variableFields:{title:{type:'text',maxLength:100}}}]});
  const dynamicUse=(id:string,title:string)=>executeDelegatedPlan(id,{requestKey:randomUUID(),instruction:'Registrar tarea '+title,steps:[{action:'createTaskAction',fields:{title,description:'Revisión autorizada',priority:'MEDIA',targetType:'PROPIO'}}]});
  it('delegación dinámica: reserva concurrente y límite acumulado no crean efectos extra',async()=>{
    const p=await createDynamicDelegation(dynamicTask(1));
    const results=await Promise.allSettled([dynamicUse(p.id,'Una revisión'),dynamicUse(p.id,'Otra revisión')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await prisma.task.count()).toBe(1);
    expect((await readExecution(p.id)).delegationPolicy?.maxExecutions).toBe(1);
    await expect(dynamicUse(p.id,'Tercera revisión')).rejects.toThrow('límite');
  });
  it('delegación dinámica: mensaje duplicado, revocación, privacidad y permisos vigentes',async()=>{
    const input=dynamicTask();const a=await createDynamicDelegation(input),b=await createDynamicDelegation({...input,requestKey:randomUUID()});expect(a.id).toBe(b.id);
    actor=other;await expect(readExecution(a.id)).rejects.toThrow();await expect(dynamicUse(a.id,'Intrusión')).rejects.toThrow();actor=admin;
    await cancelExecution(a.id);await expect(dynamicUse(a.id,'Revocada')).rejects.toThrow('revocada');expect(await prisma.task.count()).toBe(0);
    const c=await createDynamicDelegation({...dynamicTask(),objective:'Otra autorización'});const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.HK_ATTENDANT}});await prisma.user.update({where:{id:admin.id},data:{roleId:role.id}});
    expect((await dynamicUse(c.id,'Permiso revocado')).steps[0]!.status).toBe('INTERVENTION');expect(await prisma.task.count()).toBe(0);
  });
  it('delegación monetaria dinámica suma importes y no permite cambiar destino o moneda',async()=>{
    const policy={...dynamicTask(5),maxActions:5,budget:{currency:'CLP',maxMinorUnits:2500},rules:[{action:'createManualCashMovementAction',fixedFields:{direction:'ENTRADA',currency:'CLP',reference:'Caja dinámica sintética'},variableFields:{amount:{type:'integer',min:1,max:2000},notes:{type:'text',maxLength:100}},cost:{field:'amount',currency:'CLP'}}]};
    const p=await createDynamicDelegation(policy);const use=(amount:string,notes:string)=>executeDelegatedPlan(p.id,{requestKey:randomUUID(),instruction:'Registrar dinero declarado '+notes,steps:[{action:'createManualCashMovementAction',fields:{direction:'ENTRADA',currency:'CLP',reference:'Caja dinámica sintética',amount,notes}}]});
    expect((await use('1500','primer conteo declarado')).steps[0]!.status).toBe('SUCCEEDED');await expect(use('1500','segundo conteo declarado')).rejects.toThrow('presupuesto');expect((await use('1000','último importe declarado')).steps[0]!.status).toBe('SUCCEEDED');
    expect(await prisma.cashMovement.count({where:{reference:'Caja dinámica sintética'}})).toBe(2);
  });
  it('selección dinámica conserva área y estado y se revalida al usarla',async()=>{
    const task=await createTask(admin,{title:'Registro del ámbito',departmentId:area,assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[]});
    const p=await createDynamicDelegation({...dynamicTask(),rules:[{action:'changeTaskStatusAction',fixedFields:{status:'EN_CURSO'},variableFields:{id:{type:'record',kind:'task',departmentId:area,statuses:['PENDIENTE']}}}]});
    const outside=await createTask(admin,{title:'Fuera del área autorizada',assigneeId:admin.id,priority:'MEDIA',tags:[],checklist:[]});
    const use=(id:string)=>executeDelegatedPlan(p.id,{requestKey:randomUUID(),instruction:'Iniciar registro explícito '+id,steps:[{action:'changeTaskStatusAction',fields:{id,status:'EN_CURSO'}}]});
    await expect(use(outside.id)).rejects.toThrow('área');expect((await use(task.id)).steps[0]!.status).toBe('SUCCEEDED');
  });
  it('formulario protegido conserva secretos fuera del chat, plan, resultado y auditoría',async()=>{
    const p=await plan([{action:'resetUserPasswordAction',fields:{id:other.id}}]);expect((await executePlan(p.id,true)).steps[0]!.status).toBe('PENDING');
    const form=new FormData();form.set('executionId',p.id);form.set('position','0');form.set('authorization','AUTHORIZE_DISPLAYED_STEP');form.set('password','ClaveSinteticaNueva123!');
    expect((await completeProtectedFrontiStep(null,form)).ok).toBe(true);expect((await readExecution(p.id)).steps[0]!.status).toBe('SUCCEEDED');
    const stored=JSON.stringify(await prisma.frontiExecution.findUnique({where:{id:p.id},include:{steps:true}}));expect(stored).not.toContain('ClaveSinteticaNueva123!');expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('ClaveSinteticaNueva123!');
    expect((await completeProtectedFrontiStep(null,form)).ok).toBe(false);
  });
  it('no crea usuario sin un canal para entregar la credencial y no la conserva en el plan',async()=>{
    const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.RECEPTIONIST}});
    const p=await plan([{action:'createUserAction',fields:{name:'Persona Sintética Nueva',username:'sintetico-'+randomUUID().slice(0,8),roleId:role.id,departmentId:area,email:'',phone:'',emailNotificationsEnabled:'false',hiddenFromSelectors:'false'}}]);
    expect((await executePlan(p.id,true)).steps[0]!.status).toBe('PENDING');
    const form=new FormData();form.set('executionId',p.id);form.set('position','0');form.set('authorization','AUTHORIZE_DISPLAYED_STEP');
    const result=await completeProtectedFrontiStep(null,form);expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);expect(result.credentials?.password).toBeTruthy();
    expect(JSON.stringify(await readExecution(p.id))).not.toContain(result.credentials!.password);expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(result.credentials!.password);
  });
  it('suplencias: simulación no cambia responsable; aplicar reutiliza coordinación y no repite',async()=>{
    const task=await createTask(admin,{title:'Trabajo para suplencia',departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    const input={name:'Suplencia explícita',departmentId:area,kind:'SUBSTITUTION',configuration:{trigger:'UNASSIGNED',kind:'task',priority:null,receiptMinutes:30,mode:'APPLY',candidateIds:[other.id],requirePublishedSchedule:false,nextAction:'Recibir y atender el registro original'},expiresAt:new Date(Date.now()+86400000),enabled:false};
    const p=await saveAutomation(admin,input);const simulation=await simulateAutomation(admin,p.id);expect(simulation.effects).toHaveLength(1);expect(simulation.effects[0]).toMatchObject({substituteId:other.id,eligible:true});expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).assigneeId).toBeNull();
    await saveAutomation(admin,{...input,id:p.id,version:1,enabled:true});process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';await Promise.all([runOperationalAutomations(),runOperationalAutomations()]);
    expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}}))).toMatchObject({assigneeId:other.id,workAcknowledgedAt:null});expect(await prisma.operationalAutomationRun.count({where:{policyId:p.id,status:'SUCCEEDED'}})).toBe(1);expect(await prisma.task.count()).toBe(1);
  });
  it('suplencia sin candidato o sin horario publicado se pausa para intervención',async()=>{
    await createTask(admin,{title:'Sin cobertura elegible',departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    const p=await saveAutomation(admin,{name:'Cobertura publicada requerida',departmentId:area,kind:'SUBSTITUTION',configuration:{trigger:'UNASSIGNED',kind:'task',receiptMinutes:30,mode:'APPLY',candidateIds:[other.id],requirePublishedSchedule:true,nextAction:'Confirmar disponibilidad real'},expiresAt:new Date(Date.now()+86400000),enabled:true});
    expect((await simulateAutomation(admin,p.id)).effects[0]).toMatchObject({eligible:false,substituteId:null});process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';expect((await runOperationalAutomations()).failed).toBe(1);expect((await prisma.operationalAutomation.findUniqueOrThrow({where:{id:p.id}})).enabled).toBe(false);
  });
  it('indicadores cuentan sólo fuentes accesibles y no inventan línea base ni tiempos',async()=>{
    await createTask(admin,{title:'Pendiente sin tiempos históricos',departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    const p=await plan();await executePlan(p.id,true);const data=await operationalIndicators(admin,{from:new Date(Date.now()-86400000),to:new Date()});
    expect(data.fronti.successful).toBe(1);expect(data.fronti.baselineStage1).toBeNull();expect(data.fronti.observedHumanTimeSaved).toBeNull();expect(data.durations.resolution.minutes).toBeNull();expect(data.procedures.denominator).toBe(0);
    const isolated=await operationalIndicators(other,{from:new Date(Date.now()-86400000),to:new Date()});expect(isolated.fronti.denominator).toBe(0);
  });

  it('revisión autorizada se vuelve a validar dentro de ediciones, asignaciones y archivos nativos',async()=>{
    const task=await createTask(admin,{title:'Registro con revisión',assigneeId:admin.id,departmentId:area,priority:'MEDIA',tags:[],checklist:[]});
    for(const action of ['assignTaskAction','deleteTaskAction']){
      const step={action,fields:{id:task.id,...(action==='assignTaskAction'?{assigneeId:other.id}:{}),reason:'Motivo sintético explícito'}};
      const revision=await revisionForStep(step);expect(revision).not.toBeNull();await prisma.task.update({where:{id:task.id},data:{title:'Cambio concurrente '+action}});
      const result=await invokeNativeAction(step,revision);expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('cambió');
    }
    const fields:Record<string,string|string[]>=Object.fromEntries(actionDefinition('updateTaskAction').fields.map(key=>[key,'']));Object.assign(fields,{id:task.id,title:'Edición autorizada',priority:'MEDIA',status:'PENDIENTE',targetType:'PERSONA',tags:[],collaboratorIds:[],checklist:[]});
    const step={action:'updateTaskAction',fields};const revision=await revisionForStep(step);await prisma.task.update({where:{id:task.id},data:{title:'Cambio antes de servicio'}});
    const result=await invokeNativeAction(step,revision);expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('cambió');expect((await prisma.task.findUniqueOrThrow({where:{id:task.id}})).deletedAt).toBeNull();
  });
  it('la base rechaza tipos de autorización desconocidos y mandatos dinámicos sin ventana',async()=>{
    const p=await createDynamicDelegation(dynamicTask());await expect(prisma.frontiExecution.update({where:{id:p.id},data:{authorizationKind:'UNRESTRICTED'}})).rejects.toThrow();await expect(prisma.frontiExecution.update({where:{id:p.id},data:{availableAt:null}})).rejects.toThrow();await expect(prisma.frontiExecution.update({where:{id:p.id},data:{reservedMinorUnits:-1}})).rejects.toThrow();
  });

});
