import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Priority } from '@prisma/client';
import { createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { createHousekeepingRequest, changeHousekeepingRequest, getHousekeepingBoard, getHousekeepingSources, housekeepingAuditVisibility, escalateHousekeepingRequests } from '@/server/services/housekeeping';
import { searchOperationalRecords } from '@/server/services/global-search';

describe('Housekeeping privado: persistencia y protección', () => {
  let admin: CurrentUser;
  let reception: CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    reception = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });
  const input = () => ({ requestKey: randomUUID(), title: 'Solicitud de toallas', description: 'Coordinar entrega en vestíbulo.', priority: Priority.MEDIA });
  async function source() {
    return prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Extensión confirmada en PMS', description: 'Comunicar a Housekeeping.', createdById: reception.id, priority: 'ALTA' } });
  }
  it('rechaza todos los servicios para una cuenta operativa, incluso con permisos técnicos', async () => {
    const fake = { ...reception, permissions: ['system.configure'] as CurrentUser['permissions'], isSystemAdmin: true };
    await expect(getHousekeepingBoard(fake)).rejects.toThrow();
    await expect(getHousekeepingSources(fake)).rejects.toThrow();
    await expect(createHousekeepingRequest(fake, input())).rejects.toThrow();
    await expect(changeHousekeepingRequest(fake, { id: 'x', version: 1, action: 'CONFIRMAR' })).rejects.toThrow();
  });
  it('persiste aviso, confirmación y resultado con evidencias distintas, sin afectar la operación', async () => {
    const request = await createHousekeepingRequest(admin, input());
    expect(request.isDemo).toBe(false);
    expect(request.humanId).toBeGreaterThanOrEqual(1000);
    expect((await getHousekeepingBoard(admin)).pending).toBe(1);
    await changeHousekeepingRequest(admin, { id: request.id, version: 1, action: 'CONFIRMAR' });
    let stored = await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.status).toBe('RECIBIDO'); expect(stored.acknowledgedAt).not.toBeNull(); expect(stored.resolvedAt).toBeNull();
    await expect(changeHousekeepingRequest(admin, { id: request.id, version: 2, action: 'RESOLVER' })).rejects.toThrow('motivo');
    await changeHousekeepingRequest(admin, { id: request.id, version: 2, action: 'RESOLVER', note: 'Entrega de prueba completada.' });
    stored = await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.status).toBe('RESUELTO'); expect(stored.resolvedAt).not.toBeNull();
    expect((await getHousekeepingBoard(admin)).active).toBe(0);
    expect((await getHousekeepingBoard(admin, true)).requests).toHaveLength(1);
    expect(await prisma.housekeepingEvent.count({ where: { requestId: request.id } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { entityId: request.id, isDemo: false } })).toBe(3);
    expect(await prisma.task.count()).toBe(0); expect(await prisma.shiftAssignment.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  });
  it('toma y releva entre áreas, exige nueva recepción y devuelve el resultado al solicitante', async () => {
    const manager = await createUser({roleKey:ROLE_KEYS.SYSTEM_ADMIN});
    const area = await prisma.department.findUniqueOrThrow({where:{key:'HOUSEKEEPING'}});
    const destination = await prisma.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
    await prisma.user.update({where:{id:manager.id},data:{departmentId:area.id}});
    const r = await createHousekeepingRequest(admin,{...input(),departmentId:area.id,assignedToId:manager.id,dueAt:new Date('2020-01-01')});
    expect(await prisma.notification.count({where:{userId:manager.id,entityId:r.id}})).toBe(1);
    await changeHousekeepingRequest(manager,{id:r.id,version:1,action:'TOMAR'});
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('EN_GESTION');
    await changeHousekeepingRequest(manager,{id:r.id,version:2,action:'DERIVAR',departmentId:destination.id,note:'Recepción debe confirmar disponibilidad antes de continuar'});
    const handed = await prisma.housekeepingRequest.findUniqueOrThrow({where:{id:r.id}});
    expect(handed.departmentId).toBe(destination.id); expect(handed.status).toBe('PENDIENTE'); expect(handed.acknowledgedAt).toBeNull(); expect(handed.assignedToId).toBeNull();
    await expect(changeHousekeepingRequest(admin,{id:r.id,version:3,action:'RESOLVER',note:'Listo'})).rejects.toThrow();
    await escalateHousekeepingRequests(); const alerts = await prisma.notification.count({where:{entityId:r.id}});
    await escalateHousekeepingRequests(); expect(await prisma.notification.count({where:{entityId:r.id}})).toBe(alerts);
    await changeHousekeepingRequest(manager,{id:r.id,version:3,action:'TOMAR'});
    await changeHousekeepingRequest(manager,{id:r.id,version:4,action:'RESOLVER',note:'Disponibilidad confirmada y atención completada'});
    expect(await prisma.notification.count({where:{userId:admin.id,entityId:r.id,title:{contains:'Resultado'}}})).toBe(1);
    expect((await getHousekeepingBoard(manager,false,1,undefined,true)).requests).toHaveLength(0);
    await expect(createHousekeepingRequest(admin,{...input(),assignedToId:reception.id,departmentId:area.id})).rejects.toThrow('responsable');
  });
  it('no duplica reintentos ni vínculos al registro original', async () => {
    const original = await source();
    const data = { ...input(), sourceEntryId: original.id };
    const requests = await Promise.all([createHousekeepingRequest(admin, data), createHousekeepingRequest(admin, data)]);
    expect(requests[0].id).toBe(requests[1].id);
    expect(requests[0].title).toBeNull(); expect(requests[0].description).toBeNull(); expect(requests[0].priority).toBe('ALTA');
    await expect(createHousekeepingRequest(admin, { ...input(), sourceEntryId: original.id })).rejects.toThrow('ya está vinculada');
    expect(await getHousekeepingSources(admin)).toHaveLength(0);
    expect((await prisma.operationalEntry.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('ABIERTO');
  });
  it('exige confirmar una novedad editada y conserva la fase de gestión', async () => {
    const original = await source();
    const r = await createHousekeepingRequest(admin, { ...input(), sourceEntryId: original.id });
    await changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'CONFIRMAR' });
    await changeHousekeepingRequest(admin, { id: r.id, version: 2, action: 'INICIAR' });
    await prisma.operationalEntry.update({ where: { id: original.id }, data: { description: 'Nueva instrucción', updatedAt: new Date(Date.now() + 2000) } });
    await expect(changeHousekeepingRequest(admin, { id: r.id, version: 3, action: 'RESOLVER', note: 'Hecho' })).rejects.toThrow('nueva versión');
    await changeHousekeepingRequest(admin, { id: r.id, version: 3, action: 'CONFIRMAR' });
    expect((await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('EN_GESTION');
  });
  it('un pendiente vencido y bloqueado sobrevive; al reabrir requiere nueva recepción', async () => {
    const r = await createHousekeepingRequest(admin, { ...input(), dueAt: new Date('2020-01-01T00:00:00Z') });
    await changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'ACLARAR', note: 'Falta precisar cantidad.' });
    expect((await getHousekeepingBoard(admin)).overdue).toBe(1);
    expect((await getHousekeepingBoard(admin)).pending).toBe(1);
    await expect(changeHousekeepingRequest(admin, { id: r.id, version: 2, action: 'RETOMAR' })).rejects.toThrow('Confirma');
    await changeHousekeepingRequest(admin, { id: r.id, version: 2, action: 'CANCELAR', note: 'Solicitud retirada.' });
    await changeHousekeepingRequest(admin, { id: r.id, version: 3, action: 'REABRIR', note: 'La necesidad continúa.' });
    const stored = await prisma.housekeepingRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored.acknowledgedAt).toBeNull(); expect(stored.resolvedAt).toBeNull(); expect(stored.status).toBe('PENDIENTE');
  });
  it('solo una de dos actualizaciones concurrentes puede confirmar una misma versión', async () => {
    const r = await createHousekeepingRequest(admin, input());
    const results = await Promise.allSettled([
      changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'CONFIRMAR' }),
      changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'ACLARAR', note: '¿Cuántas?' }),
    ]);
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.housekeepingEvent.count({ where: { requestId: r.id } })).toBe(2);
  });
  it('archivar el origen no permite fingir recepción o solución', async () => {
    const original = await source();
    const r = await createHousekeepingRequest(admin, { ...input(), sourceEntryId: original.id });
    await prisma.operationalEntry.update({ where: { id: original.id }, data: { deletedAt: new Date() } });
    await expect(changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'CONFIRMAR' })).rejects.toThrow('archivada');
    await changeHousekeepingRequest(admin, { id: r.id, version: 1, action: 'CANCELAR', note: 'Origen archivado.' });
  });
  it('la búsqueda global encuentra el # únicamente para administrador', async () => {
    const r = await createHousekeepingRequest(admin, input());
    const results = await searchOperationalRecords(admin, `#${r.humanId}`);
    expect(results.some((v) => v.entityId === r.id && v.href.includes(`aviso=${r.humanId}`))).toBe(true);
    expect((await searchOperationalRecords(reception, `#${r.humanId}`)).some((v) => v.entityId === r.id)).toBe(false);
    expect((await getHousekeepingBoard(admin, false, 1, r.humanId)).requests).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { AND: [housekeepingAuditVisibility(reception)], entityId: r.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { AND: [housekeepingAuditVisibility(admin)], entityId: r.id } })).toBe(1);
  });
  it('habilita gestión para un rol operativo y revoca el acceso sin perder los pendientes', async () => {
    const enabled = { ...reception, permissions: [...reception.permissions, 'housekeeping.manage' as const] };
    const request = await createHousekeepingRequest(enabled, input());
    await changeHousekeepingRequest(enabled, { id: request.id, version: 1, action: 'CONFIRMAR' });
    expect((await getHousekeepingBoard(enabled)).requests[0]?.status).toBe('RECIBIDO');
    expect((await searchOperationalRecords(enabled, `#${request.humanId}`)).some((r) => r.entityId === request.id)).toBe(true);
    await expect(getHousekeepingBoard(reception)).rejects.toThrow();
    await expect(changeHousekeepingRequest(reception, { id: request.id, version: 2, action: 'INICIAR' })).rejects.toThrow();
    expect((await getHousekeepingBoard(admin)).requests[0]?.status).toBe('RECIBIDO');
    const event = await prisma.housekeepingEvent.findFirstOrThrow({ where: { requestId: request.id, action: 'CONFIRMAR' } });
    expect(event.actorId).toBe(reception.id);
  });
  it('separa consulta de escritura y mantiene privadas las pruebas anteriores', async () => {
    const read = { ...reception, permissions: ['housekeeping.view' as const] };
    const operational = await createHousekeepingRequest(admin, input());
    const legacy = await prisma.housekeepingRequest.create({ data: { ...input(), isDemo: true } });
    await prisma.auditLog.create({ data: { entity: 'HousekeepingRequest', entityId: legacy.id, action: 'CREAR', userId: admin.id, summary: 'Prueba anterior', isDemo: true } });
    expect((await getHousekeepingBoard(read)).requests.map((r) => r.id)).toEqual([operational.id]);
    expect((await getHousekeepingBoard(read)).active).toBe(1);
    await expect(createHousekeepingRequest(read, input())).rejects.toThrow();
    await expect(changeHousekeepingRequest(read, { id: operational.id, version: 1, action: 'CONFIRMAR' })).rejects.toThrow();
    const manager = { ...reception, permissions: ['housekeeping.manage' as const] };
    await expect(changeHousekeepingRequest(manager, { id: legacy.id, version: 1, action: 'CONFIRMAR' })).rejects.toThrow();
    expect((await searchOperationalRecords(read, `#${legacy.humanId}`)).some((r) => r.entityId === legacy.id)).toBe(false);
    expect(await prisma.auditLog.count({ where: { AND: [housekeepingAuditVisibility(read)], entityId: legacy.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { AND: [housekeepingAuditVisibility(read)], entityId: operational.id } })).toBe(1);
  });

});
