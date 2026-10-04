import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {createEntry,getSubjectEntry} from '@/server/services/entries';
import {createTask,changeTaskStatus} from '@/server/services/tasks';
import {changeTaskStatusAction} from '@/server/actions/tasks';
const auth=vi.hoisted(()=>({current:vi.fn()}));
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:auth.current}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));

describe('AROH Simple · reserva y revisión independiente',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('filtra Housekeeping histórico reservado antes del contexto sin ocultar la novedad',async()=>{
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const reader=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const source=await createEntry(admin,{type:'NOVEDAD',title:'Origen público',description:'Contexto',priority:'MEDIA',requiresFollowUp:false,tags:[]});
    await prisma.housekeepingRequest.create({data:{requestKey:randomUUID(),sourceEntryId:source.id,isDemo:true,resolution:'Resultado reservado',createdById:admin.id}});
    expect((await getSubjectEntry(reader,source.id)).title).toBe('Origen público');
    expect((await getSubjectEntry(reader,source.id)).housekeepingRequest).toBeNull();
    expect((await getSubjectEntry(admin,source.id)).housekeepingRequest?.resolution).toBe('Resultado reservado');
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
