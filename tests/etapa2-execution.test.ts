import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { prepareExecution, executePlan, cancelExecution, readExecution } from '@/server/ai/execution/service';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import { saveAutomation, simulateAutomation, runOperationalAutomations, revokeAutomation } from '@/server/services/operational-automation';
import type { FrontiStep } from '@/domain/fronti-execution';
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
