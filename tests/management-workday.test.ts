import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import {
  finishManagementWorkday,
  getManagementWorkday,
  startManagementWorkday,
} from '@/server/services/management-workday';
import { createShift, createUser, resetOperationalData, seedCatalog } from './helpers';

describe('Mi jornada de jefatura por área', () => {
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);

  async function managerIn(areaKey = 'HOUSEKEEPING') {
    const area = await prisma.department.findUniqueOrThrow({ where: { key: areaKey } });
    const user = await createUser({ roleKey: ROLE_KEYS.HK_SUPERVISOR });
    await prisma.user.update({ where: { id: user.id }, data: { departmentId: area.id } });
    user.departmentId = area.id;
    return { user, area };
  }

  it('abre y cierra la jornada sin abrir Caja ni alterar el turno de Recepción', async () => {
    const { user, area } = await managerIn();
    const reception = await createShift({ type: 'DIA', status: 'ACTIVO' });

    const workday = await startManagementWorkday(user, { departmentId: area.id });
    expect(workday.departmentId).toBe(area.id);
    expect(workday.status).toBe('ACTIVO');

    const sameReception = await prisma.shift.findUniqueOrThrow({ where: { id: reception.id } });
    expect(sameReception.status).toBe('ACTIVO');
    expect(await prisma.cashAudit.count()).toBe(0);

    const closed = await finishManagementWorkday(user, { shiftId: workday.id, note: 'Continuidad documentada' });
    expect(closed.status).toBe('CERRADO');
    expect(closed.finishedAt).not.toBeNull();

    const after = await prisma.shift.findUniqueOrThrow({ where: { id: reception.id } });
    expect(after.status).toBe('ACTIVO');
  });

  it('dos jefaturas trabajan simultáneamente y cerrar una no cierra la otra', async () => {
    const first = await managerIn();
    const second = await managerIn();
    const a = await startManagementWorkday(first.user, { departmentId: first.area.id });
    const b = await startManagementWorkday(second.user, { departmentId: second.area.id });

    await finishManagementWorkday(first.user, { shiftId: a.id });

    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('CERRADO');
    expect((await prisma.supervisionShift.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVO');
  });

  it('no duplica una jornada abierta del mismo responsable y área', async () => {
    const { user, area } = await managerIn();
    await startManagementWorkday(user, { departmentId: area.id });
    await expect(startManagementWorkday(user, { departmentId: area.id })).rejects.toThrow('Ya tienes una jornada abierta');
    expect(await prisma.supervisionShift.count({ where: { supervisorId: user.id, departmentId: area.id, status: 'ACTIVO' } })).toBe(1);
  });

  it('respeta el alcance y permite cobertura temporal sin duplicar la cuenta', async () => {
    const { user, area } = await managerIn();
    const other = await prisma.department.findFirstOrThrow({ where: { id: { not: area.id }, active: true } });

    await expect(startManagementWorkday(user, { departmentId: other.id })).rejects.toThrow('no pertenece a tu alcance');

    await prisma.housekeepingDelegation.create({
      data: {
        departmentId: other.id,
        userId: user.id,
        grantedById: user.id,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 60 * 60_000),
        permission: 'housekeeping.plan',
        reason: 'Cobertura temporal de prueba',
      },
    });

    const workday = await startManagementWorkday(user, { departmentId: other.id });
    expect(workday.departmentId).toBe(other.id);
    const board = await getManagementWorkday(user);
    expect(board.active.map(row => row.departmentId)).toContain(other.id);
  });
});
