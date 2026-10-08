import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditAction, EntryType, ShiftType, ShiftStatus } from '@prisma/client';
import { createUser, createShift, openShiftAs, seedCatalog, resetOperationalData, prisma, ROLE_KEYS } from './helpers';
import { prepareHandover, receiveHandover, confirmHandoverReviewStep, sendHandover, closeShift } from '@/server/services/shifts';
import { listPendingClosureReviews, reviewShiftClosure } from '@/server/services/closure-review';
import { supervisionAttentionCounts, getSupervisionData } from '@/server/services/supervision';
import { createEntry } from '@/server/services/entries';
import { buildHandoverSnapshot, visibleSnapshotItems } from '@/server/services/handover-snapshot';
import { getBookItems } from '@/server/services/book';
import { getWebPushPayload } from '@/server/services/web-push';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { markReadableNotifications } from '@/server/services/notification-access';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import type { CurrentUser } from '@/server/auth/current-user';

let reception: CurrentUser, supervisor: CurrentUser;
async function sentShift() {
  const shift = await createShift({userId:reception.id,type:ShiftType.DIA});
  await openShiftAs(reception,shift); await receiveHandover(reception,{shiftId:shift.id});
  const handover=await prepareHandover(reception,shift.id);
  await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
  await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
  await sendHandover(reception,{shiftId:shift.id});
  return {shift,handover};
}
async function notice(author=supervisor, extra: Partial<Parameters<typeof createEntry>[1]>={}) {
  return createEntry(author,{type:EntryType.NOVEDAD,title:'Novedad operativa para recepción',description:'Descripción completa para recepción.',priority:'MEDIA',tags:[],requiresFollowUp:false,...extra});
}
describe('AROH 1.64 · impresión y cierre exclusivo de Supervisión',()=>{
beforeAll(seedCatalog);

beforeEach(async()=>{await resetOperationalData(); reception=await createUser({roleKey:ROLE_KEYS.RECEPTIONIST}); supervisor=await createUser({roleKey:ROLE_KEYS.SUPERVISOR});});

for(const roleKey of [ROLE_KEYS.SUPERVISOR,ROLE_KEYS.SYSTEM_ADMIN])it(`avisos históricos de cierre exigen shift.manage vigente para ${roleKey}`,async()=>{
    const reader=await createUser({roleKey});
    const alert=await prisma.alert.create({data:{title:'Validar cierre de turno',type:'OTRO',dedupeKey:'shift-validation:synthetic-permission'}});
    const task=await prisma.task.create({data:{title:alert.title,createdById:supervisor.id,alertId:alert.id}});
    const notices=await Promise.all([['Alert',alert.id],['Task',task.id]].map(([entity,entityId])=>prisma.notification.create({data:{userId:reader.id,type:'ACCION_REQUERIDA',title:alert.title,entity,entityId}})));
    const ordinary=await prisma.notification.create({data:{userId:reader.id,type:'ACTUALIZACION_OPERATIVA',title:'Aviso ordinario'}});
    const endpoint=`https://push.invalid/closure-permission-${roleKey}`;await prisma.pushSubscription.create({data:{userId:reader.id,endpoint,createdAt:new Date(Date.now()-10000)}});
    expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual(expect.arrayContaining(notices.map(n=>n.id)));
    const role=await prisma.role.findUniqueOrThrow({where:{key:roleKey}});const permission=await prisma.permission.findUniqueOrThrow({where:{key:'shift.manage'}});
    await prisma.rolePermission.deleteMany({where:{roleId:role.id,permissionId:permission.id}});
    try{
      expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual([ordinary.id]);
      expect((await getWebPushPayload({userId:reader.id,endpoint})).items.map(n=>n.id)).toEqual([ordinary.id]);
      for(const n of notices)expect(await markReadableNotifications(reader.id,n.id)).toMatchObject({count:0});
      expect(await prisma.notification.count({where:{id:{in:notices.map(n=>n.id)},readAt:null}})).toBe(2);
    }finally{await prisma.rolePermission.create({data:{roleId:role.id,permissionId:permission.id}});}
    expect((await getNotificationFeedForUser(reader.id)).items.map(n=>n.id)).toEqual(expect.arrayContaining(notices.map(n=>n.id)));
  });

it('el contador de revisión usa la cola canónica y no suma el cierre como alerta crítica',async()=>{
    const shift=await createShift({userId:reception.id,type:'DIA'});await prisma.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date()}});const review=await getSupervisionData(supervisor);expect(supervisionAttentionCounts(review.blocks)).toEqual({critical:0,pendingClosures:1});expect(review.blocks.find(b=>b.key==='cierres-validacion')?.rows.map(r=>r.id)).toContain(shift.id);
  });

for(const kind of ['task','closure'] as const)it(`un urgente histórico ${kind} excluido no bloquea FINAL ni envío, sin regenerar ni borrar evidencia`,async()=>{
    const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);
    let refType='task',refId:string|null=null,title='Urgente de tarea histórica';
    if(kind==='closure'){const alert=await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Validar cierre de turno',dedupeKey:'shift-validation:synthetic-old-draft'}});refType='alert';refId=alert.id;title=alert.title;}
    const old=await prisma.handoverItem.create({data:{handoverId:handover.id,level:'URGENTE',section:kind==='task'?'Tareas pendientes':'Novedades activas',title,refType,refId,order:0}});
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
    const final=await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'});
    expect(final.urgentAcknowledgedAt).toBeNull();
    const sent=await sendHandover(reception,{shiftId:shift.id});
    expect(sent.status).toBe('ENVIADA');expect(sent.snapshot).toMatchObject({counts:{urgente:0}});
    expect(await prisma.handoverItem.findUnique({where:{id:old.id}})).not.toBeNull();
    expect(await visibleSnapshotItems(reception,[old],true)).toEqual([]);
  });

it('un urgente visible todavía exige reconocimiento y se cuenta al enviar',async()=>{
    await notice(supervisor,{priority:'CRITICA'});
    const shift=await createShift({userId:reception.id,type:ShiftType.DIA});await openShiftAs(reception,shift);await receiveHandover(reception,{shiftId:shift.id});
    const handover=await prepareHandover(reception,shift.id);await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'PENDINGS'});
    await expect(confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL'})).rejects.toThrow(/Hay puntos urgentes/);
    await confirmHandoverReviewStep(reception,{handoverId:handover.id,step:'FINAL',urgentAcknowledged:true});
    expect((await sendHandover(reception,{shiftId:shift.id})).snapshot).toMatchObject({counts:{urgente:1}});
  });

it('el resumen activo, resuelto y la lectura histórica sólo incluyen NOVEDAD/INCIDENCIA como entradas',async()=>{
    const shift=await createShift({userId:reception.id,type:'DIA'});const rows=[];
    for(const type of Object.values(EntryType))for(const resolved of [false,true])rows.push(await prisma.operationalEntry.create({data:{type,title:`TIPO_${type}_${resolved?'RESUELTO':'ACTIVO'}`,description:'Contenido sintético por tipo',createdById:supervisor.id,shiftId:shift.id,status:resolved?'RESUELTO':'ABIERTO',closedAt:resolved?new Date():null}}));
    const snapshot=await buildHandoverSnapshot(reception,new Date(),{shiftId:shift.id});const allowed=rows.filter(e=>e.type==='NOVEDAD'||e.type==='INCIDENCIA');expect(snapshot.filter(i=>i.refType==='entry').map(i=>i.refId).sort()).toEqual(allowed.map(e=>e.id).sort());
    const historical=rows.map(e=>({refType:'entry',refId:e.id,title:e.title,detail:e.description,section:'Novedades activas',level:'URGENTE' as const}));
    expect((await visibleSnapshotItems(reception,historical,true)).map(i=>i.refId).sort()).toEqual(allowed.map(e=>e.id).sort());expect(await prisma.operationalEntry.count()).toBe(rows.length);
  });

it('el cierre real con trigger nuevo crea una única acción y auditoría, sin alerta, tarea ni novedad',async()=>{
    const {shift,handover}=await sentShift();
    const closed=await closeShift(reception,{shiftId:shift.id});
    expect(closed.closureReviewRequestedAt).not.toBeNull();
    expect(await prisma.alert.count({where:{dedupeKey:`shift-validation:${shift.id}`}})).toBe(0);
    expect(await prisma.task.count({where:{shiftId:shift.id}})).toBe(0);
    expect(await prisma.operationalEntry.count()).toBe(0);
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,action:AuditAction.CREAR,summary:{startsWith:'Acción pendiente'}}})).toBe(1);
    await prisma.shift.update({where:{id:shift.id},data:{status:ShiftStatus.CERRADO}});
    expect(await prisma.auditLog.count({where:{entity:'Shift',entityId:shift.id,action:AuditAction.CREAR,summary:{startsWith:'Acción pendiente'}}})).toBe(1);
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const rows=(await getSupervisionData(supervisor)).blocks.find(b=>b.key==='cierres-validacion')!.rows;
    expect(rows).toMatchObject([{id:shift.id,href:`/supervision/cierres/${shift.id}`}]);
    expect(rows[0]!.ref).toContain('DIA');
    expect(JSON.stringify(await buildHandoverSnapshot(reception))).not.toContain('Validar cierre');
    expect(await prisma.shiftHandover.findUnique({where:{id:handover.id}})).not.toBeNull();
  });

it('la acción y su auditoría se revierten juntas si falla la transacción de cierre',async()=>{
    const {shift}=await sentShift();
    await expect(prisma.$transaction(async tx=>{await tx.shift.update({where:{id:shift.id},data:{status:'CERRADO',actualEnd:new Date(),closedById:reception.id}});throw Error('rollback sintético');})).rejects.toThrow('rollback sintético');
    expect((await prisma.shift.findUniqueOrThrow({where:{id:shift.id}})).closureReviewRequestedAt).toBeNull();
    expect(await prisma.auditLog.count({where:{entityId:shift.id,summary:{startsWith:'Acción pendiente'}}})).toBe(0);
  });

it('validar/observar exige supervisor, evidencia y revisión vigente; observar mantiene pendiente',async()=>{
    const {shift}=await sentShift(); const closed=await closeShift(reception,{shiftId:shift.id});
    const input={shiftId:shift.id,decision:'OBSERVADA' as const,note:'Falta comprobante del depósito.',revision:closed.updatedAt.toISOString()};
    await expect(reviewShiftClosure(reception,input)).rejects.toThrow();
    await expect(reviewShiftClosure(supervisor,{...input,note:' '})).rejects.toThrow();
    const observed=await reviewShiftClosure(supervisor,input);
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    await expect(reviewShiftClosure(supervisor,{...input,decision:'VALIDADA'})).rejects.toThrow(/cambió/);
    const validated=await reviewShiftClosure(supervisor,{...input,decision:'VALIDADA',note:'Comprobantes revisados; depósito conforme.',revision:observed.updatedAt.toISOString()});
    expect(validated.closureReviewDecision).toBe('VALIDADA');
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).not.toContain(shift.id);
    expect(await prisma.auditLog.count({where:{entityId:shift.id,action:'CAMBIO_ESTADO',summary:{contains:'Cierre '}}})).toBe(2);
  });

it('conserva alertas/tareas históricas, las oculta a recepción y dirige su acción al cierre concreto',async()=>{
    const {shift}=await sentShift(); await closeShift(reception,{shiftId:shift.id});
    await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const alert=await prisma.alert.create({data:{type:'OTRO',level:'CRITICA',title:'Validar cierre de turno',dedupeKey:`shift-validation:${shift.id}`}});
    const task=await prisma.task.create({data:{title:'Validar cierre de turno',createdById:supervisor.id,alertId:alert.id,shiftId:shift.id}});
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const review=await getSupervisionData(supervisor);
    expect(review.blocks.find(b=>b.key==='alertas')!.rows.map(r=>r.id)).not.toContain(alert.id);
    expect(review.blocks.find(b=>b.key==='cierres-validacion')!.rows[0]!.href).toBe(`/supervision/cierres/${shift.id}`);
    expect((await getBookItems({kinds:['task','alert']},reception)).items.map(i=>i.id)).not.toContain(task.id);
    expect(await buildHandoverSnapshot(reception)).toHaveLength(0);
    const historic=[{section:'Alertas activas',level:'URGENTE' as const,title:alert.title,detail:'Histórico',refType:'alert',refId:alert.id}];
    expect(await visibleSnapshotItems(reception,historic,true)).toHaveLength(0);
    expect(await prisma.alert.findUnique({where:{id:alert.id}})).toMatchObject({title:alert.title,status:'NUEVA'});
    expect(await prisma.task.findUnique({where:{id:task.id}})).not.toBeNull();
  });

it('Gestionar diferencia y garantía abre los registros concretos',async()=>{
    const {shift,handover}=await sentShift(); await closeShift(reception,{shiftId:shift.id});
    const alert=await prisma.alert.create({data:{title:'Diferencia de caja',message:'Falta USD 25',type:'OTRO',level:'CRITICA',handoverId:handover.id}});
    const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:reception.id,guestName:'Prueba concreta'}});
    const review=await getSupervisionData(supervisor);
    expect(review.blocks.find(b=>b.key==='alertas')!.rows.find(r=>r.id===alert.id)!.href).toBe(`/turno/entrega/${handover.id}`);
    expect(review.blocks.find(b=>b.key==='garantias')!.rows.find(r=>r.id===g.id)!.href).toBe(`/caja/garantias/${g.id}`);
  });

it('las novedades operativas de Supervisión viajan en la entrega',async()=>{
    const e=await notice();
    expect((await buildHandoverSnapshot(reception)).map(i=>i.refId)).toContain(e.id);
    expect((await getBookItems({kinds:['entry']},reception)).items.map(i=>i.id)).toContain(e.id);
  });

it('observar una alerta histórica materializa el pendiente aunque luego se resuelva la señal antigua',async()=>{
    const {shift}=await sentShift();await closeShift(reception,{shiftId:shift.id});
    const legacyShift=await prisma.shift.update({where:{id:shift.id},data:{closureReviewRequestedAt:null}});
    const a=await prisma.alert.create({data:{title:'Validar cierre de turno',type:'OTRO',dedupeKey:`shift-validation:${shift.id}`}});
    const observed=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'OBSERVADA',note:'Comprobante pendiente',revision:legacyShift.updatedAt.toISOString()});
    expect(observed.closureReviewRequestedAt).not.toBeNull();
    await prisma.alert.update({where:{id:a.id},data:{status:'RESUELTA'}});
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).toContain(shift.id);
    const validated=await reviewShiftClosure(supervisor,{shiftId:shift.id,decision:'VALIDADA',note:'Comprobante revisado',revision:observed.updatedAt.toISOString()});
    expect(validated.closureReviewDecision).toBe('VALIDADA');
    expect((await listPendingClosureReviews(supervisor)).map(s=>s.id)).not.toContain(shift.id);
  });

it('el relevo conserva la regla de alerta viva: resueltas/pospuestas futuras no se congelan',async()=>{
    const now=new Date();const e=await notice();
    const resolved=await prisma.alert.create({data:{type:'OTRO',title:'Resuelta',status:'RESUELTA'}});
    const future=await prisma.alert.create({data:{type:'OTRO',title:'Pospuesta futura',status:'POSPUESTA',snoozedUntil:new Date(now.getTime()+3600000),entryId:e.id}});
    const resumed=await prisma.alert.create({data:{type:'OTRO',title:'Pospuesta vencida',status:'POSPUESTA',snoozedUntil:new Date(now.getTime()-1000)}});
    const live=await prisma.alert.create({data:{type:'OTRO',title:'Alerta viva',status:'NUEVA'}});
    const ids=(await buildHandoverSnapshot(reception,now)).map(i=>i.refId);
    expect(ids).not.toContain(resolved.id);expect(ids).not.toContain(future.id);expect(ids).toContain(resumed.id);expect(ids).toContain(live.id);
  });

it('Fronti lee sólo la garantía o cierre abiertos, con permisos y sin fallback general',async()=>{
    const g=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:50000,createdById:reception.id,guestName:'Garantía concreta'}});
    const unrelated=await prisma.guarantee.create({data:{kind:'EFECTIVO',state:'PENDIENTE',currency:'CLP',amount:10000,createdById:reception.id,guestName:'NO_MEZCLAR_GARANTIA'}});
    const gp=resolveFrontiPageContext({pathname:`/caja/garantias/${g.id}`});
    const result=await executeFrontiPageContextTool(reception,gp);expect(result).toMatchObject({snapshot:{found:true,id:g.id,guestName:g.guestName,outstandingAmount:50000}});expect(JSON.stringify(result)).not.toContain(unrelated.guestName);
    expect(await executeFrontiPageContextTool(reception,resolveFrontiPageContext({pathname:'/caja/garantias/no-existe'}))).toMatchObject({snapshot:{found:false}});
    await expect(executeFrontiPageContextTool({...reception,permissions:[]},gp)).rejects.toThrow(/permiso/);
    const {shift}=await sentShift();await closeShift(reception,{shiftId:shift.id});
    const sp=resolveFrontiPageContext({pathname:`/supervision/cierres/${shift.id}`});
    expect(await executeFrontiPageContextTool(supervisor,sp)).toMatchObject({snapshot:{found:true,id:shift.id,pending:true,href:`/supervision/cierres/${shift.id}`}});
    await expect(executeFrontiPageContextTool(reception,sp)).rejects.toThrow();
    expect(await executeFrontiPageContextTool(supervisor,resolveFrontiPageContext({pathname:'/supervision/cierres/no-existe'}))).toMatchObject({snapshot:{found:false}});
  });
});
