import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import type {CurrentUser} from '@/server/auth/current-user';
import {createEntry,updateEntryVisibility} from '@/server/services/entries';
import {getOperationalHealth,operationalHealthRange} from '@/server/services/operational-health';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
const auth=vi.hoisted(()=>({user:null as CurrentUser|null}));
vi.mock('@/server/auth/guard',()=>({requirePagePermission:async()=>auth.user}));
vi.mock('next/link',()=>({default:'a'}));
import HealthPage from '@/app/(app)/supervision/salud/page';

describe('Salud: totales y eventos según visibilidad del lector',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  it('Gerencia y su contexto Fronti no cuentan novedades ocultas ni eventos directos/indirectos; Supervisor conserva lectura',async()=>{
    const supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});const management=await createUser({roleKey:ROLE_KEYS.MANAGEMENT});const area=await prisma.department.findUniqueOrThrow({where:{key:'ADMINISTRACION'}});await prisma.user.update({where:{id:management.id},data:{departmentId:area.id}});management.departmentId=area.id;auth.user=management;
    const create=(title:string)=>createEntry(supervisor,{type:'NOVEDAD',title,description:'Descripción sintética',priority:'MEDIA',requiresFollowUp:false,tags:[]});
    const secret=await create('Novedad oculta de Salud');const visible=await create('Novedad pública de Salud');
    for(const e of [secret,visible])await prisma.operationalEntry.update({where:{id:e.id},data:{status:'RESUELTO',closedAt:new Date()}});
    const task=await prisma.task.create({data:{entryId:secret.id,title:'Origen indirecto oculto',createdById:supervisor.id,status:'COMPLETADA'}});
    const current=await prisma.operationalEntry.findUniqueOrThrow({where:{id:secret.id}});await updateEntryVisibility(supervisor,{id:secret.id,revision:current.updatedAt.toISOString(),hiddenDepartmentIds:[area.id],includeInReceptionHandover:true});
    const firstHidden=new Date(Date.now()-60000),firstVisible=new Date(Date.now()-30000);
    await prisma.operationalMetricEvent.createMany({data:[
      {entityType:'OperationalEntry',entityId:secret.id,eventType:'ENTRY_TAKEN',status:'SUCCESS',source:'SERVER_ACTION',durationMs:900000,createdAt:firstHidden},
      {entityType:'Task',entityId:task.id,eventType:'ENTRY_RESOLVED',status:'SUCCESS',source:'SERVER_ACTION',durationMs:700000,createdAt:firstHidden},
      {entityType:'OperationalEntry',entityId:visible.id,eventType:'ENTRY_TAKEN',status:'SUCCESS',source:'SERVER_ACTION',durationMs:2000,createdAt:firstVisible},
      {entityType:'OperationalEntry',entityId:visible.id,eventType:'ENTRY_RESOLVED',status:'SUCCESS',source:'SERVER_ACTION',durationMs:4000,createdAt:firstVisible},
    ]});
    const health=await getOperationalHealth(operationalHealthRange('today'),management);expect(health.entries).toMatchObject({created:1,resolved:1,takenObserved:1,resolvedObserved:1,medianTakeMs:2000,medianResolveMs:4000});expect(health.observedSince).toEqual(firstVisible);
    const full=await getOperationalHealth(operationalHealthRange('today'),supervisor);expect(full.entries).toMatchObject({created:2,resolved:2,takenObserved:2,resolvedObserved:2});expect(full.observedSince).toEqual(firstHidden);
    expect(await executeFrontiPageContextTool(management,resolveFrontiPageContext({pathname:'/supervision/salud'}))).toMatchObject({snapshot:{entries:health.entries,observedSince:firstVisible}});
    const html=renderToStaticMarkup(await HealthPage({searchParams:Promise.resolve({})}));expect(html).toContain('Registros creados');expect(html).not.toContain('15 min');expect(html).toContain('2.0 s');
    expect(await prisma.operationalMetricEvent.count()).toBe(4);expect(await prisma.operationalEntry.count()).toBe(2);
  });
});
