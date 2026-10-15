import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, type RoleKey } from '@/lib/permissions';
import { MAINTENANCE_DEFAULT, MAINTENANCE_SETTING_KEY } from '@/domain/system-maintenance';
import type { CurrentUser } from '@/server/auth/current-user';
import { beginSupervisionOpening, cancelSupervisionOpening, deliverSupervisionShift, finishSupervisionShift, getSupervisionClosureState, receiveSupervisionHandover, startSupervisionShift } from '@/server/services/supervision-center';
import { finishManagementWorkday, startManagementWorkday } from '@/server/services/management-workday';
import { acceptHkHandover, getHkClosureHandovers, receiveHkHandover, saveHkHandover } from '@/server/services/housekeeping-work';
import { createFollowUp } from '@/server/services/followups';
import { createUser, prisma, resetOperationalData, seedCatalog } from './helpers';

describe('Cierre ordenado de jornadas y relevos de áreas existentes', () => {
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);

  async function closeOperation(admin: CurrentUser) {
    const startedAt = new Date().toISOString();
    await prisma.systemSetting.create({ data: { key: MAINTENANCE_SETTING_KEY, updatedById: admin.id, value: {
      ...MAINTENANCE_DEFAULT,
      closure: { phase: 'CLOSING', startedAt, startedById: admin.id, backup: null, lockedAt: null, lockedById: null },
    } } });
  }

  async function areaUser(roleKey: RoleKey) {
    const area = await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } });
    const user = await createUser({ roleKey });
    await prisma.user.update({ where: { id: user.id }, data: { departmentId: area.id } });
    user.departmentId = area.id;
    return { user, area };
  }

  it('prohíbe nuevas jornadas y aperturas incluso a Sysadmin durante la despedida', async () => {
    const { user: admin, area } = await areaUser(ROLE_KEYS.SYSTEM_ADMIN);
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await closeOperation(admin);
    for (const actor of [supervisor, admin]) {
      await expect(beginSupervisionOpening(actor)).rejects.toThrow();
      await expect(startSupervisionShift(actor, { priorities: [] })).rejects.toThrow();
    }
    await expect(startManagementWorkday(admin, { departmentId: area.id })).rejects.toThrow();
    expect(await prisma.supervisionShift.count()).toBe(0);
  });

  it('cierra únicamente la jornada propia y mantiene la de otra jefatura', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const { user: first, area } = await areaUser(ROLE_KEYS.HK_SUPERVISOR);
    const { user: second } = await areaUser(ROLE_KEYS.HK_SUPERVISOR);
    const a = await startManagementWorkday(first, { departmentId: area.id });
    const b = await startManagementWorkday(second, { departmentId: area.id });
    await closeOperation(admin);
    await expect(finishManagementWorkday(second, { shiftId: a.id })).rejects.toThrow('propia jornada');
    await finishManagementWorkday(first, { shiftId: a.id, note: 'Continuidad final revisada por su responsable.' });
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CERRADO');
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVO');
  });

  it('cancela explícitamente una preparación sin activarla ni inventar una entrega', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const opening = await beginSupervisionOpening(supervisor);
    await closeOperation(admin);
    await cancelSupervisionOpening(supervisor, { shiftId: opening.id, reason: 'Finalización de la operación', confirmation: 'CANCELAR' });
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe('CANCELADO');
    expect(await prisma.supervisionShiftHandover.count()).toBe(0);
  });

  it('finaliza Supervisión y recibe su entrega con otro actor sin abrir una jornada nueva', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const outgoing = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const receiver = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const unrelated = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const shift = await startSupervisionShift(outgoing, { priorities: ['Continuidad final'] });
    await createFollowUp(outgoing, { action: 'Contenido privado del supervisor saliente', ownerId: outgoing.id, visibility: 'PRIVADO' });
    await closeOperation(admin);
    await finishSupervisionShift(outgoing, shift.id);
    const handover = (await getSupervisionClosureState(receiver)).handovers[0]!;
    expect(handover.supervisionShiftId).toBe(shift.id);
    expect(handover.receivedAt).toBeNull();
    expect(JSON.stringify(handover.snapshot)).not.toContain('Contenido privado del supervisor saliente');
    expect(JSON.stringify((await getSupervisionClosureState(admin)).handovers)).not.toContain('Contenido privado del supervisor saliente');
    expect(JSON.stringify((await getSupervisionClosureState(outgoing)).handovers)).toContain('Contenido privado del supervisor saliente');
    await expect(receiveSupervisionHandover(outgoing, handover.id)).rejects.toThrow('propia entrega');
    await expect(receiveSupervisionHandover(unrelated, handover.id)).rejects.toThrow();
    await receiveSupervisionHandover(receiver, handover.id);
    const received = await prisma.supervisionShiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(received.receivedById).toBe(receiver.id);
    expect(received.receivedAt).not.toBeNull();
    expect(await prisma.supervisionShift.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR', userId: receiver.id } })).toBe(1);
  });

  it('conserva una sola entrega nativa si dos cierres de Supervisión compiten', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const outgoing = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const shift = await startSupervisionShift(outgoing, { priorities: [] });
    await closeOperation(admin);
    const result = await Promise.allSettled([finishSupervisionShift(outgoing, shift.id), finishSupervisionShift(outgoing, shift.id)]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.supervisionShiftHandover.count({ where: { supervisionShiftId: shift.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: shift.id, action: 'TURNO_CERRAR' } })).toBe(1);
  });

  it('serializa dos recepciones concurrentes conservando una sola autoría', async () => {
    const outgoing = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const a = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const b = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const shift = await startSupervisionShift(outgoing, { priorities: [] });
    const handover = await deliverSupervisionShift(outgoing, { shiftId: shift.id });
    await closeOperation(b);
    const result = await Promise.allSettled([receiveSupervisionHandover(a, handover.id), receiveSupervisionHandover(b, handover.id)]);
    expect(result.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR' } })).toBe(1);
  });

  it('lista todos los relevos HK pendientes dentro del alcance y recibe con identidad real', async () => {
    const { user: admin } = await areaUser(ROLE_KEYS.SYSTEM_ADMIN);
    const { user: outgoing, area } = await areaUser(ROLE_KEYS.HK_SUPERVISOR);
    const { user: receiver } = await areaUser(ROLE_KEYS.HK_SUPERVISOR);
    const { user: worker } = await areaUser(ROLE_KEYS.HK_ATTENDANT);
    const handovers = [];
    for (let index = 0; index < 7; index++) handovers.push(await saveHkHandover(outgoing, { requestKey: randomUUID(), departmentId: area.id, workDate: '2026-10-15', note: `Entrega final ${index}; comentario completo.` }));
    const otherArea = await prisma.department.findFirstOrThrow({ where: { id: { not: area.id }, active: true } });
    const hidden = await saveHkHandover(admin, { requestKey: randomUUID(), departmentId: otherArea.id, workDate: '2026-10-15', note: 'Entrega de otra área.' });
    await closeOperation(admin);
    const visible = await getHkClosureHandovers(receiver);
    expect(visible).toHaveLength(7);
    expect(visible.map(item => item.id)).not.toContain(hidden.id);
    expect(await getHkClosureHandovers(worker)).toEqual([]);
    const first = handovers[0]!;
    await expect(receiveHkHandover(outgoing, first.id)).rejects.toThrow('otra persona');
    await expect(receiveHkHandover(worker, first.id)).rejects.toThrow();
    await receiveHkHandover(receiver, first.id);
    const received = await prisma.housekeepingHandover.findUniqueOrThrow({ where: { id: first.id } });
    expect(received.receivedById).toBe(receiver.id);
    expect(received.receivedAt).not.toBeNull();
    expect(received.acceptedAt).toBeNull();
    await expect(acceptHkHandover(outgoing, received.id)).rejects.toThrow('quien recibió');
    await acceptHkHandover(receiver, received.id);
    expect((await prisma.housekeepingHandover.findUniqueOrThrow({ where: { id: received.id } })).acceptedById).toBe(receiver.id);
    expect(await prisma.shift.count()).toBe(0);
    expect(await prisma.supervisionShift.count()).toBe(0);
  });
});
