import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {prisma,seedCatalog,resetOperationalData,createUser,ROLE_KEYS} from './helpers';
import {createEntry,changeEntryStatus,getEntry} from '@/server/services/entries';
import {distributeSubject,decideAreaAttention,listAreaAttentions,getAreaAttention} from '@/server/services/subject-distribution';
import {getCoordinationBoard,coordinateWork} from '@/server/services/coordination';
import {createTask,assignTask,changeTaskStatus} from '@/server/services/tasks';
import {changeHkWork} from '@/server/services/housekeeping-work';
import {queueOperationalMail} from '@/server/services/operational-mail';
import {getFormOptions} from '@/server/services/options';
vi.mock('@/server/services/web-push-scheduler',()=>({scheduleWebPushForUsers:vi.fn()}));
vi.mock('@/server/services/operational-mail',async original=>({...await original<object>(),queueOperationalMail:vi.fn(async()=>null),tryDeliverOperationalMail:vi.fn()}));
vi.mock('@/server/ai/fronti-proactive-scheduler',()=>({scheduleFrontiProactiveSweep:vi.fn()}));
describe('Auditoría: distribución y resultado por área',()=>{
  const syntheticRoleIds:string[]=[];
  beforeAll(async()=>{await seedCatalog();await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "HousekeepingRequest_sourceEntryId_key"');});
  beforeEach(async()=>{vi.stubEnv('AROH_SUBJECT_AREA_DISTRIBUTION_ENABLED','true');await resetOperationalData();});
  afterEach(()=>vi.unstubAllEnvs());
  afterAll(async()=>{await resetOperationalData();await prisma.rolePermission.deleteMany({where:{roleId:{in:syntheticRoleIds}}});await prisma.role.deleteMany({where:{id:{in:syntheticRoleIds}}});await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "HousekeepingRequest_sourceEntryId_key" ON "HousekeepingRequest"("sourceEntryId")');});
  async function fixture(){
    const admin=await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const hk=await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const maintenance=await prisma.department.findUniqueOrThrow({where:{key:'MANTENIMIENTO'}});
    const publicArea=await prisma.department.findUniqueOrThrow({where:{key:'AREAS_PUBLICAS'}});
    const supervisor=await createUser({roleKey:ROLE_KEYS.HK_SUPERVISOR});
    const maid=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});
    const technician=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});
    await prisma.user.update({where:{id:supervisor.id},data:{departmentId:hk.id}});supervisor.departmentId=hk.id;
    await prisma.user.update({where:{id:maid.id},data:{departmentId:hk.id}});maid.departmentId=hk.id;
    await prisma.user.update({where:{id:technician.id},data:{departmentId:maintenance.id}});technician.departmentId=maintenance.id;
    const source=await createEntry(admin,{type:'NOVEDAD',title:'Necesidad compartida 512',description:'Contexto canónico',priority:'ALTA',requiresFollowUp:false,tags:[]});
    const input={entryId:source.id,revision:source.updatedAt.toISOString(),requestKey:randomUUID(),departmentIds:[maintenance.id,hk.id,publicArea.id],location:'Zona común 5'};
    return{admin,hk,maintenance,publicArea,supervisor,maid,technician,source,input};
  }
  it('distribuye varias áreas sin copias ni trabajo prematuro y reintenta sin duplicar',async()=>{
    const f=await fixture();const [a,b]=await Promise.all([distributeSubject(f.admin,f.input),distributeSubject(f.admin,f.input)]);
    expect(a.map(r=>r.id).sort()).toEqual(b.map(r=>r.id).sort());
    expect(await prisma.operationalEntry.count()).toBe(1);expect(await prisma.task.count()).toBe(0);expect(await prisma.housekeepingRequest.count()).toBe(0);
    expect(await prisma.subjectAreaAttention.count({where:{entryId:f.source.id,status:'POR_REVISAR'}})).toBe(3);
    await expect(distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]})).rejects.toThrow('reintento');
    expect(await prisma.notification.count({where:{userId:f.supervisor.id,title:{contains:'Por revisar'}}})).toBe(1);
    expect((await listAreaAttentions(f.supervisor)).rows.some(r=>r.departmentId===f.hk.id)).toBe(true);
  });
  it('tomar conocimiento no publica ni asigna ni permite cerrar',async()=>{
    const f=await fixture();const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});
    const known=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'CONOCER'});
    expect(known).toMatchObject({status:'POR_REVISAR',knownById:f.supervisor.id,decisionAt:null,taskId:null,housekeepingId:null});
    await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'RESUELTO'})).rejects.toThrow('por revisar');
    await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'CERRADO'})).rejects.toThrow('por revisar');
    await expect(getAreaAttention(f.maid,row!.id)).rejects.toThrow();
    const informed=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:known.id,version:known.version,action:'INFORMAR',note:'Información comprobada, no requiere ejecución.'});
    expect(informed.status).toBe('INFORMADA');expect((await getAreaAttention(f.maid,row!.id)).id).toBe(row!.id);
    await changeEntryStatus(f.admin,{id:f.source.id,status:'CERRADO'});
  });
  it('rechaza una decisión sobre origen cambiado aunque la atención conserve su versión',async()=>{
    const f=await fixture();const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});
    const sourceRevision=f.source.updatedAt.toISOString();
    const current=await prisma.operationalEntry.update({where:{id:f.source.id},data:{description:'Contexto corregido que debe leerse antes de publicar.',updatedAt:new Date(f.source.updatedAt.getTime()+1000)}});
    const auditsBefore=await prisma.auditLog.count({where:{entity:'SubjectAreaAttention',entityId:row!.id}});
    await expect(decideAreaAttention(f.supervisor,{id:row!.id,version:row!.version,sourceRevision,action:'INFORMAR',note:'Decisión basada en texto anterior.'})).rejects.toThrow('asunto de origen cambió');
    expect(await prisma.subjectAreaAttention.findUniqueOrThrow({where:{id:row!.id}})).toMatchObject({version:row!.version,status:'POR_REVISAR',decisionAt:null});
    expect(await prisma.auditLog.count({where:{entity:'SubjectAreaAttention',entityId:row!.id}})).toBe(auditsBefore);
    const informed=await decideAreaAttention(f.supervisor,{id:row!.id,version:row!.version,sourceRevision:current.updatedAt.toISOString(),action:'INFORMAR',note:'Revisado el contexto corregido.'});
    expect(informed.status).toBe('INFORMADA');
  });
  it('jefatura devuelve aclaración sin responsable y Recepción responde en el mismo asunto',async()=>{
    const f=await fixture();const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});
    const asked=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'ACLARACION',note:'Indicar acceso a la zona.'});
    expect(asked.status).toBe('ACLARACION');expect(await prisma.task.count()).toBe(0);
    await expect(decideAreaAttention(f.maid,{sourceRevision:f.source.updatedAt.toISOString(),id:asked.id,version:asked.version,action:'RESPONDER',note:'Respuesta ajena'})).rejects.toThrow();
    const answer=await decideAreaAttention(f.admin,{sourceRevision:f.source.updatedAt.toISOString(),id:asked.id,version:asked.version,action:'RESPONDER',note:'Acceso por escalera central.'});
    expect(answer).toMatchObject({status:'POR_REVISAR',decisionNote:'Respuesta: Acceso por escalera central.'});
    await expect(decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:asked.id,version:asked.version,action:'CONOCER'})).rejects.toThrow('cambió');
  });
  it('HK y Áreas públicas se atienden en paralelo sobre un único origen',async()=>{
    const f=await fixture();const publicWorker=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});await prisma.user.update({where:{id:publicWorker.id},data:{departmentId:f.publicArea.id}});
    const rows=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id,f.publicArea.id],requiresValidation:true});
    const hk=rows.find(r=>r.departmentId===f.hk.id)!;const pub=rows.find(r=>r.departmentId===f.publicArea.id)!;
    const first=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:hk.id,version:hk.version,action:'ASIGNAR',assigneeId:f.maid.id,note:'Atender la necesidad.'});
    const second=await decideAreaAttention(f.admin,{sourceRevision:f.source.updatedAt.toISOString(),id:pub.id,version:pub.version,action:'ASIGNAR',assigneeId:publicWorker.id,note:'Atender la zona.'});
    expect(first.housekeepingId).not.toBe(second.housekeepingId);expect((await getEntry(f.source.id)).housekeepingRequests).toHaveLength(2);
    expect(await prisma.housekeepingRequest.count({where:{sourceEntryId:f.source.id,requiresInspection:true}})).toBe(2);expect(await prisma.task.count()).toBe(0);
    await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'RESUELTO'})).rejects.toThrow('Housekeeping');
  });
  it('urgencia toma la guardia explícita antes de publicación y revisión posterior independiente',async()=>{
    const f=await fixture();const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id],urgent:true,urgencyReason:'Agua en circulación requiere secado seguro.',urgentContacts:{[f.hk.id]:f.maid.id}});
    expect(row!.housekeepingId).toBeTruthy();expect(row!.status).toBe('POR_REVISAR');
    const claimed=await decideAreaAttention(f.maid,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'TOMAR_URGENCIA',note:'Disponible para atender ahora.'});
    expect(claimed.housekeeping?.assignedToId).toBe(f.maid.id);expect(claimed.status).toBe('POR_REVISAR');
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:row!.housekeepingId!}})).acknowledgedAt).toBeNull();
    const reviewed=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:claimed.id,version:claimed.version,action:'REVISAR_URGENCIA',note:'Revisada la atención y la seguridad.'});
    expect(reviewed.status).toBe('ASIGNADA');await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'CERRADO'})).rejects.toThrow('Housekeeping');
  });
  it('no infiere urgencia de importancia ni inventa guardia o plazo',async()=>{
    const f=await fixture();await expect(distributeSubject(f.admin,{...f.input,urgent:true,urgencyReason:'Riesgo real'})).rejects.toThrow('guardia');
    expect(await prisma.subjectAreaAttention.count()).toBe(0);
    const rows=await distributeSubject(f.admin,f.input);expect(rows.every(r=>!r.urgent)).toBe(true);expect((await getEntry(f.source.id)).dueAt).toBeNull();
  });
  it('rechaza asignación genérica inaccesible en crear, reasignar y coordinar y filtra opciones',async()=>{
    const f=await fixture();const input={title:'Atención',priority:'MEDIA' as const,tags:[],checklist:[],departmentId:f.hk.id};
    await expect(createTask(f.admin,{...input,assigneeId:f.maid.id})).rejects.toThrow('Housekeeping');
    const task=await createTask(f.admin,input);await expect(assignTask(f.admin,{id:task.id,assigneeId:f.maid.id})).rejects.toThrow('Housekeeping');
    await expect(coordinateWork(f.admin,{id:task.id,kind:'task',action:'ASIGNAR',requestKey:randomUUID(),updatedAt:task.updatedAt,ownerId:f.maid.id,nextAction:'Atender'})).rejects.toThrow('Housekeeping');
    expect((await getFormOptions(f.admin)).taskUsers?.some(p=>p.value===f.maid.id)).toBe(false);
  });
  it('sin responsable genera aviso al coordinador y aparece en la bandeja inicial',async()=>{
    const f=await fixture();const task=await createTask(f.admin,{title:'Mantenimiento sin persona',entryId:f.source.id,departmentId:f.maintenance.id,priority:'MEDIA',tags:[],checklist:[]});
    expect(await prisma.notification.count({where:{userId:f.technician.id,entityId:task.id,title:{contains:'Por revisar'}}})).toBe(1);
    expect((await getCoordinationBoard(f.technician,{departmentId:f.maintenance.id})).rows.some(r=>r.id===task.id)).toBe(true);
  });
  it.each(['RESUELTO','CANCELADO'])('HK %s devuelve el origen abierto a pendientes',async(status)=>{
    const f=await fixture();await prisma.housekeepingRequest.create({data:{requestKey:randomUUID(),sourceEntryId:f.source.id,departmentId:f.hk.id,workflowVersion:1,workKind:'ATENCION',workDate:'2026-10-05',location:'Zona sintética',createdById:f.admin.id,status,resolution:'Resultado del área'}});
    const rows=(await getCoordinationBoard(f.admin)).rows;expect(rows.filter(r=>r.id===f.source.id)).toHaveLength(1);expect(rows.find(r=>r.id===f.source.id)?.nextAction).toContain('Revisar');
  });
  it('resolver y cerrar bloquean tarea, seguimiento y otra área; guardan fecha separada',async()=>{
    const f=await fixture();const task=await createTask(f.admin,{title:'Trabajo obligatorio',entryId:f.source.id,assigneeId:f.admin.id,priority:'MEDIA',tags:[],checklist:[]});
    await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'RESUELTO'})).rejects.toThrow('trabajo');
    await changeTaskStatus(f.admin,{id:task.id,status:'COMPLETADA'});
    const follow=await prisma.followUp.create({data:{entryId:f.source.id,action:'Comprobar cierre',ownerId:f.admin.id,createdById:f.admin.id}});
    await expect(changeEntryStatus(f.admin,{id:f.source.id,status:'RESUELTO'})).rejects.toThrow('seguimiento');
    await prisma.followUp.update({where:{id:follow.id},data:{status:'CUMPLIDO'}});
    const resolved=await changeEntryStatus(f.admin,{id:f.source.id,status:'RESUELTO'});expect(resolved.resolvedAt).not.toBeNull();expect(resolved.closedAt).toBeNull();
    const closed=await changeEntryStatus(f.admin,{id:f.source.id,status:'CERRADO'});expect(closed.resolvedAt).toEqual(resolved.resolvedAt);expect(closed.closedAt).not.toBeNull();
    const reopened=await changeEntryStatus(f.admin,{id:f.source.id,status:'ABIERTO',reason:'Nueva necesidad'});expect(reopened.resolvedAt).toBeNull();
  });
  it('reutiliza distribución existente al agregar áreas y reintento mixto',async()=>{
    const f=await fixture();await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});
    const input={...f.input,requestKey:randomUUID()};const first=await distributeSubject(f.admin,input);const second=await distributeSubject(f.admin,input);expect(first.map(r=>r.id).sort()).toEqual(second.map(r=>r.id).sort());expect(await prisma.subjectAreaAttention.count()).toBe(3);
  });
  it('el resultado de tarea avisa al dueño original distinto de derivador y ejecutor',async()=>{
    const f=await fixture();const owner=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});await prisma.operationalEntry.update({where:{id:f.source.id},data:{ownerId:owner.id}});
    const task=await createTask(f.admin,{title:'Trabajo con retorno',entryId:f.source.id,assigneeId:f.technician.id,priority:'MEDIA',tags:[],checklist:[]});
    await changeTaskStatus(f.technician,{id:task.id,status:'COMPLETADA'});expect(await prisma.notification.count({where:{userId:owner.id,entityId:task.id,title:{contains:'completada'}}})).toBe(1);
  });
  it('reasignar HK avisa al responsable saliente además del entrante',async()=>{
    const f=await fixture();const other=await createUser({roleKey:ROLE_KEYS.HK_ATTENDANT});await prisma.user.update({where:{id:other.id},data:{departmentId:f.hk.id}});
    const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});const assigned=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'ASIGNAR',assigneeId:f.maid.id,note:'Atender'});
    await changeHkWork(f.supervisor,{id:assigned.housekeeping!.id,version:assigned.housekeeping!.version,action:'ASIGNAR',assignedToId:other.id,note:'Cambio de turno'});
    expect(await prisma.notification.count({where:{userId:f.maid.id,entity:'HousekeepingRequest',entityId:assigned.housekeepingId!}})).toBeGreaterThan(1);
  });
  it('el operador genérico sin jefatura no ve revisión interna hasta publicar',async()=>{
    const f=await fixture();const worker=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST});
    const role=await prisma.role.create({data:{key:`AREA_WORKER_${randomUUID()}`,name:'Ejecutor sin jefatura',level:10,operational:true,permissions:{create:[{permission:{connect:{key:'task.edit'}}},{permission:{connect:{key:'task.close'}}}]}}});
    syntheticRoleIds.push(role.id);
    await prisma.user.update({where:{id:worker.id},data:{roleId:role.id,departmentId:f.maintenance.id}});
    const reader={...worker,roleId:role.id,roleKey:role.key,departmentId:f.maintenance.id,permissions:['task.edit','task.close'] as typeof worker.permissions};
    const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.maintenance.id]});
    await expect(getAreaAttention(reader,row!.id)).rejects.toThrow();expect((await listAreaAttentions(reader)).rows).toHaveLength(0);
    await decideAreaAttention(f.technician,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'INFORMAR',note:'Información autorizada para el área.'});
    expect((await listAreaAttentions(reader)).rows.map(r=>r.id)).toContain(row!.id);
  });
  it('segunda atención conserva historial y reabre HK por su servicio nativo',async()=>{
    const f=await fixture();const [row]=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id]});
    let assigned=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:row!.id,version:row!.version,action:'ASIGNAR',assigneeId:f.maid.id,note:'Primera atención.'});
    let work=await changeHkWork(f.maid,{id:assigned.housekeeping!.id,version:assigned.housekeeping!.version,action:'COMENZAR'});
    work=await changeHkWork(f.maid,{id:work.id,version:work.version,action:'TERMINAR',note:'Resultado primero.'});
    const reopened=await decideAreaAttention(f.admin,{sourceRevision:f.source.updatedAt.toISOString(),id:assigned.id,version:assigned.version,action:'REABRIR',note:'Se necesita otra intervención.'});
    assigned=await decideAreaAttention(f.supervisor,{sourceRevision:f.source.updatedAt.toISOString(),id:reopened.id,version:reopened.version,action:'ASIGNAR',assigneeId:f.maid.id,note:'Atender nueva necesidad.'});
    expect(assigned.housekeepingId).toBe(work.id);expect(assigned.housekeeping?.status).toBe('PENDIENTE');
    expect(await prisma.housekeepingEvent.count({where:{requestId:work.id,action:'TERMINAR',note:'Resultado primero.'}})).toBe(1);
    expect(await prisma.housekeepingEvent.count({where:{requestId:work.id,action:'REABRIR'}})).toBe(1);
  });
  it('cierre concurrente y creación de intervención no pueden ganar ambos',async()=>{
    const f=await fixture();const attempts=await Promise.allSettled([changeEntryStatus(f.admin,{id:f.source.id,status:'CERRADO'}),createTask(f.admin,{title:'Intervención concurrente',entryId:f.source.id,assigneeId:f.admin.id,priority:'MEDIA',tags:[],checklist:[]})]);
    expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);
    const source=await getEntry(f.source.id);const pending=await prisma.task.count({where:{entryId:source.id,status:'PENDIENTE'}});
    expect(source.status==='CERRADO'&&pending>0).toBe(false);
  });

  it('los nuevos avisos y su trabajo materializado nunca encolan correo externo',async()=>{
    const f=await fixture();await prisma.user.updateMany({where:{id:{in:[f.supervisor.id,f.maid.id,f.technician.id]}},data:{email:'synthetic@example.test',emailNotificationsEnabled:true}});
    vi.mocked(queueOperationalMail).mockClear();
    const rows=await distributeSubject(f.admin,{...f.input,departmentIds:[f.hk.id,f.maintenance.id]});
    for(const row of rows)await decideAreaAttention(row.departmentId===f.hk.id?f.supervisor:f.technician,{sourceRevision:f.source.updatedAt.toISOString(),id:row.id,version:row.version,action:'ASIGNAR',assigneeId:row.departmentId===f.hk.id?f.maid.id:f.technician.id,note:'Asignación interna.'});
    expect(vi.mocked(queueOperationalMail)).not.toHaveBeenCalled();
  });

});
