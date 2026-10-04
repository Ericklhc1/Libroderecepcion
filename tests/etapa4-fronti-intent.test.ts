import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import type {CurrentUser} from '@/server/auth/current-user';
import {prepareSubjectIntent} from '@/server/ai/fronti-v2/subject-intent';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
import {executePlan,readExecution,cancelExecution} from '@/server/ai/execution/service';
import {createEntry} from '@/server/services/entries';
let actor:CurrentUser;
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:async()=>{
  const row=await prisma.user.findUnique({where:{id:actor.id},include:{role:{include:{permissions:{include:{permission:true}}}}}});
  if(!row?.active)return null;
  return {...actor,departmentId:row.departmentId,roleId:row.roleId,roleKey:row.role.key,isSystemAdmin:row.role.key===ROLE_KEYS.SYSTEM_ADMIN,permissions:row.role.permissions.map(p=>p.permission.key),frontiAccessEnabled:row.frontiAccessEnabled};
}}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
const message=(content:string)=>({role:'user' as const,content});
const idOf=(result:Awaited<ReturnType<typeof prepareSubjectIntent>>)=>result!.confirmations[0]!.token.replace('fronti-plan:','');
describe('AROH Simple · intención a procedimiento nativo de Fronti',()=>{
  beforeAll(seedCatalog);
  beforeEach(async()=>{await resetOperationalData();actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});});
  async function source(room=true){
    const location=room?await prisma.room.findUniqueOrThrow({where:{number:'512'}}):null;
    const entry=await createEntry(actor,{type:'NOVEDAD',title:'Necesidad del asunto original',description:'Contexto original sin retranscripción',roomId:location?.id,priority:'ALTA',requiresFollowUp:false,tags:[]});
    return {entry,page:resolveFrontiPageContext({pathname:`/libro/${entry.id}`})};
  }
  it('prepara en lenguaje humano, exige autorizar y ejecuta una sola atención concurrente con retorno al origen',async()=>{
    const f=await source();
    const result=await prepareSubjectIntent(actor,[message('Fronti, manda esto a Mantenimiento y avísame cuando esté listo.')],f.page,randomUUID());
    expect(result?.confirmations).toHaveLength(1);
    const card=result!.confirmations[0]!;
    expect(card.detail).toContain(`Asunto #${f.entry.humanId}`);expect(card.detail).toContain('Mantenimiento');expect(card.detail).toContain('512');
    for(const internal of ['entryId','departmentId','requestKey','revision',f.entry.id])expect(card.detail).not.toContain(internal);
    const id=idOf(result);expect(await prisma.task.count()).toBe(0);
    await expect(executePlan(id,false)).rejects.toThrow('autorización');
    await Promise.all([executePlan(id,true),executePlan(id,true)]);
    const plan=await readExecution(id);expect(plan.steps[0]!.status).toBe('SUCCEEDED');
    expect(plan.steps[0]!.result).toMatchObject({ok:true,href:`/libro/${f.entry.id}`});
    const task=await prisma.task.findFirstOrThrow({where:{entryId:f.entry.id}});
    expect(task).toMatchObject({title:f.entry.title,description:f.entry.description,roomId:f.entry.roomId,createdById:actor.id});
    expect(await prisma.task.count({where:{entryId:f.entry.id}})).toBe(1);
    await executePlan(id,true);expect(await prisma.task.count({where:{entryId:f.entry.id}})).toBe(1);
    const repeated=await prepareSubjectIntent(actor,[message('Fronti, manda esto a Mantenimiento y avísame cuando esté listo.')],f.page);
    expect(repeated?.confirmations).toHaveLength(0);expect(repeated?.reply).toContain('ya está registrada');
    expect(await prisma.auditLog.count({where:{entity:'Task',entityId:task.id,action:'CREAR'}})).toBe(1);
    expect(await prisma.auditLog.count({where:{entity:'FrontiExecution',entityId:id}})).toBeGreaterThan(0);
  });
  it('pide sólo área o ubicación faltante, y conserva HK aunque la ubicación mencione Recepción',async()=>{
    const f=await source(false);
    const area=await prepareSubjectIntent(actor,[message('Manda esto a otra área')],f.page);
    expect(area?.confirmations).toHaveLength(0);expect(area?.reply).toContain('Qué área');
    const first=message('Manda esto a Housekeeping');
    const location=await prepareSubjectIntent(actor,[first],f.page);
    expect(location?.confirmations).toHaveLength(0);expect(location?.reply).toContain('ubicación');
    const result=await prepareSubjectIntent(actor,[first,{role:'assistant',content:location!.reply},message('Lobby junto a Recepción')],f.page);
    expect(result?.confirmations).toHaveLength(1);expect(result!.confirmations[0]!.detail).toContain('Área responsable: Housekeeping');
    await executePlan(idOf(result),true);
    expect(await prisma.housekeepingRequest.findFirst({where:{sourceEntryId:f.entry.id}})).toMatchObject({location:'Lobby junto a Recepción',createdById:actor.id});
    expect(await prisma.task.count({where:{entryId:f.entry.id}})).toBe(0);
  });
  it('no reutiliza una pregunta de ubicación después de terminar o abandonar la solicitud',async()=>{
    const f=await source(false);
    const first=message('Manda esto a Housekeeping');
    const question={role:'assistant' as const,content:`¿En qué ubicación necesita atención el asunto #${f.entry.humanId}?`};
    for(const latest of ['¿Qué pendientes tengo?','Gracias','Revisar mis avisos']){
      expect(await prepareSubjectIntent(actor,[first,question,message('Lobby'),{role:'assistant',content:'Solicitud preparada.'},message(latest)],f.page)).toBeNull();
    }
    expect(await prepareSubjectIntent(actor,[first,question,message('¿Qué pendientes tengo?')],f.page)).toBeNull();
    expect(await prisma.frontiExecution.count()).toBe(0);
  });
  it('identifica folio explícito y corta cancelación, ambigüedad o contexto inexistente sin ejecutar',async()=>{
    const f=await source();
    const byFolio=await prepareSubjectIntent(actor,[message(`Deriva el asunto #${f.entry.humanId} a Mantenimiento`)],null);
    expect(byFolio?.confirmations).toHaveLength(1);
    await cancelExecution(idOf(byFolio));
    await expect(executePlan(idOf(byFolio),true)).rejects.toThrow('cancelada');
    expect(await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento'),{role:'assistant',content:'Confirma'},message('Fronti, cancela. No lo hagas.')],f.page)).toBeNull();
    expect((await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento y a Housekeeping')],f.page))?.confirmations).toHaveLength(0);
    expect((await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento')],null))?.reply).toContain('Abre el asunto');
    expect(await prisma.task.count()).toBe(0);
  });
  it('no elude revisión vigente ni permisos revocados entre propuesta y ejecución',async()=>{
    const f=await source();
    const prepared=await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento')],f.page);
    await prisma.operationalEntry.update({where:{id:f.entry.id},data:{title:'Contexto cambiado después de proponer'}});
    expect((await executePlan(idOf(prepared),true)).steps[0]!.status).toBe('INTERVENTION');
    expect(await prisma.task.count()).toBe(0);
    const next=await source();
    const plan=await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento')],next.page);
    const role=await prisma.role.findUniqueOrThrow({where:{key:ROLE_KEYS.HK_ATTENDANT}});
    await prisma.user.update({where:{id:actor.id},data:{roleId:role.id,frontiAccessEnabled:true}});
    expect((await executePlan(idOf(plan),true)).steps[0]!.status).toBe('INTERVENTION');
    expect(await prisma.task.count()).toBe(0);
  });
  it('una tarea reservada no presta contexto a una persona ajena y HK conserva su procedimiento especializado',async()=>{
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const f=await prisma.followUp.create({data:{action:'Origen reservado',visibility:'PRIVADO',createdById:owner.id,ownerId:owner.id}});
    const task=await prisma.task.create({data:{title:'SECRETO_NO_FRONTI',followUpId:f.id,createdById:owner.id}});
    const result=await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento')],resolveFrontiPageContext({pathname:`/tareas/${task.id}`}));
    expect(result?.confirmations).toHaveLength(0);expect(JSON.stringify(result)).not.toContain('SECRETO_NO_FRONTI');
    expect(await prepareSubjectIntent(actor,[message('Manda esto a Mantenimiento')],resolveFrontiPageContext({pathname:'/admin/housekeeping'}))).toBeNull();
    expect(await prisma.frontiExecution.count()).toBe(0);
  });
});
