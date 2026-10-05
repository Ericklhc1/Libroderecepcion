import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
import { simulateAutomation, runOperationalAutomations } from '@/server/services/operational-automation';

const mocks=vi.hoisted(()=>({
  db:{operationalAutomation:{findFirst:vi.fn(),findMany:vi.fn(),updateMany:vi.fn()},operationalAutomationRun:{findMany:vi.fn(),upsert:vi.fn()},department:{count:vi.fn()},user:{findFirst:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()},
  board:vi.fn(),preview:vi.fn(),readWork:vi.fn(),permission:vi.fn(),
}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/server/auth/guard',()=>({requirePermission:mocks.permission}));
vi.mock('@/server/action',()=>({runAction:async(fn:()=>Promise<unknown>)=>fn()}));
vi.mock('@/lib/prisma',()=>({prisma:mocks.db}));
vi.mock('@/server/services/tasks',()=>({createTask:vi.fn()}));
vi.mock('@/server/services/coordination',()=>({getCoordinationBoard:mocks.board,coordinationMetrics:vi.fn()}));
vi.mock('@/server/services/coordination-access',()=>({coordinationEntries:vi.fn(),coordinationTasks:vi.fn(),coordinationFollowUps:vi.fn()}));
vi.mock('@/server/services/housekeeping-work',()=>({hkWorkVisibility:vi.fn(),hkCapability:vi.fn()}));
vi.mock('@/server/services/legal-acceptance',()=>({hasAcceptedCurrentTerms:vi.fn(async()=>true)}));
vi.mock('@/server/services/reception-operation-gate',()=>({assertReceptionOperationPermission:vi.fn()}));
vi.mock('@/server/services/automation-substitutions',()=>({chooseSubstitute:vi.fn(),applySubstitution:vi.fn(),applyPreparedSubstitution:vi.fn()}));
vi.mock('@/server/services/substitution-availability',()=>({lockSubstitutionContext:vi.fn(),previewSubstitutionAvailability:mocks.preview,readSubstitutionWork:mocks.readWork}));
vi.mock('@/server/notifications',()=>({notify:vi.fn()}));

const actor={id:'owner',permissions:['system.configure']} as CurrentUser;
const now=new Date();
const config={trigger:'UNASSIGNED',kind:'task',priority:null,mode:'APPLY',candidateIds:['candidate'],requirePublishedSchedule:true,waitForPublishedSchedule:true,nextAction:'Revisar pendiente original',receiptMinutes:30,maxItems:1};
function policy(){return {id:'policy',ownerId:actor.id,departmentId:'area',kind:'SUBSTITUTION',configuration:config,version:1,scanPage:1,enabled:true,revokedAt:null,expiresAt:new Date(now.getTime()+86400000)};}
function row(id:string){return {id,kind:'task',title:id,ownerId:null,updatedAt:now,priority:'MEDIA',status:'PENDIENTE',receivedAt:null,assignedAt:null,availableAt:null,dueAt:null,href:`/tareas/${id}`};}
function preview(state:string){return {state,reasonCode:state==='NO_SLOT'?'NO_SLOT_IN_WINDOW':state==='FUTURE_SLOT'?'NEXT_PUBLISHED_SLOT':'WORK_NO_LONGER_PENDING',selection:null,eligibleNow:false,responsible:null,generatedAt:now,searchUntil:new Date(now.getTime()+86400000),sourceRevision:now.toISOString(),planningOnly:true,policyVersion:1,policyState:'ACTIVE'};}
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(actor);
  mocks.db.operationalAutomation.findFirst.mockResolvedValue(policy());
  mocks.db.operationalAutomation.findMany.mockResolvedValue([policy()]);
  mocks.db.operationalAutomation.updateMany.mockResolvedValue({count:1});
  mocks.db.operationalAutomationRun.findMany.mockResolvedValue([]);
  mocks.db.department.count.mockResolvedValue(1);
  mocks.db.$transaction.mockImplementation(async fn=>fn(mocks.db));
  mocks.db.user.findFirst.mockResolvedValue({id:actor.id,name:'Owner',roleId:'role',mustChangePassword:false,departmentId:'area',role:{key:'CUSTOM',name:'Actor',level:1,operational:true,permissions:[{permission:{key:'system.configure'}}]}});
  mocks.board.mockResolvedValue({rows:[row('wait'),row('intervention')],page:1,hasMore:false});
  mocks.readWork.mockImplementation(async(_actor,_kind,id)=>({id}));
  mocks.preview.mockImplementation(async(_actor,_policy,work)=>preview(work.id==='wait'?'FUTURE_SLOT':'NO_SLOT'));
});

describe('vista previa de la acción: evidencia tipada y límite humano',()=>{
  it('muestra diez franjas con sus advertencias y no pierde el total observado',async()=>{
    const rows=Array.from({length:11},(_,index)=>row(`espera-${index}`));
    mocks.board.mockResolvedValue({rows,page:1,hasMore:false});
    mocks.preview.mockResolvedValue({...preview('FUTURE_SLOT'),responsible:'Persona sintética',policyState:'PAUSED',selection:{userId:'candidate',candidatePosition:0,slotId:'slot',planId:'plan',publishedVersion:1,slotUpdatedAt:now,startAt:new Date(now.getTime()+3600000),effectiveEndAt:new Date(now.getTime()+7200000),eligibleUntil:new Date(now.getTime()+7200000)}});
    const {simulateAutomationAction}=await import('@/server/actions/operational-automation');
    const form=new FormData();form.set('id','policy');
    const result=await simulateAutomationAction(null,form);
    expect(result.ok).toBe(true);
    if(!result.ok)throw new Error('La simulación no confirmó la lectura.');
    expect(result.message).toContain('11 registros observados');
    expect(result.message.match(/próxima franja publicada de Persona sintética/g)).toHaveLength(10);
    expect(result.message).toContain('Política en pausa: sólo simulación.');
    expect(result.message).toContain('Requiere revalidación; no asignado.');
    expect(result.message).toContain('Siguiente acción: Revisar pendiente original.');
    expect(result.message).toContain('Vista previa limitada a 10 registros');
    expect(result.message).not.toContain('espera-10');
    expect(mocks.permission).toHaveBeenCalledWith('system.configure');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('conserva el motivo de intervención cuando no hay franja',async()=>{
    const {simulateAutomationAction}=await import('@/server/actions/operational-automation');
    const form=new FormData();form.set('id','policy');
    const result=await simulateAutomationAction(null,form);
    expect(result.ok).toBe(true);
    if(!result.ok)throw new Error('La simulación no confirmó la lectura.');
    expect(result.message).toContain('intervention: No hay una franja publicada elegible');
    expect(result.message).toContain('Leído');
    expect(result.message).toContain('/tareas/intervention');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('conserva la presentación de efectos de escalamiento sin disponibilidad',async()=>{
    mocks.db.operationalAutomation.findFirst.mockResolvedValue({...policy(),kind:'ESCALATION',configuration:{trigger:'UNASSIGNED',kind:'task',priority:null,receiptMinutes:30,maxItems:25,recipientId:actor.id}});
    const {simulateAutomationAction}=await import('@/server/actions/operational-automation');
    const form=new FormData();form.set('id','policy');
    const result=await simulateAutomationAction(null,form);
    expect(result.ok).toBe(true);
    if(!result.ok)throw new Error('La simulación no confirmó la lectura.');
    expect(result.message).toContain('Escalar wait a Owner');
    expect(result.message).not.toContain('próxima franja');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe('motor real de simulación: cupo de efectos e intervención',()=>{
  it('maxItems1 no recorta la intervención que sigue a una espera',async()=>{
    const result=await simulateAutomation(actor,'policy',now);
    expect(result.effects.map(effect=>'id' in effect?effect.id:null)).toEqual(['wait','intervention']);
    expect(result).toMatchObject({waitingObserved:1,nextPage:1});
    expect(result.effects[1]).toMatchObject({eligible:false,availability:{state:'NO_SLOT'}});
  });
  it('no adelanta cursor sobre otra intervención que todavía no despachó',async()=>{
    mocks.board.mockResolvedValue({rows:[row('wait'),row('intervention'),row('later')],page:1,hasMore:false});
    const result=await simulateAutomation(actor,'policy',now);
    expect(result.effects.map(effect=>'id' in effect?effect.id:null)).toEqual(['wait','intervention']);
    expect(result).toMatchObject({waitingObserved:1,nextPage:3,complete:false});
    mocks.db.operationalAutomation.findFirst.mockResolvedValue({...policy(),scanPage:3});
    const next=await simulateAutomation(actor,'policy',now);
    expect(next.effects.map(effect=>'id' in effect?effect.id:null)).toEqual(['later']);
  });
  it('una omisión por trabajo cambiado no se cuenta como espera',async()=>{
    mocks.preview.mockImplementation(async(_actor,_policy,work)=>preview(work.id==='wait'?'WORK_CHANGED':'NO_SLOT'));
    expect(await simulateAutomation(actor,'policy',now)).toMatchObject({waitingObserved:0});
  });
  it('el barrido conserva intervención visible y pausa la política con maxItems1',async()=>{
    const previous=process.env.AROH_AUTOMATION_EXECUTION_ENABLED;
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';
    try{
      expect(await runOperationalAutomations(now)).toMatchObject({attempted:0,failed:1});
      expect(mocks.db.operationalAutomation.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{enabled:false}}));
      expect(mocks.db.operationalAutomationRun.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({status:'INTERVENTION',result:expect.objectContaining({error:expect.stringContaining('franja publicada elegible')})})}));
    }finally{if(previous===undefined)delete process.env.AROH_AUTOMATION_EXECUTION_ENABLED;else process.env.AROH_AUTOMATION_EXECUTION_ENABLED=previous;}
  });
  it.each([
    {label:'conflicto transaccional Prisma',code:'P2034',meta:undefined,recoverable:true},
    {label:'deadlock SQL crudo',code:'P2010',meta:{code:'40P01'},recoverable:true},
    {label:'error SQL distinto',code:'P2010',meta:{code:'42601'},recoverable:false},
    {label:'error SQL sin SQLSTATE',code:'P2010',meta:undefined,recoverable:false},
    {label:'código distinto con metadata similar',code:'P1001',meta:{code:'40P01'},recoverable:false},
  ])('$label sólo difiere cuando hay evidencia de rollback recuperable',async({code,meta,recoverable})=>{
    const previous=process.env.AROH_AUTOMATION_EXECUTION_ENABLED;
    process.env.AROH_AUTOMATION_EXECUTION_ENABLED='true';
    mocks.preview.mockRejectedValueOnce(Object.assign(new Error('Fallo sintético controlado'),{code,meta}));
    try{
      expect(await runOperationalAutomations(now)).toMatchObject({attempted:0,failed:recoverable?0:1,deferred:recoverable});
      expect(mocks.preview).toHaveBeenCalledTimes(1);
      if(recoverable){
        expect(mocks.db.operationalAutomation.updateMany).toHaveBeenCalledExactlyOnceWith({where:{id:'policy',version:1},data:{lastEvaluatedAt:now}});
        expect(mocks.db.operationalAutomationRun.upsert).not.toHaveBeenCalled();
        expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
      }else{
        expect(mocks.db.operationalAutomation.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{enabled:false}}));
        expect(mocks.db.operationalAutomationRun.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({status:'INTERVENTION'})}));
      }
    }finally{if(previous===undefined)delete process.env.AROH_AUTOMATION_EXECUTION_ENABLED;else process.env.AROH_AUTOMATION_EXECUTION_ENABLED=previous;}
  });
});
