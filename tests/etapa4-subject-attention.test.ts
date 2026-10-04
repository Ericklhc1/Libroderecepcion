import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,createShift,ROLE_KEYS} from './helpers';
import {requestSubjectAttention} from '@/server/services/subject-attention';
import {createEntry,getEntry} from '@/server/services/entries';
import {changeTaskStatus,updateTask} from '@/server/services/tasks';
import {changeHkWork} from '@/server/services/housekeeping-work';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
describe('AROH Simple · solicitar atención sin transcripción',()=>{
  beforeAll(seedCatalog);beforeEach(resetOperationalData);
  async function fixture(){
    const actor=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const room=await prisma.room.findUniqueOrThrow({where:{number:'512'}});
    const maintenance=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const source=await createEntry(actor,{type:'NOVEDAD',title:'Atender necesidad 512',description:'Conservar contexto original',roomId:room.id,priority:'ALTA',requiresFollowUp:false,tags:[]});
    await prisma.user.update({where:{id:actor.id},data:{departmentId:maintenance.id}});
    const input={entryId:source.id,departmentId:maintenance.id,requestKey:randomUUID(),revision:source.updatedAt.toISOString()};
    return{actor,source,room,maintenance,hk,input};
  }
  it('conserva contexto y folio del origen y permite resolver con resultado allí visible',async()=>{
    const f=await fixture();const result=await requestSubjectAttention(f.actor,{...f.input,assigneeId:f.actor.id});
    // Asignación sólo dentro del área vigente.
    expect(result.kind).toBe('task');
    const task=await prisma.task.findUniqueOrThrow({where:{id:result.id}});
    expect(task).toMatchObject({entryId:f.source.id,title:f.source.title,description:f.source.description,roomId:f.room.id,departmentId:f.maintenance.id,priority:'ALTA'});
    await changeTaskStatus(f.actor,{id:task.id,status:'ACEPTADA'});
    await expect(changeTaskStatus(f.actor,{id:task.id,status:'COMPLETADA'})).rejects.toThrow('resultado');
    await changeTaskStatus(f.actor,{id:task.id,status:'COMPLETADA',evidenceProvided:'Equipo reparado y comprobado'});
    expect(await prisma.task.count({where:{entryId:f.source.id,id:task.id,evidenceProvided:'Equipo reparado y comprobado'}})).toBe(1);
    expect((await requestSubjectAttention(f.actor,{...f.input,assigneeId:f.actor.id})).id).toBe(task.id);
    expect(await prisma.task.count({where:{entryId:f.source.id}})).toBe(1);
  });
  it('conserva el resultado realizado y exige evidencia al validar datos históricos',async()=>{
    const f=await fixture();const result=await requestSubjectAttention(f.actor,{...f.input,assigneeId:f.actor.id});
    await changeTaskStatus(f.actor,{id:result.id,status:'ACEPTADA'});
    await changeTaskStatus(f.actor,{id:result.id,status:'REALIZADA',evidenceProvided:'Resultado comprobado'});
    await expect(updateTask(f.actor,{id:result.id,evidenceProvided:' '})).rejects.toThrow('resultado');
    await prisma.task.update({where:{id:result.id},data:{evidenceProvided:null}});
    await expect(changeTaskStatus(f.actor,{id:result.id,status:'VALIDADA'})).rejects.toThrow('resultado');
    await changeTaskStatus(f.actor,{id:result.id,status:'VALIDADA',evidenceProvided:'Resultado verificado'});
  });
  it('dos solicitudes concurrentes al mismo asunto conservan una atención y una auditoría nativa',async()=>{
    const f=await fixture();const [first,second]=await Promise.all([requestSubjectAttention(f.actor,f.input),requestSubjectAttention(f.actor,{...f.input,requestKey:randomUUID()})]);
    expect(first.id).toBe(second.id);
    const created=await prisma.task.findUniqueOrThrow({where:{id:first.id}});
    const winningInput={...f.input,requestKey:created.procedureOccurrenceKey!.split(':')[2]!};
    await prisma.task.update({where:{id:first.id},data:{assigneeId:f.actor.id}});
    expect((await requestSubjectAttention(f.actor,f.input)).id).toBe(first.id);
    await expect(requestSubjectAttention(f.actor,{...winningInput,assigneeId:f.actor.id})).rejects.toThrow('reintento');
    expect(await prisma.task.count({where:{entryId:f.source.id}})).toBe(1);
    expect(await prisma.auditLog.count({where:{entity:'Task',entityId:first.id,action:'CREAR'}})).toBe(1);
    await expect(requestSubjectAttention(f.actor,{...f.input,entryId:'otro-origen'})).rejects.toThrow();
  });
  it('utiliza Housekeeping y devuelve el resultado al mismo origen, sin una tarea paralela',async()=>{
    const f=await fixture();const worker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    await prisma.user.update({where:{id:worker.id},data:{departmentId:f.hk.id}});
    const input={...f.input,departmentId:f.hk.id,assigneeId:worker.id};
    const [a,b]=await Promise.all([requestSubjectAttention(f.actor,input),requestSubjectAttention(f.actor,input)]);expect(a.id).toBe(b.id);
    const work=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:a.id}});
    expect(work).toMatchObject({sourceEntryId:f.source.id,title:null,description:null,roomId:f.room.id});
    const act=async(action:'RECIBIR'|'COMENZAR'|'TERMINAR',note='Trabajo atendido')=>{const current=await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:a.id}});return changeHkWork(worker,{id:a.id,version:current.version,action,note});};
    await act('RECIBIR');await act('COMENZAR');await act('TERMINAR');
    expect((await getEntry(f.source.id)).housekeepingRequest?.resolution).toContain('Trabajo atendido');
    expect(await prisma.task.count({where:{entryId:f.source.id}})).toBe(0);
  });
  it('una nueva atención reabre Housekeeping con permiso y conserva sus reintentos históricos',async()=>{
    const f=await fixture();const input={...f.input,departmentId:f.hk.id};
    const first=await requestSubjectAttention(f.actor,input);
    await prisma.housekeepingRequest.update({where:{id:first.id},data:{status:'RESUELTO',resolution:'Resultado anterior'}});
    const retry={...input,requestKey:randomUUID()};
    expect(await requestSubjectAttention(f.actor,retry)).toMatchObject({id:first.id,existing:false});
    expect(await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:first.id}})).toMatchObject({status:'PENDIENTE',resolution:null});
    expect(await requestSubjectAttention(f.actor,retry)).toMatchObject({id:first.id,existing:true});
    expect(await requestSubjectAttention(f.actor,input)).toMatchObject({id:first.id,existing:true});
    expect(await prisma.housekeepingEvent.count({where:{requestId:first.id,action:'REABRIR'}})).toBe(1);
    await prisma.housekeepingRequest.update({where:{id:first.id},data:{status:'RESUELTO'}});
    expect(await requestSubjectAttention(f.actor,{...f.input,requestKey:randomUUID()})).toMatchObject({kind:'task',existing:false});
  });
  it('un reintento conserva el trabajo derivado y otra solicitud no declara atención de un área distinta',async()=>{
    const f=await fixture();const first=await requestSubjectAttention(f.actor,f.input);
    await expect(requestSubjectAttention(f.actor,{...f.input,departmentId:f.hk.id,requestKey:randomUUID()})).rejects.toThrow('otra área');
    await prisma.task.update({where:{id:first.id},data:{departmentId:f.hk.id}});
    expect((await requestSubjectAttention(f.actor,f.input)).id).toBe(first.id);
    await expect(requestSubjectAttention(f.actor,{...f.input,departmentId:f.hk.id})).rejects.toThrow('reintento');
    expect(await prisma.task.count({where:{entryId:f.source.id}})).toBe(1);
    const other=await createEntry(f.actor,{type:'NOVEDAD',title:'Atención especializada existente',description:'Mismo contexto',roomId:f.room.id,priority:'MEDIA',requiresFollowUp:false,tags:[]});
    const hkInput={entryId:other.id,departmentId:f.hk.id,requestKey:randomUUID(),revision:other.updatedAt.toISOString()};
    const hkWork=await requestSubjectAttention(f.actor,hkInput);
    await expect(requestSubjectAttention(f.actor,{entryId:other.id,departmentId:f.maintenance.id,requestKey:randomUUID(),revision:other.updatedAt.toISOString()})).rejects.toThrow('otra área');
    expect(await prisma.task.count({where:{entryId:other.id}})).toBe(0);
    await prisma.housekeepingRequest.update({where:{id:hkWork.id},data:{departmentId:f.maintenance.id}});
    expect((await requestSubjectAttention(f.actor,hkInput)).id).toBe(hkWork.id);
    await expect(requestSubjectAttention(f.actor,{...hkInput,departmentId:f.maintenance.id})).rejects.toThrow('reintento');
  });
  it('no permite datos obsoletos, asignación ajena al área ni lectura por cuenta exclusiva',async()=>{
    const f=await fixture();const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    await expect(requestSubjectAttention(f.actor,{...f.input,revision:'2020-01-01T00:00:00.000Z'})).rejects.toThrow('cambió');
    await expect(requestSubjectAttention(f.actor,{...f.input,assigneeId:maid.id})).rejects.toThrow('área');
    await expect(requestSubjectAttention(maid,f.input)).rejects.toThrow();
    expect(await prisma.task.count({where:{entryId:f.source.id}})).toBe(0);
  });
  it('Recepción deriva con turno activo y conserva la asignación especializada del área',async()=>{
    const f=await fixture();const reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    await expect(requestSubjectAttention(reception,{...f.input,departmentId:f.hk.id})).rejects.toThrow('turno');
    const shift=await createShift({userId:reception.id,type:'DIA',status:'ACTIVO'});
    await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id,userId:reception.id},data:{activatedAt:new Date()}});
    const source=await createEntry(reception,{type:'NOVEDAD',title:'Recepción necesita reposición',description:'Conservar necesidad de Recepción',roomId:f.room.id,priority:'MEDIA',requiresFollowUp:false,tags:[]});
    const input={entryId:source.id,departmentId:f.hk.id,requestKey:randomUUID(),revision:source.updatedAt.toISOString()};
    const worker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    await prisma.user.update({where:{id:worker.id},data:{departmentId:f.hk.id}});
    await expect(requestSubjectAttention(reception,{...input,assigneeId:worker.id})).rejects.toThrow('asignación');
    const result=await requestSubjectAttention(reception,input);
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:result.id}}))).toMatchObject({sourceEntryId:source.id,createdById:reception.id,assignedToId:null});
    expect(await prisma.task.count({where:{entryId:source.id}})).toBe(0);
  });
});
