import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, seedCatalog, resetOperationalData, createUser, createShift, ROLE_KEYS } from './helpers';
import { prisma as visiblePrisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { effectiveRolePermissions } from '@/lib/permissions';
import { formatCalendarDate } from '@/lib/format';
import { createTask } from '@/server/services/tasks';
import { createEntry, getSubjectEntry } from '@/server/services/entries';
import { getBookItems } from '@/server/services/book';
import { getCoordinationBoard } from '@/server/services/coordination';
import { getLiveCashState, insertCashMovement } from '@/server/services/live-cash';
import { getSharedShiftMemoryContext } from '@/server/ai/shift-memory';
import { getChatGlobalVersion } from '@/server/services/chat';
import { createHkWork, prepareHkDay } from '@/server/services/housekeeping-work';
import { hotelDateKey } from '@/domain/time';
import { removeShiftMember } from '@/server/services/shifts';
import { cleanupAdminRecord, type CleanupKind } from '@/server/services/admin-cleanup';
import { cleanupAdminRecordAction, cleanupShiftMemberAction } from '@/server/actions/admin-cleanup';
import { updateEntryAction, deleteEntryAction } from '@/server/actions/entries';
import { beginSupervisionOpening, completeSupervisionOpening, cancelSupervisionOpening, getMyOpenSupervisionShift, getSupervisionOpeningReadiness, listCancelableSupervisionOpenings } from '@/server/services/supervision-center';
import { cancelSupervisionOpeningAction } from '@/server/actions/supervision-center';
import { supervisionOpeningExpired } from '@/domain/supervision-opening';
const auth = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock('@/server/auth/current-user', async original => ({ ...await original<object>(), getCurrentUserFresh: auth.current }));
vi.mock('@/server/services/legal-acceptance', () => ({ hasAcceptedCurrentTerms: async () => true }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/services/web-push-scheduler', () => ({ scheduleWebPushForUsers: vi.fn() }));
vi.mock('@/server/ai/fronti-proactive-scheduler', () => ({ scheduleFrontiProactiveSweep: vi.fn() }));

describe('Nivel 1: permisos, visibilidad y limpieza individual sobre motores vigentes', () => {
  let admin: CurrentUser, supervisor: CurrentUser, reception: CurrentUser, area: string;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    reception = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    area = (await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } })).id;
    auth.current.mockResolvedValue(admin);
  });
  const entry = () => createEntry(supervisor, { type: 'NOVEDAD', title: 'Solicitud sintética de Supervisión', description: 'Verificar dato de prueba', ownerId: supervisor.id, departmentId: area, priority: 'MEDIA', tags: [], requiresFollowUp: false });
  const clean = (kind: CleanupKind, id: string, revision: string, user = admin) => cleanupAdminRecord(user, { kind, id, revision, reason: 'Limpieza sintética autorizada', confirmation: 'ELIMINAR' });
  it('conserva 06-10 en la fecha operativa y la novedad de supervisor aparece en Novedades y sus responsabilidades', async () => {
    const shift = await createShift({ userId: supervisor.id, type: 'NOCHE', status: 'ACTIVO' });
    await prisma.shift.update({where:{id:shift.id},data:{date:new Date('2026-10-06T00:00:00Z')}});
    const e = await entry();
    expect(e.shiftId).toBe(shift.id);
    const detail = await getSubjectEntry(supervisor, e.id);
    const book = await getBookItems({ kinds: ['entry'], receptionEntriesOnly: true, onlyOpen: true }, reception);
    const item = book.items.find(row => row.id === e.id)!;
    expect(item).toBeDefined();
    expect(item.shiftLabel).toContain(formatCalendarDate(detail.shift?.date));
    expect(formatCalendarDate(detail.shift?.date)).toBe('06-10-2026');
    expect((await getCoordinationBoard(supervisor, { mine: true, departmentId: area })).rows.some(row => row.id === e.id)).toBe(true);
    expect((await getCoordinationBoard(reception, { mine: true })).rows.some(row => row.id === e.id)).toBe(false);
  });
  it('la responsabilidad del asunto no desaparece si el trabajo vinculado corresponde a otra persona', async () => {
    const e = await entry();
    await createTask(admin, { title: 'Atención de otra persona', entryId: e.id, assigneeId: reception.id, departmentId: area, priority: 'MEDIA', tags: [], checklist: [] });
    expect((await getCoordinationBoard(supervisor, { mine: true })).rows.some(row => row.id === e.id)).toBe(true);
    expect((await getCoordinationBoard(reception, { mine: true })).rows.some(row => row.kind === 'task')).toBe(true);
  });
  it('recepción pierde auditoría global incluso con una concesión histórica; editar contenido y eliminar siguen exigiendo permisos', async () => {
    expect(effectiveRolePermissions(reception.roleKey, ['audit.view', 'entry.create'])).toEqual(['entry.create']);
    expect(effectiveRolePermissions(supervisor.roleKey, ['audit.view'])).toEqual(['audit.view']);
    expect(reception.permissions).not.toContain('entry.content.edit');
    expect(supervisor.permissions).toContain('entry.content.edit');
    auth.current.mockResolvedValue(reception);
    expect((await updateEntryAction(null, new FormData())).ok).toBe(false);
    expect((await deleteEntryAction(null, new FormData())).ok).toBe(false);
  });
  it('retiro administrativo libera sólo a la persona elegida, promueve al apoyo y conserva turno e historial', async () => {
    const shift = await createShift({ userId: reception.id, type: 'DIA', status: 'ACTIVO' });
    await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id},data:{activatedAt:new Date()}});
    await prisma.shiftAssignment.create({ data: { shiftId: shift.id, userId: supervisor.id, role: 'APOYO', activatedAt: new Date() } });
    const old = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    await removeShiftMember(admin, { shiftId: shift.id, userId: reception.id, adminCleanup: true, reason: 'Asignación sintética incorrecta' });
    expect(await prisma.shift.count({ where: { id: shift.id, status: old.status, archivedAt: null } })).toBe(1);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: shift.id } })).toBe(2);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: shift.id, userId: reception.id, leftAt: null } })).toBe(0);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: shift.id, userId: supervisor.id, role: 'TITULAR', leftAt: null } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entity: 'ShiftAssignment', action: 'ELIMINAR', reason: 'Asignación sintética incorrecta' } })).toBe(1);
  });
  it('SysAdmin puede retirar a la última persona sin borrar el turno; la operación ordinaria lo rechaza', async () => {
    const shift = await createShift({ userId: reception.id, type: 'DIA', status: 'ACTIVO' });
    await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id},data:{activatedAt:new Date()}});
    await expect(removeShiftMember(supervisor, { shiftId: shift.id, userId: reception.id })).rejects.toThrow('única');
    await removeShiftMember(admin, { shiftId: shift.id, userId: reception.id, adminCleanup: true, reason: 'Turno sintético vacío' });
    expect(await prisma.shift.count({ where: { id: shift.id, status: 'ANULADO', archivedAt: null } })).toBe(1);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: shift.id, leftAt: null } })).toBe(0);
    expect(await prisma.shiftAssignment.count({ where: { shiftId: shift.id } })).toBe(1);
  });
  it('limpia una notificación de campana/push con marca histórica y auditoría, sin afectar otras', async () => {
    const n = await prisma.notification.create({ data: { userId: reception.id, type: 'ACTUALIZACION_OPERATIVA', title: 'Prueba individual' } });
    const other = await prisma.notification.create({ data: { userId: reception.id, type: 'ACTUALIZACION_OPERATIVA', title: 'Conservar' } });
    await clean('notification', n.id, n.createdAt.toISOString());
    expect(await visiblePrisma.notification.findUnique({ where: { id: n.id } })).toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id, deletedAt: { not: null } } })).deletedById).toBe(admin.id);
    expect(await prisma.auditLog.count({ where: { entityId: n.id, action: 'ELIMINAR' } })).toBe(1);
    await expect(clean('notification', n.id, n.createdAt.toISOString())).rejects.toThrow();
  });
  it('rechaza limpieza por supervisor, confirmación ausente y retiro de personas sin SysAdmin desde las acciones reales', async () => {
    auth.current.mockResolvedValue(supervisor);
    expect((await cleanupAdminRecordAction(null, new FormData())).ok).toBe(false);
    expect((await cleanupShiftMemberAction(null, new FormData())).ok).toBe(false);
    await expect(clean('notification', 'no-id', 'revision', supervisor)).rejects.toThrow('SysAdmin');
    auth.current.mockResolvedValue(admin);
    expect((await cleanupAdminRecordAction(null, new FormData())).ok).toBe(false);
  });
  it('si falla la auditoría obligatoria se revierte el borrado lógico', async () => {
    const n = await prisma.notification.create({ data: { userId: reception.id, type: 'ACTUALIZACION_OPERATIVA', title: 'Debe permanecer' } });
    await expect(clean('notification', n.id, n.createdAt.toISOString(), { ...admin, id: 'usuario-inexistente' })).rejects.toThrow();
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).deletedAt).toBeNull();
  });
  it('Fronti privado oculta el mensaje y su memoria derivada, conservando los originales en el historial', async () => {
    const c = await prisma.ai_conversation.create({ data: { id: randomUUID(), user_id: admin.id, session_id: randomUUID(), expires_at: new Date(Date.now()+86400000) } });
    const m = await prisma.ai_message.create({ data: { id: randomUUID(), conversation_id: c.id, role: 'assistant', content: 'Texto sintético', expires_at: c.expires_at } });
    await prisma.ai_memory.create({ data: { id: randomUUID(), conversation_id: c.id, user_id: admin.id, scope: 'PERSONAL', summary: 'Texto sintético derivado', expires_at: c.expires_at } });
    await clean('fronti', m.id, m.created_at.toISOString());
    expect(await visiblePrisma.ai_message.count({ where: { conversation_id: c.id } })).toBe(0);
    expect(await visiblePrisma.ai_memory.count({ where: { conversation_id: c.id } })).toBe(0);
    expect(await prisma.ai_message.count({ where: { id: m.id, deletedAt: { not: null } } })).toBe(1);
    expect(await prisma.ai_conversation.count({ where: { id: c.id } })).toBe(1);
  });
  it('limpia Fronti en Chat sin permitir borrar mensajes de conversaciones humanas', async () => {
    const c = await prisma.chatConversation.create({ data: { type: 'FRONTI', createdById: admin.id } });
    const m = await prisma.chatMessage.create({ data: { conversationId: c.id, author: 'FRONTI', body: 'Prueba Fronti' } });
    await clean('frontiChat', m.id, m.createdAt.toISOString());
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: m.id } })).deletedAt).not.toBeNull();
    const human = await prisma.chatConversation.create({ data: { type: 'GRUPO', createdById: admin.id } });
    const h = await prisma.chatMessage.create({ data: { conversationId: human.id, senderId: admin.id, body: 'Conservar' } });
    await expect(clean('frontiChat', h.id, h.createdAt.toISOString())).rejects.toThrow();
  });
  it('anula el impacto del movimiento en Caja y retira el arqueo de las lecturas sin borrar snapshots', async () => {
    const movement = await insertCashMovement(prisma, { userId: admin.id, kind: 'AJUSTE_ENTRADA', direction: 'ENTRADA', currency: 'CLP', amount: 500 });
    const m = await prisma.cashMovement.findFirstOrThrow({ where: { id: movement } });
    const audit = await prisma.cashAudit.create({ data: { id: randomUUID(), currency: 'CLP', expectedAmount: 500, countedAmount: 500, difference: 0, countedById: admin.id } });
    await clean('cashMovement', m.id, m.createdAt.toISOString());
    await clean('cashAudit', audit.id, audit.createdAt.toISOString());
    const live = await getLiveCashState();
    expect(live.movements.some(row => row.id === m.id)).toBe(false);
    expect(live.audits.some(row => row.id === audit.id)).toBe(false);
    expect((await prisma.cashMovement.findUniqueOrThrow({ where: { id: m.id } })).affectsExpected).toBe(false);
    expect(await prisma.cashAudit.count({ where: { id: audit.id, deletedAt: { not: null } } })).toBe(1);
  });
  it('HK eliminado desaparece del tablero y del asunto, rechaza versión vieja y conserva el origen', async () => {
    const e = await entry();
    const work = await prisma.housekeepingRequest.create({ data: { requestKey: randomUUID(), title: 'Prueba HK', description: 'Limpieza sintética', sourceEntryId: e.id, createdById: admin.id, isDemo: false, workflowVersion: 1, workKind:'ATENCION',workDate:'2026-10-07',departmentId: area } });
    await expect(clean('housekeeping', work.id, String(work.version+1))).rejects.toThrow('cambió');
    await clean('housekeeping', work.id, String(work.version));
    expect(await visiblePrisma.housekeepingRequest.findUnique({ where: { id: work.id } })).toBeNull();
    expect((await getSubjectEntry(admin, e.id)).housekeepingRequests).toHaveLength(0);
    expect(await prisma.operationalEntry.count({ where: { id: e.id } })).toBe(1);
    expect(await prisma.housekeepingRequest.count({ where: { id: work.id, deletedAt: { not: null } } })).toBe(1);
  });
  it.each(['INICIADO', 'ACTIVO'] as const)('retiro final %s termina temporizadores y libera sólo la recepción incompleta', async status => {
    const outgoing = await createShift({userId: supervisor.id, type:'NOCHE', status:'CERRADO'});
    const incoming = await createShift({userId: reception.id, type:'DIA', status});
    await prisma.shiftAssignment.updateMany({where:{shiftId:incoming.id},data:{activatedAt:new Date()}});
    const handover = await prisma.shiftHandover.create({data:{fromShiftId:outgoing.id,toShiftId:incoming.id,status:status==='INICIADO'?'ENVIADA':'RECIBIDA',issuedById:supervisor.id,receivedAt:status==='ACTIVO'?new Date():null,receiverBriefingReviewedAt:new Date()}});
    const timer = await prisma.operationalAlarm.create({data:{kind:'TIMER',scope:'INDIVIDUAL',title:'Temporizador sintético',createdById:reception.id,originShiftId:incoming.id,dueAt:new Date(Date.now()+60000)}});
    await removeShiftMember(admin,{shiftId:incoming.id,userId:reception.id,adminCleanup:true,reason:'Turno de prueba vacío'});
    expect((await prisma.operationalAlarm.findUniqueOrThrow({where:{id:timer.id}})).status).toBe('CANCELADA');
    const after = await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}});
    expect(after.toShiftId).toBe(status==='INICIADO'?null:incoming.id);
    expect(after.receiverBriefingReviewedAt===null).toBe(status==='INICIADO');
    expect((await prisma.shift.findUniqueOrThrow({where:{id:incoming.id}})).status).toBe('ANULADO');
  });
  it('rechaza el retiro final si la recepción confirmó Caja y conserva toda la transición', async () => {
    const outgoing = await createShift({userId:supervisor.id,type:'NOCHE',status:'CERRADO'});
    const incoming = await createShift({userId:reception.id,type:'DIA',status:'INICIADO'});
    await prisma.shiftAssignment.updateMany({where:{shiftId:incoming.id},data:{activatedAt:new Date()}});
    const handover = await prisma.shiftHandover.create({data:{fromShiftId:outgoing.id,toShiftId:incoming.id,status:'ENVIADA',issuedById:supervisor.id}});
    await prisma.cashCount.create({data:{handoverId:handover.id,kind:'CONFIRMADO',countedById:reception.id}});
    await expect(removeShiftMember(admin,{shiftId:incoming.id,userId:reception.id,adminCleanup:true,reason:'Limpieza de prueba'})).rejects.toThrow('confirmó Caja');
    expect((await prisma.shiftHandover.findUniqueOrThrow({where:{id:handover.id}})).toShiftId).toBe(incoming.id);
    expect((await prisma.shift.findUniqueOrThrow({where:{id:incoming.id}})).status).toBe('INICIADO');
    expect(await prisma.shiftAssignment.count({where:{shiftId:incoming.id,leftAt:null}})).toBe(1);
  });
  it('la limpieza de memoria TURNO deja de inyectarla a otro participante y conserva recuerdos vigentes', async () => {
    const shift = await createShift({userId:reception.id,type:'DIA',status:'ACTIVO'});
    await prisma.shiftAssignment.updateMany({where:{shiftId:shift.id},data:{activatedAt:new Date()}});
    const c = await prisma.ai_conversation.create({data:{id:randomUUID(),user_id:admin.id,session_id:randomUUID(),expires_at:new Date(Date.now()+86400000)}});
    const m = await prisma.ai_message.create({data:{id:randomUUID(),conversation_id:c.id,role:'assistant',content:'Borrar memoria compartida',expires_at:c.expires_at}});
    await prisma.ai_memory.create({data:{id:randomUUID(),conversation_id:c.id,user_id:admin.id,scope:'TURNO',shift_id:shift.id,summary:'Recuerdo eliminado',expires_at:c.expires_at}});
    await prisma.ai_memory.create({data:{id:randomUUID(),user_id:admin.id,scope:'TURNO',shift_id:shift.id,summary:'Recuerdo vigente',expires_at:c.expires_at}});
    expect(await getSharedShiftMemoryContext(reception)).toContain('Recuerdo eliminado');
    await clean('fronti',m.id,m.created_at.toISOString());
    const context = await getSharedShiftMemoryContext(reception);
    expect(context).not.toContain('Recuerdo eliminado');
    expect(context).toContain('Recuerdo vigente');
  });
  it('el permiso exclusivo de contenido no permite campos operativos, incluidos vacíos; ambos permisos sí', async () => {
    const e = await entry();
    auth.current.mockResolvedValue({...admin,isSystemAdmin:false,permissions:['entry.content.edit']});
    for (const [key,value] of [['ownerId',reception.id],['departmentId',area],['priority','ALTA'],['dueAt',''],['requiresFollowUp','true'],['severity','BAJA']] as const) {
      const form = new FormData();form.set('id',e.id);form.set(key,value);
      expect((await updateEntryAction(null,form)).ok).toBe(false);
    }
    const form = new FormData();form.set('id',e.id);form.set('title','Texto permitido de prueba');
    expect((await updateEntryAction(null,form)).ok).toBe(true);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).ownerId).toBe(supervisor.id);
    auth.current.mockResolvedValue(admin);form.set('ownerId',reception.id);
    expect((await updateEntryAction(null,form)).ok).toBe(true);
    expect((await prisma.operationalEntry.findUniqueOrThrow({where:{id:e.id}})).ownerId).toBe(reception.id);
  });
  it('recrea atención HK con el mismo requestKey y origen conservando fila y claves originales en auditoría', async () => {
    const e = await entry();
    const input = {requestKey:randomUUID(),sourceEntryId:e.id,departmentId:area,workDate:hotelDateKey(new Date()),workKind:'ATENCION' as const,priority:'MEDIA' as const,title:'Atención sintética',description:'Prueba de recreación',effortMinutes:20,requiresInspection:false,location:'Recepción'};
    const first = await createHkWork(admin,input);
    await clean('housekeeping',first.id,String(first.version));
    const replacement = await createHkWork(admin,input);
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.sourceEntryId).toBe(e.id);
    const history = await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:first.id}});
    expect(history.deletedAt).not.toBeNull();
    expect(history.sourceEntryId).toBeNull();
    expect(history.title).toBe(e.title);
    expect(history.description).toBe(e.description);
    const audit = await prisma.auditLog.findFirstOrThrow({where:{entityId:first.id,action:'ELIMINAR'}});
    expect(audit.before).toMatchObject({requestKey:input.requestKey,sourceEntryId:e.id,departmentId:area});
  });
  it('preparar el mismo día regenera una rutina eliminada y conserva una única instancia activa', async () => {
    const date = hotelDateKey(new Date());
    const routine = await prisma.housekeepingRoutine.create({data:{departmentId:area,title:'Rutina de prueba',description:'Prueba de recreación',location:'Recepción'}});
    expect((await prepareHkDay(admin,area,date)).created).toBe(1);
    const first = await visiblePrisma.housekeepingRequest.findFirstOrThrow({where:{routineId:routine.id,workDate:date}});
    await clean('housekeeping',first.id,String(first.version));
    expect((await prepareHkDay(admin,area,date)).created).toBe(1);
    expect((await prepareHkDay(admin,area,date)).created).toBe(0);
    const second = await visiblePrisma.housekeepingRequest.findFirstOrThrow({where:{routineId:routine.id,workDate:date}});
    expect(second.id).not.toBe(first.id);
    expect(await prisma.housekeepingRequest.count({where:{id:first.id,deletedAt:{not:null}}})).toBe(1);
    expect(await prisma.housekeepingEvent.count({where:{requestId:second.id,action:'CREAR'}})).toBe(1);
  });
  it('limpiar Fronti en Chat cambia la versión visible al participante sin otro evento', async () => {
    const c = await prisma.chatConversation.create({data:{type:'FRONTI',createdById:reception.id,updatedAt:new Date(Date.now()-10000),participants:{create:{userId:reception.id}}}});
    const m = await prisma.chatMessage.create({data:{conversationId:c.id,author:'FRONTI',body:'Mensaje de prueba'}});
    const version = await getChatGlobalVersion(reception);
    await clean('frontiChat',m.id,m.createdAt.toISOString());
    expect(await getChatGlobalVersion(reception)).not.toBe(version);
    expect((await prisma.chatConversation.findUniqueOrThrow({where:{id:c.id}})).lastMessageAt).toEqual(c.lastMessageAt);
  });

});

describe('Supervisión: cancelar apertura propia o desde SysAdmin sin borrar evidencia', () => {
  let supervisor: CurrentUser, admin: CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    auth.current.mockResolvedValue(supervisor);
  });
  const cancel = (id: string, user = supervisor) => cancelSupervisionOpening(user, { shiftId: id, reason: 'Apertura de prueba anterior', confirmation: 'CANCELAR' });
  it('el iniciador cancela una preparación antigua, queda auditada, conserva evidencia y permite nueva apertura', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const evidence = { version: 1, phase: 'PREPARACION', note: 'Evidencia sintética conservada' };
    await prisma.supervisionShift.update({ where: { id: shift.id }, data: { startedAt: new Date('2026-10-04T14:59:00Z'), openingState: evidence } });
    expect((await getSupervisionOpeningReadiness(supervisor)).shift.expired).toBe(true);
    const result = await cancel(shift.id);
    expect(result.status).toBe('CANCELADO');
    expect(result.openingState).toEqual(evidence);
    expect(result.openingCompletedAt).toBeNull();
    expect(result.finishedAt).toBeNull();
    expect(result.canceledById).toBe(supervisor.id);
    expect(await getMyOpenSupervisionShift(supervisor.id)).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: shift.id, action: 'CAMBIO_ESTADO', reason: 'Apertura de prueba anterior' } })).toBe(1);
    expect((await beginSupervisionOpening(supervisor)).id).not.toBe(shift.id);
  });
  it('admin puede consultar/cancelar preparación ajena; otro supervisor no puede', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const other = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    expect((await listCancelableSupervisionOpenings(other)).some(s => s.id === shift.id)).toBe(false);
    expect((await listCancelableSupervisionOpenings(admin)).some(s => s.id === shift.id)).toBe(true);
    await expect(cancel(shift.id, other)).rejects.toThrow('quien inició');
    expect((await cancel(shift.id, admin)).canceledById).toBe(admin.id);
  });
  it('la Server Action exige confirmación y motivo aun si se invoca sin interfaz', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const form = new FormData(); form.set('shiftId', shift.id); form.set('reason', 'Motivo de prueba');
    expect((await cancelSupervisionOpeningAction(null, form)).ok).toBe(false);
    form.set('confirmation', 'CANCELAR');
    expect((await cancelSupervisionOpeningAction(null, form)).ok).toBe(true);
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe('CANCELADO');
  });
  it('no permite cancelar un turno ya activo ni duplicar cancelaciones concurrentes', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const results = await Promise.allSettled([cancel(shift.id), cancel(shift.id, admin)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: shift.id, action: 'CAMBIO_ESTADO' } })).toBe(1);
    const active = await beginSupervisionOpening(supervisor);
    await prisma.supervisionShift.update({ where: { id: active.id }, data: { status: 'ACTIVO' } });
    await expect(cancel(active.id)).rejects.toThrow('Preparación');
  });
  it('activar y cancelar compiten sobre la misma preparación: sólo uno puede confirmar', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const results = await Promise.allSettled([
      completeSupervisionOpening(supervisor, { shiftId: shift.id, reviewedPending: true, reviewedGuarantees: true, reviewedKeys: true, reportContingencyReason: 'Contingencia sintética sin evidencia PMS' }),
      cancel(shift.id, admin),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const final = await prisma.supervisionShift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(['ACTIVO', 'CANCELADO']).toContain(final.status);
    expect(await prisma.auditLog.count({ where: { entityId: shift.id, action: { in: ['TURNO_INICIAR','CAMBIO_ESTADO'] } } })).toBe(1);
  });
  it('si falla auditoría la preparación sigue vigente', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    await expect(cancel(shift.id, { ...admin, id: 'actor-inexistente' })).rejects.toThrow();
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe('PREPARACION');
  });
  it('vencimiento usa medianoche de Santiago tanto en verano como en invierno, sin asumir 24 horas', () => {
    expect(supervisionOpeningExpired(new Date('2026-10-07T02:59:00Z'), new Date('2026-10-07T03:01:00Z'))).toBe(true);
    expect(supervisionOpeningExpired(new Date('2026-10-07T03:00:00Z'), new Date('2026-10-08T02:59:00Z'))).toBe(false);
    expect(supervisionOpeningExpired(new Date('2026-07-07T03:59:00Z'), new Date('2026-07-07T04:01:00Z'))).toBe(true);
  });
});
