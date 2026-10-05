import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { substitutionSchema } from '@/domain/operational-automation';
import { substitutionScanCursor, advanceSubstitutionScan } from '@/domain/substitution-scan';
import { templateWindow } from '@/domain/schedule';
import { previewSubstitutionAvailability, substitutionStillPending, type SubstitutionWork } from '@/server/services/substitution-availability';
import { RuleError } from '@/server/errors';

const access=vi.hoisted(()=>({areas:vi.fn(),capability:vi.fn(),worker:vi.fn(),recipients:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:new Proxy({}, {get(){throw new Error('Global DB access is forbidden in this pure suite');}})}));
vi.mock('@/server/services/housekeeping-work',()=>({hkCapability:access.capability,validateWorker:access.worker,hkWorkVisibility:vi.fn(async()=>({}))}));
vi.mock('@/server/services/tasks',()=>({assertTaskSourceRecipients:access.recipients}));
vi.mock('@/server/services/schedule-access',()=>({scheduleAreaIds:access.areas}));
vi.mock('@/server/services/coordination-access',()=>({coordinationEntries:vi.fn(()=>({})),coordinationTasks:vi.fn(()=>({}))}));
const now=new Date('2026-10-04T12:00:00Z');
const actor={id:'author',roleKey:'ADMINISTRADOR_SISTEMA',permissions:['system.configure','task.assign','entry.edit','schedule.view']} as CurrentUser;
const config={trigger:'UNASSIGNED' as const,kind:'task' as const,mode:'APPLY' as const,candidateIds:['a','b'],requirePublishedSchedule:true,nextAction:'Revisar el pendiente',receiptMinutes:30,waitForPublishedSchedule:true};
const policy=()=>({id:'policy',ownerId:actor.id,departmentId:'area',configuration:config,version:1,expiresAt:new Date('2026-10-15T23:00:00Z'),revokedAt:null,enabled:false});
const work=():SubstitutionWork=>({id:'work',kind:'task',ownerId:null,departmentId:'area',updatedAt:now,status:'PENDIENTE',priority:'MEDIA',receivedAt:null,assignedAt:null,availableAt:null,dueAt:null,startedAt:null,workDate:null,followUpId:null,alertId:null,sourceChanged:false,version:null});
function person(id:string){return {id,name:`Persona ${id}`,role:{key:'SUPERVISOR',permissions:[]},scheduleCollaborator:{id:`c-${id}`,active:true}};}
function slot(id='s-a',userId='a',date='2026-10-05',start='08:00',end='19:00',departmentId='area'){
  return {id,userId,collaboratorId:`c-${userId}`,collaborator:{userId},planId:`p-${departmentId}`,plan:{id:`p-${departmentId}`,departmentId,status:'PUBLICADO',publishedVersion:2,publishedAt:new Date('2026-10-03T00:00:00Z')},date:new Date(date),kind:'TURNO',functionName:'Operación',...templateWindow(date,{startTime:start,endTime:end,crossesMidnight:false,breakMinutes:0,breakPaid:false}),breakPaid:false,extraKind:'NINGUNO',extraStatus:'NO_APLICA',cancelledAt:null,updatedAt:new Date('2026-10-03T00:00:00Z')};
}
function database(slots:unknown[]=[slot()]){
  return {user:{findMany:vi.fn(async()=>[person('a'),person('b')])},scheduleSlot:{findMany:vi.fn(async()=>slots)},housekeepingDayMember:{findMany:vi.fn(async()=>[])},housekeepingDelegation:{findFirst:vi.fn(async()=>null),findMany:vi.fn(async()=>[])}};
}
function tx(db:ReturnType<typeof database>){return db as unknown as Prisma.TransactionClient;}
beforeEach(()=>{vi.clearAllMocks();access.areas.mockResolvedValue(null);access.capability.mockResolvedValue(true);access.worker.mockResolvedValue(undefined);access.recipients.mockResolvedValue(undefined);});

describe('suplencia futura: opt-in y lectura sin DB',()=>{
  it('políticas antiguas no activan espera y false conserva semántica',()=>{
    const {waitForPublishedSchedule:_flag,...old}=config;
    expect(substitutionSchema.parse(old).waitForPublishedSchedule).toBe(false);
    expect(substitutionSchema.parse({...config,waitForPublishedSchedule:false}).waitForPublishedSchedule).toBe(false);
    expect(substitutionSchema.safeParse({...config,requirePublishedSchedule:false}).success).toBe(false);
  });
  it('muestra próxima franja sin modificar el pendiente y marca regla pausada',async()=>{
    const db=database(), w=work(), before=JSON.stringify(w);
    const result=await previewSubstitutionAvailability(actor,policy(),w,now,tx(db));
    expect(result).toMatchObject({state:'FUTURE_SLOT',eligibleNow:false,planningOnly:true,policyState:'PAUSED',responsible:'Persona a'});
    expect(result.selection?.slotId).toBe('s-a');expect(JSON.stringify(w)).toBe(before);
    expect(result.searchUntil.toISOString()).toBe('2026-10-18T03:00:00.000Z');
  });
  it('consulta sólo IDs explícitos y planning publicado, no depende de top200 del equipo',async()=>{
    const db=database();await previewSubstitutionAvailability(actor,policy(),work(),now,tx(db));
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:{in:['a','b']}})}));
    expect(db.scheduleSlot.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({plan:{status:'PUBLICADO'},cancelledAt:null}),take:2001}));
  });
  it.each(['owner','permission','schedule','area'] as const)('no filtra horarios ante falta de acceso: %s',async missing=>{
    const db=database();let a=actor;
    if(missing==='owner')a={...actor,id:'someone'};
    if(missing==='permission')a={...actor,permissions:['schedule.view']};
    if(missing==='schedule')a={...actor,roleKey:'CUSTOM',permissions:['system.configure','task.assign']};
    if(missing==='area')access.areas.mockResolvedValue(['different']);
    expect((await previewSubstitutionAvailability(a,policy(),work(),now,tx(db))).state).toBe('ACCESS_UNAVAILABLE');
    expect(db.scheduleSlot.findMany).not.toHaveBeenCalled();
  });
  it('caducidad o revocación impiden presentar franja autorizada',async()=>{
    for(const p of [{...policy(),expiresAt:now},{...policy(),revokedAt:now}]){
      const db=database();expect((await previewSubstitutionAvailability(actor,p,work(),now,tx(db))).state).toBe('AUTHORIZATION_EXPIRES');expect(db.user.findMany).not.toHaveBeenCalled();
    }
  });
  it.each(['EN_CURSO','EN_GESTION','REALIZADA','POR_REVISAR','CANCELADA','RESUELTO'])('no toca trabajo avanzado %s',status=>{
    expect(substitutionStillPending({...work(),status},policy(),now)).toBe(false);
  });
  it.each([
    {kind:'task' as const,status:'ACEPTADA'},
    {kind:'task' as const,status:'DEVUELTA'},
    {kind:'housekeeping' as const,status:'RECIBIDO'},
  ])('conserva $kind histórico $status aunque falten marcas de recepción e inicio',async({kind,status})=>{
    for(const trigger of ['OVERDUE','UNRECEIVED'] as const){
      const p={...policy(),configuration:{...config,kind,trigger}};
      const historical={...work(),kind,status,ownerId:'incumbent',assignedAt:new Date(now.getTime()-31*60_000),dueAt:new Date(now.getTime()-1000),receivedAt:null,startedAt:null};
      const before=structuredClone(historical),db=database();
      expect(substitutionStillPending(historical,p,now)).toBe(false);
      expect(await previewSubstitutionAvailability(actor,p,historical,now,tx(db))).toMatchObject({state:'WORK_CHANGED',reasonCode:'WORK_NO_LONGER_PENDING',selection:null,eligibleNow:false});
      expect(historical).toEqual(before);
      expect(db.user.findMany).not.toHaveBeenCalled();
      expect(db.scheduleSlot.findMany).not.toHaveBeenCalled();
    }
  });
  it.each(['entry','task','housekeeping'] as const)('la recepción veta OVERDUE en %s aunque no haya inicio ni cierre',kind=>{
    const p={...policy(),configuration:{...config,kind,trigger:'OVERDUE' as const}};
    const pending={...work(),kind,ownerId:'incumbent',dueAt:new Date(now.getTime()-1000)};
    expect(substitutionStillPending(pending,p,now)).toBe(true);
    expect(substitutionStillPending({...pending,receivedAt:now,updatedAt:new Date(now.getTime()+1000)},p,new Date(now.getTime()+2000))).toBe(false);
  });
  it.each(['task','housekeeping'] as const)('la recepción veta BLOCKED en %s aunque el impedimento continúe',kind=>{
    const p={...policy(),configuration:{...config,kind,trigger:'BLOCKED' as const}};
    const pending={...work(),kind,ownerId:'incumbent',status:kind==='task'?'BLOQUEADA':'BLOQUEADO'};
    expect(substitutionStillPending(pending,p,now)).toBe(true);
    expect(substitutionStillPending({...pending,receivedAt:now,updatedAt:new Date(now.getTime()+1000)},p,new Date(now.getTime()+2000))).toBe(false);
  });
  it('omite inicio, área distinta, fuente modificada o programación futura',()=>{
    for(const change of [{startedAt:now},{departmentId:'other'},{sourceChanged:true},{availableAt:new Date(now.getTime()+1000)}])expect(substitutionStillPending({...work(),...change},policy(),now)).toBe(false);
  });
  it('rechaza el candidato reservado y considera al siguiente sin exponer su motivo',async()=>{
    access.recipients.mockImplementation(async(_tx,ids)=>{if(ids.includes('a'))throw new RuleError('SECRETO NO FILTRAR');});
    const result=await previewSubstitutionAvailability(actor,policy(),work(),now,tx(database([slot(),slot('s-b','b')])));
    expect(result.selection?.userId).toBe('b');expect(JSON.stringify(result)).not.toContain('SECRETO');
  });
  it('no suprime fallos técnicos como si fueran ineligibilidad',async()=>{
    access.recipients.mockRejectedValue(new Error('lectura no confirmada'));
    await expect(previewSubstitutionAvailability(actor,policy(),work(),now,tx(database()))).rejects.toThrow('lectura no confirmada');
  });
  it('declara incompleta la evidencia truncada, sin próximo candidato falso',async()=>{
    const result=await previewSubstitutionAvailability(actor,policy(),work(),now,tx(database(Array.from({length:2001},()=>slot()))));
    expect(result).toMatchObject({state:'INCOMPLETE',selection:null,eligibleNow:false});
  });
  it('detecta solape publicado interárea sin devolver su detalle',async()=>{
    const secret=slot('s-secret','a','2026-10-05','10:00','12:00','AREA_PRIVADA');
    const result=await previewSubstitutionAvailability(actor,policy(),work(),now,tx(database([slot(),secret])));
    expect(result).toMatchObject({state:'REVIEW_REQUIRED',selection:null});expect(JSON.stringify(result)).not.toContain('AREA_PRIVADA');
  });
  it('lee el conflicto interárea después del límite de inicios sin ampliar la oferta',async()=>{
    const night={...slot('last-night','a','2026-10-17','20:00','23:00'),...templateWindow('2026-10-17',{startTime:'21:00',endTime:'08:00',crossesMidnight:true,breakMinutes:0,breakPaid:false})};
    const overlap=slot('outside-start','a','2026-10-18','00:00','09:00','PRIVATE_OTHER_AREA');
    const db=database([night,overlap]);
    db.scheduleSlot.findMany.mockImplementation(async(...args:unknown[])=>{
      const query=args[0] as {where:{plan:{departmentId?:string};startAt?:{lt:Date};endAt?:{gt:Date};OR?:Array<{startAt?:{lt:Date};endAt?:{gt:Date}}>}};
      const window=query.where.startAt?query.where:query.where.OR![0]!;
      return [night,overlap].filter(row=>(!query.where.plan.departmentId||row.plan.departmentId===query.where.plan.departmentId)&&row.startAt!<window.startAt!.lt&&row.endAt!>window.endAt!.gt);
    });
    const result=await previewSubstitutionAvailability(actor,{...policy(),expiresAt:new Date('2026-10-22T00:00:00Z')},work(),now,tx(db));
    expect(result).toMatchObject({state:'REVIEW_REQUIRED',reasonCode:'PLANNING_CONFLICT',selection:null});
    expect(result.searchUntil.toISOString()).toBe('2026-10-18T03:00:00.000Z');
    expect(db.scheduleSlot.findMany).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OTHER_AREA');
  });
  it('ausencia/vacaciones publicadas vetan la franja, LIBRE conserva semántica por fecha',async()=>{
    for(const kind of ['AUSENCIA','VACACIONES','LIBRE']){
      const absent={...slot('absence','a'),kind,startAt:null,endAt:null};
      expect((await previewSubstitutionAvailability(actor,policy(),work(),now,tx(database([slot(),absent])))).state).toBe('REVIEW_REQUIRED');
    }
  });
  it('HK conserva veto original y valida también indisponibilidad futura',async()=>{
    const p={...policy(),configuration:{...config,kind:'housekeeping' as const}},w={...work(),kind:'housekeeping' as const,workDate:'2026-10-03',version:1};
    const db=database();db.housekeepingDayMember.findMany.mockResolvedValue([{userId:'a',workDate:'2026-10-05'}] as never);
    expect((await previewSubstitutionAvailability(actor,p,w,now,tx(db))).state).toBe('REVIEW_REQUIRED');
    expect(access.worker).toHaveBeenCalledWith(tx(db),'area','a','2026-10-03');expect(w.workDate).toBe('2026-10-03');
  });
  it('una cuenta HK exclusiva no se propone para tarea genérica',async()=>{
    const db=database();db.user.findMany.mockResolvedValue([{...person('a'),role:{key:'HK',permissions:[{permission:{key:'housekeeping.work'}}]}}] as never);
    expect((await previewSubstitutionAvailability(actor,policy(),work(),now,tx(db))).selection).toBeNull();
  });
  it('delegación HK debe conservar autoridad en el instante futuro',async()=>{
    const p={...policy(),configuration:{...config,kind:'housekeeping' as const}},w={...work(),kind:'housekeeping' as const,workDate:'2026-10-04',version:1};
    const delegated={...actor,roleKey:'CUSTOM'};
    const db=database();db.housekeepingDelegation.findMany.mockResolvedValue([{startsAt:new Date(now.getTime()-1000),endsAt:new Date(now.getTime()+1000)}] as never);
    expect((await previewSubstitutionAvailability(delegated,p,w,now,tx(db))).state).toBe('REVIEW_REQUIRED');
  });
});


describe('cursor futuro por fila y evidencia reutilizable',()=>{
  it('reanuda la fila siguiente después de presupuesto parcial',()=>{
    const cursor=advanceSubstitutionScan(3,7,25,4);
    expect(substitutionScanCursor(cursor)).toEqual({page:3,offset:8});
    expect(substitutionScanCursor(advanceSubstitutionScan(3,24,25,4))).toEqual({page:4,offset:0});
  });
  it('alcanza otras páginas y vuelve a esperas anteriores al límite100',()=>{
    expect(advanceSubstitutionScan(100,24,25,101)).toBe(1);
    expect(substitutionScanCursor(2500)).toEqual({page:100,offset:24});
    expect(substitutionScanCursor(2501)).toEqual({page:1,offset:0});
    expect(substitutionScanCursor(-1)).toEqual({page:1,offset:0});
  });
  it('una página vacía o reducida no conserva un offset imposible',()=>{
    expect(substitutionScanCursor(advanceSubstitutionScan(3,-1,0,1))).toEqual({page:1,offset:0});
    expect(substitutionScanCursor(advanceSubstitutionScan(3,2,3,4))).toEqual({page:4,offset:0});
  });
  it('reutiliza consulta de horarios/personas/alcance dentro de simulación, no entre versiones distintas',async()=>{
    const db=database(),cache=new Map();
    await previewSubstitutionAvailability(actor,policy(),work(),now,tx(db),false,cache);
    await previewSubstitutionAvailability(actor,policy(),{...work(),id:'work2'},now,tx(db),false,cache);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);expect(db.scheduleSlot.findMany).toHaveBeenCalledTimes(2);expect(access.areas).toHaveBeenCalledTimes(1);
    await previewSubstitutionAvailability(actor,{...policy(),version:2},work(),now,tx(db),false,cache);
    expect(db.scheduleSlot.findMany).toHaveBeenCalledTimes(4);
  });
  it('explica el veto original HK de carryover sin cambiar fecha ni divulgar notas',async()=>{
    const p={...policy(),configuration:{...config,kind:'housekeeping' as const}},w={...work(),kind:'housekeeping' as const,workDate:'2026-10-03',version:1};
    const db=database();db.housekeepingDayMember.findMany.mockResolvedValue([{userId:'a',workDate:'2026-10-03'}] as never);
    const result=await previewSubstitutionAvailability(actor,p,w,now,tx(db));
    expect(result).toMatchObject({state:'REVIEW_REQUIRED',reasonCode:'HK_ORIGINAL_DATE_UNAVAILABLE',selection:null});expect(w.workDate).toBe('2026-10-03');
  });
});
