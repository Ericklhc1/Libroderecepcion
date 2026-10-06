import type { Prisma } from '@prisma/client';
import { prisma as servicePrisma } from '@/lib/prisma';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_KEYS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import { saveScheduleCollaborator, removeScheduleMembership, saveScheduleTemplate } from '@/server/services/schedule-catalog';
import { addScheduleSlot, cancelScheduleSlot, createSchedulePlan } from '@/server/services/schedules';
import { deleteAdministrativeUser, ongoingOrFutureScheduleSlots, saveAdministrativeDepartment, updateAdministrativeUser } from '@/server/services/schedule-admin-safety';
import { adminUserRevision } from '@/server/services/admin-revision';

describe('Administración: impacto de cuentas y áreas en Equipo', () => {
  let admin: CurrentUser;
  let person: CurrentUser;
  let area: string;
  let other: string;
  let collaboratorId: string;
  let planId: string;
  let templateId: string;
  let nonOperationalRoleId: string | null = null;
  beforeAll(seedCatalog);
  afterEach(async () => {
    vi.useRealTimers();
    if (nonOperationalRoleId) {
      await prisma.user.updateMany({ where: { roleId: nonOperationalRoleId }, data: { roleId: person.roleId } });
      await prisma.role.delete({ where: { id: nonOperationalRoleId } });
      nonOperationalRoleId = null;
    }
  });
  beforeEach(async () => {
    await resetOperationalData();
    await prisma.department.updateMany({ where: { key: { in: ['RECEPCION', 'HOUSEKEEPING'] } }, data: { active: true } });
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    person = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Cuenta sintética de horarios' });
    area = (await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } })).id;
    other = (await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } })).id;
    await prisma.user.update({ where: { id: person.id }, data: { departmentId: area } });
    collaboratorId = (await saveScheduleCollaborator(admin, { userId: person.id, departmentIds: [area, other] })).id;
    planId = (await createSchedulePlan(admin, { departmentId: area, startDate: '2090-10-01', endDate: '2090-10-08' })).id;
    templateId = (await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_ADMIN_DIA', label: 'Horario sintético', startTime: '08:00', endTime: '19:00', crossesMidnight: false })).id;
    await prisma.session.create({ data: { userId: person.id, expiresAt: new Date('2090-11-01') } });
  });
  const userInput = async (overrides: Partial<Parameters<typeof updateAdministrativeUser>[1]> = {}) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    return { id: user.id, name: user.name, email: user.email ?? undefined, emailNotificationsEnabled: user.emailNotificationsEnabled, hiddenFromSelectors: user.hiddenFromSelectors, roleId: user.roleId, departmentId: user.departmentId, phone: user.phone, active: user.active, ...overrides };
  };
  const departmentInput = async (active = false) => {
    const row = await prisma.department.findUniqueOrThrow({ where: { id: area } });
    return { id: row.id, key: row.key, name: row.name, order: row.order, active };
  };
  const add = async (date = '2090-10-03', kind: 'TURNO' | 'AUSENCIA' | 'LIBRE' = 'TURNO', chosenTemplateId = templateId) => addScheduleSlot(admin, { planId, version: (await prisma.schedulePlan.findUniqueOrThrow({ where: { id: planId } })).version, requestKey: randomUUID(), reason: 'Prueba sintética' }, { collaboratorId, date, kind, ...(kind === 'TURNO' ? { templateId: chosenTemplateId } : {}) });
  const liveSlot = () => prisma.scheduleSlot.findFirstOrThrow({ where: { planId, cancelledAt: null } });

  it.each(['desactivar', 'ocultar', 'rol no operativo'] as const)('bloquea %s con asignación futura y conserva cuenta, sesiones y auditoría', async (change) => {
    await add();
    if (change === 'rol no operativo') {
      nonOperationalRoleId = (await prisma.role.create({ data: { key: `TEST_NON_OPERATIONAL_${randomUUID()}`, name: 'Referencia sintética no operativa', level: 1, operational: false } })).id;
    }
    const input = await userInput(change === 'desactivar' ? { active: false } : change === 'ocultar' ? { hiddenFromSelectors: true } : { roleId: nonOperationalRoleId! });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    const original = await liveSlot();
    const audits = await prisma.auditLog.count();
    await expect(updateAdministrativeUser(admin, input)).rejects.toThrow('Revisa Equipo');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).toEqual(before);
    expect(await prisma.session.count({ where: { userId: person.id, revokedAt: null } })).toBe(1);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(await liveSlot()).toEqual(original);
  });

  it('bloquea eliminación lógica incluso para una cuenta heredada ya inactiva', async () => {
    await add();
    await prisma.user.update({ where: { id: person.id }, data: { active: false } });
    await expect(deleteAdministrativeUser(admin, { id: person.id, reason: 'Baja revisada' })).rejects.toThrow('vigente(s) o futura(s)');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).deletedAt).toBeNull();
    expect((await liveSlot()).cancelledAt).toBeNull();
  });

  it('incluye turnos nocturnos en curso aunque su fecha sea el día anterior', async () => {
    const night = await saveScheduleTemplate(admin, { departmentId: area, code: 'TEST_ADMIN_NOCHE', label: 'Noche sintética', startTime: '21:00', endTime: '08:00', crossesMidnight: true });
    await add('2090-10-02', 'TURNO', night.id);
    const slot = await liveSlot();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(slot.endAt!.getTime() - 3600000));
    await expect(updateAdministrativeUser(admin, await userInput({ hiddenFromSelectors: true }))).rejects.toThrow('jornadas en curso');
    await expect(saveAdministrativeDepartment(admin, await departmentInput())).rejects.toThrow('jornadas en curso');
  });

  it('incluye descansos y ausencias de hoy sin horas', async () => {
    await add('2090-10-03', 'AUSENCIA');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2090-10-03T18:00:00Z'));
    await expect(updateAdministrativeUser(admin, await userInput({ active: false }))).rejects.toThrow('Revisa Equipo');
  });

  it('no bloquea historia finalizada hoy ni asignaciones canceladas, y revoca sesiones atómicamente', async () => {
    await add();
    const slot = await liveSlot();
    await add('2090-10-05', 'LIBRE');
    const future = await prisma.scheduleSlot.findFirstOrThrow({ where: { planId, date: new Date('2090-10-05'), cancelledAt: null } });
    await cancelScheduleSlot(admin, { planId, version: (await prisma.schedulePlan.findUniqueOrThrow({ where: { id: planId } })).version, requestKey: randomUUID(), reason: 'Cancelar referencia sintética' }, future.id);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(slot.endAt!.getTime() + 1000));
    const history = await prisma.scheduleSlot.findMany({ where: { planId }, orderBy: { id: 'asc' } });
    await updateAdministrativeUser(admin, await userInput({ active: false }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).active).toBe(false);
    expect(await prisma.session.count({ where: { userId: person.id, revokedAt: null } })).toBe(0);
    expect(await prisma.scheduleSlot.findMany({ where: { planId }, orderBy: { id: 'asc' } })).toEqual(history);
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: person.id, action: 'EDITAR' } })).toBe(1);
  });

  it('el área principal cambia sin alterar pertenencias ni perfil global', async () => {
    await add();
    const memberships = await prisma.scheduleMembership.findMany({ where: { collaboratorId }, orderBy: { departmentId: 'asc' } });
    const profile = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: collaboratorId } });
    await updateAdministrativeUser(admin, await userInput({ departmentId: other }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).departmentId).toBe(other);
    expect(await prisma.scheduleMembership.findMany({ where: { collaboratorId }, orderBy: { departmentId: 'asc' } })).toEqual(memberships);
    expect(await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: collaboratorId } })).toEqual(profile);
  });

  it('revisa otras áreas y mallas borrador aunque no sean el área principal', async () => {
    await add();
    await prisma.user.update({ where: { id: person.id }, data: { departmentId: other } });
    await expect(updateAdministrativeUser(admin, await userInput({ active: false }))).rejects.toThrow('otras áreas y mallas borrador');
    await expect(saveAdministrativeDepartment(admin, await departmentInput())).rejects.toThrow('mallas borrador');
    expect((await prisma.department.findUniqueOrThrow({ where: { id: area } })).active).toBe(true);
  });

  it('permite desactivar un área sin asignaciones vigentes y conserva su malla y pertenencias', async () => {
    await saveAdministrativeDepartment(admin, await departmentInput());
    expect((await prisma.department.findUniqueOrThrow({ where: { id: area } })).active).toBe(false);
    expect(await prisma.schedulePlan.count({ where: { id: planId } })).toBe(1);
    expect(await prisma.scheduleMembership.count({ where: { collaboratorId, active: true } })).toBe(2);
  });

  it('no permite que una asignación y una desactivación de cuenta concurrentes se confirmen juntas', async () => {
    const input = await userInput({ active: false });
    const result = await Promise.allSettled([updateAdministrativeUser(admin, input), add()]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(await prisma.scheduleSlot.count({ where: { collaboratorId, ...ongoingOrFutureScheduleSlots() } })).toBe(account.active ? 1 : 0);
    for (const rejected of result.filter((r) => r.status === 'rejected')) expect(String(rejected.reason)).not.toMatch(/deadlock|P2034/i);
  });

  it('serializa la desactivación del área con nuevas asignaciones', async () => {
    const input = await departmentInput();
    const result = await Promise.allSettled([saveAdministrativeDepartment(admin, input), add()]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const department = await prisma.department.findUniqueOrThrow({ where: { id: area } });
    expect(await prisma.scheduleSlot.count({ where: { planId, cancelledAt: null } })).toBe(department.active ? 1 : 0);
    for (const rejected of result.filter((r) => r.status === 'rejected')) expect(String(rejected.reason)).not.toMatch(/deadlock|P2034/i);
  });

  it('conserva al último administrador incluso con dos bajas concurrentes', async () => {
    const second = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const base = await userInput({ active: false });
    const result = await Promise.allSettled([updateAdministrativeUser(admin, { ...base, id: admin.id, name: admin.name, roleId: admin.roleId }), updateAdministrativeUser(admin, { ...base, id: second.id, name: second.name, roleId: second.roleId })]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: { key: ROLE_KEYS.SYSTEM_ADMIN }, active: true, deletedAt: null } })).toBe(1);
  });

  it('conserva la autorización de revisión y los permisos administrativos existentes', async () => {
    const original = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    const revision = adminUserRevision(original);
    await prisma.user.update({ where: { id: person.id }, data: { name: 'Nombre vigente nuevo' } });
    await expect(updateAdministrativeUser(admin, await userInput(), revision)).rejects.toThrow('después de autorizar');
    await expect(updateAdministrativeUser({ ...admin, permissions: [] }, await userInput())).rejects.toThrow();
    const otherRole = (await prisma.role.findUniqueOrThrow({ where: { key: ROLE_KEYS.NIGHT_AUDITOR } })).id;
    await expect(updateAdministrativeUser({ ...admin, permissions: ['user.manage'] }, await userInput({ roleId: otherRole }))).rejects.toThrow('administración de roles');
    await expect(saveAdministrativeDepartment({ ...admin, permissions: ['user.manage'] }, await departmentInput())).rejects.toThrow();
  });

  it('elimina lógicamente sólo cuando no queda programación y conserva las pertenencias', async () => {
    await deleteAdministrativeUser(admin, { id: person.id, reason: 'Baja revisada sin programación' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(user.active).toBe(false); expect(user.deletedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: person.id, revokedAt: null } })).toBe(0);
    expect(await prisma.scheduleMembership.count({ where: { collaboratorId, active: true } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: person.id, action: 'ELIMINAR' } })).toBe(1);
  });
  it.each(['catálogo', 'retiro de pertenencia', 'administración'] as const)('respeta la frontera User → Department del lector de suplencias durante %s', async kind => {
    let userLocked!: () => void; const hasUser = new Promise<void>(resolve => { userLocked = resolve; });
    let writerAtUser!: () => void; const waitingWriter = new Promise<void>(resolve => { writerAtUser = resolve; });
    const wait = async (promise: Promise<void>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('No se alcanzó la frontera de locks.')), 5000); })]); }
      finally { clearTimeout(timer); }
    };
    const reader = prisma.$transaction(async tx => {
      // The unchanged substitution reader holds User SHARE before requesting area.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${person.id} FOR SHARE`;
      userLocked(); await wait(waitingWriter);
      await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${area} FOR SHARE`;
    }, { timeout: 10000 });
    void reader.catch(() => undefined);
    await wait(hasUser);
    const nativeTransaction = servicePrisma.$transaction.bind(servicePrisma);
    async function observeWriter<T>(body: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
      return nativeTransaction(async tx => {
        const query = tx.$queryRaw.bind(tx);
        const observed = new Proxy(tx, { get(target, key, receiver) {
          if (key === '$queryRaw') return async (...args: Parameters<Prisma.TransactionClient['$queryRaw']>) => {
            const sql = Array.isArray(args[0]) ? args[0].join(' ') : String(args[0]);
            if (sql.includes('FROM "User"') && sql.includes('FOR NO KEY UPDATE')) writerAtUser();
            return query(...args);
          };
          return Reflect.get(target, key, receiver);
        } }) as Prisma.TransactionClient;
        return body(observed);
      }, options);
    }
    const spy = vi.spyOn(servicePrisma, '$transaction').mockImplementationOnce(observeWriter);
    try {
      const current = await prisma.scheduleCollaborator.findUniqueOrThrow({ where: { id: collaboratorId } });
      const writer = kind === 'catálogo'
        ? saveScheduleCollaborator(admin, { userId: person.id, departmentIds: [area] })
        : kind === 'retiro de pertenencia'
          ? removeScheduleMembership(admin, { collaboratorId, departmentId: area, version: current.version, reason: 'Retiro sintético revisado' })
          : updateAdministrativeUser(admin, await userInput({ name: 'Nombre sintético actualizado' }));
      const outcomes = await Promise.allSettled([reader, writer]);
      expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    } finally { writerAtUser(); spy.mockRestore(); await Promise.allSettled([reader]); }
  });

});
