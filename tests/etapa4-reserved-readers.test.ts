import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createUser,createShift,prisma,seedCatalog,resetOperationalData,ROLE_KEYS} from './helpers';
import {createEntry,changeEntryStatus,updateEntry} from '@/server/services/entries';
import {changeEntryStatusAction} from '@/server/actions/entries';
import {getDashboardData} from '@/server/services/dashboard';
import {executeFrontiPageContextTool} from '@/server/ai/fronti-v2/page-context-tool';
import {resolveFrontiPageContext} from '@/server/ai/fronti-v2/page-context';
import {getBookItems} from '@/server/services/book';
import {auditFollowUpReadWhere} from '@/server/services/followup-access';
import {runFrontiProactiveSweep} from '@/server/ai/fronti-proactive';
const auth=vi.hoisted(()=>({current:vi.fn()}));
vi.mock('@/server/auth/current-user',async original=>({...await original<object>(),getCurrentUserFresh:auth.current}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:async()=>true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));

describe('AROH Simple · lectores independientes reservados',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  async function reservedWork(){
    const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    const reader=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const follow=await prisma.followUp.create({data:{action:'E4_SECRETO_CONTINUIDAD',visibility:'PRIVADO',createdById:owner.id,ownerId:owner.id}});
    const task=await prisma.task.create({data:{title:'E4_SECRETO_TRABAJO',createdById:owner.id,followUpId:follow.id,assigneeId:owner.id,dueAt:new Date(Date.now()-3600000)}});
    return{owner,reader,follow,task};
  }
  it('iniciar un asunto exige responsable también desde la acción avanzada',async()=>{
    const actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const source=await createEntry(actor,{type:'NOVEDAD',title:'Necesidad pendiente',description:'Contexto',priority:'MEDIA',requiresFollowUp:false,tags:[]});
    await expect(changeEntryStatus(actor,{id:source.id,status:'EN_CURSO'})).rejects.toThrow('responsable');
    auth.current.mockResolvedValue(actor);
    const form=new FormData();form.set('id',source.id);form.set('status','EN_CURSO');
    expect(await changeEntryStatusAction(null,form)).toMatchObject({ok:false,error:expect.stringContaining('responsable')});
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:source.id}})).toMatchObject({ownerId:null,status:'ABIERTO',workStartedAt:null,workAcknowledgedAt:null});
    await updateEntry(actor,{id:source.id,ownerId:actor.id});
    await changeEntryStatus(actor,{id:source.id,status:'EN_CURSO'});
    expect(await prisma.operationalEntry.findUniqueOrThrow({where:{id:source.id}})).toMatchObject({ownerId:actor.id,status:'EN_CURSO',workAcknowledgedById:actor.id});
  });
  it('Inicio y su contexto Fronti sanea entrega antigua sin reescribir evidencia',async()=>{
    const f=await reservedWork();
    const shift=await createShift({userId:f.owner.id,type:'DIA',status:'CERRADO'});
    const handover=await prisma.shiftHandover.create({data:{fromShiftId:shift.id,status:'ENVIADA',issuedById:f.owner.id,issuedAt:new Date(),snapshot:{items:[{title:f.task.title,detail:'E4_SECRETO_FOTOGRAFIA',refType:'task',refId:f.task.id}]},items:{create:{section:'Tareas pendientes',title:f.task.title,detail:'E4_SECRETO_EVIDENCIA',refType:'task',refId:f.task.id}}}});
    const dashboard=await getDashboardData(f.reader);
    expect(dashboard.incoming?.items).toMatchObject([{title:'Asunto reservado',refId:null,refType:null}]);
    expect(JSON.stringify(dashboard)).not.toContain('E4_SECRETO');
    const fronti=await executeFrontiPageContextTool(f.reader,resolveFrontiPageContext({pathname:'/'}));
    expect(JSON.stringify(fronti)).not.toContain('E4_SECRETO');
    expect((await prisma.handoverItem.findFirstOrThrow({where:{handoverId:handover.id}})).title).toBe(f.task.title);
    expect((await getDashboardData(f.owner)).incoming?.items[0]?.title).toBe(f.task.title);
  });
  it('Incluir eliminados conserva reserva y permite recuperar continuidad autorizada',async()=>{
    const f=await reservedWork();await prisma.followUp.update({where:{id:f.follow.id},data:{deletedAt:new Date()}});
    expect((await getBookItems({kinds:['followup']},f.owner)).items).toHaveLength(0);
    expect((await getBookItems({kinds:['followup'],includeDeleted:true},f.owner)).items.some(item=>item.id===f.follow.id&&item.deleted)).toBe(true);
    expect((await getBookItems({kinds:['followup'],includeDeleted:true},f.reader)).items).toHaveLength(0);
  });
  it('auditoría filtra fuentes antes de paginar, incluido comentario y hallazgo proactivo',async()=>{
    const f=await reservedWork();
    const alert=await prisma.alert.create({data:{title:'E4_SECRETO_AVISO',type:'TAREA_VENCIDA',taskId:f.task.id}});
    const comment=await prisma.comment.create({data:{taskId:f.task.id,authorId:f.owner.id,body:'E4_SECRETO_COMENTARIO'}});
    for(const [entity,entityId] of [['FollowUp',f.follow.id],['Task',f.task.id],['Alert',alert.id],['Comment',comment.id]]){
      await prisma.auditLog.create({data:{entity:entity!,entityId:entityId!,action:'CREAR',summary:'E4_SECRETO',after:{evidence:'E4_SECRETO'}}});
    }
    await prisma.auditLog.create({data:{entity:'FrontiProactiveSignal',entityId:'signal',action:'CREAR',summary:'E4_SECRETO',after:{sourceEntity:'Task',sourceEntityId:f.task.id,evidence:'E4_SECRETO'}}});
    const publicLog=await prisma.auditLog.create({data:{entity:'Shift',entityId:'public',action:'CREAR',summary:'Evidencia operativa pública'}});
    const plan=await prisma.$queryRaw<Array<{'QUERY PLAN':Array<Record<string,unknown>>}>>`EXPLAIN (ANALYZE,FORMAT JSON) SELECT a.id FROM "AuditLog" a WHERE NOT EXISTS (SELECT 1 FROM "AuditSourceFollowUp" o JOIN "FollowUp" f ON f.id=o."followUpId" WHERE o."auditLogId"=a.id AND f.visibility='PRIVADO' AND f."createdById"<>${f.reader.id})`;
    const metrics=plan[0]?.['QUERY PLAN'][0];
    console.info('E4_AUDIT_PLAN',{planningMs:metrics?.['Planning Time'],executionMs:metrics?.['Execution Time'],jit:metrics?.JIT});
    const where=auditFollowUpReadWhere(f.reader);
    expect(await prisma.auditLog.count({where})).toBe(1);
    expect(await prisma.auditLog.findMany({where,take:1,orderBy:{createdAt:'desc'}})).toMatchObject([{id:publicLog.id}]);
    expect(await prisma.auditLog.count({where:auditFollowUpReadWhere(f.owner)})).toBe(6);
    await prisma.followUp.update({where:{id:f.follow.id},data:{deletedAt:new Date()}});
    expect(await prisma.auditLog.count({where:auditFollowUpReadWhere(f.reader)})).toBe(1);
    expect(await prisma.auditLog.count()).toBe(6);
  });
  it('Fronti proactivo no reclama ni avisa a destinatarios fuera de la reserva',async()=>{
    const f=await reservedWork();await prisma.user.update({where:{id:f.owner.id},data:{frontiAccessEnabled:true}});
    const [a,b]=await Promise.all([runFrontiProactiveSweep({trigger:'reserved-test'}),runFrontiProactiveSweep({trigger:'reserved-test'})]);
    expect(a.notified+b.notified).toBe(1);
    expect(await prisma.frontiProactiveClaim.count({where:{userId:f.reader.id}})).toBe(0);
    expect(await prisma.notification.count({where:{userId:f.reader.id,type:'FRONTI_HALLAZGO'}})).toBe(0);
    expect(await prisma.notification.count({where:{userId:f.owner.id,type:'FRONTI_HALLAZGO'}})).toBe(1);
    expect(await prisma.auditLog.count({where:{entity:'FrontiProactiveSignal',AND:[auditFollowUpReadWhere(f.reader)]}})).toBe(0);
    expect(await prisma.auditLog.count({where:{entity:'FrontiProactiveSignal',AND:[auditFollowUpReadWhere(f.owner)]}})).toBe(1);
  });
});
