import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog,
  openShiftAs,
} from './helpers';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  type PermissionKey,
} from '@/lib/permissions';
import { hasPermission } from '@/server/auth/current-user';
import { assertAssignable, assertShiftAssignable, listOperationalUsers } from '@/server/services/users';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { ShiftType } from '@prisma/client';

describe('matriz de roles y permisos', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('persiste todos los permisos del catálogo', async () => {
    const stored = await prisma.permission.findMany({ select: { key: true } });
    expect(stored.map((p) => p.key).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('el Administrador de sistema concentra el control técnico', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    for (const permission of [
      'user.manage',
      'role.manage',
      'system.configure',
      'audit.view',
      'entry.restore',
    ] as PermissionKey[]) {
      expect(hasPermission(admin, permission)).toBe(true);
    }
  });

  it('el Administrador de sistema puede participar en el ciclo de turnos', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    expect(admin.roleOperational).toBe(true);
    expect(hasPermission(admin, 'shift.start')).toBe(true);
    expect(hasPermission(admin, 'shift.receive')).toBe(true);
    expect(hasPermission(admin, 'shift.handover')).toBe(true);
  });

  it('el Administrador puede operar habitaciones y llaves con permisos explícitos', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    for (const permission of ['room.manage', 'key.assign', 'pms.import', 'housekeeping.view', 'housekeeping.manage'] as PermissionKey[]) expect(hasPermission(admin, permission)).toBe(true);
  });

  it('la matriz sembrada en la base coincide con la del código', async () => {
    /*
      La matriz se siembra al instalar, así que una base ya instalada no se
      actualiza al cambiar el código: cada cambio necesita su migración. Esta
      prueba compara ambas para que la diferencia no pase desapercibida.
    */
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: ROLE_KEYS.SYSTEM_ADMIN },
      include: { permissions: { include: { permission: true } } },
    });
    const stored = role.permissions.map((rp) => rp.permission.key).sort();
    expect(stored).toEqual([...ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN]].sort());
  });

  it('el recepcionista tiene lo necesario para operar y nada más', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    for (const permission of [
      'entry.create',
      'incident.create',
      'task.create',
      'followup.create',
      'shift.start',
      'shift.receive',
      'shift.handover',
      'shift.close',
    ] as PermissionKey[]) {
      expect(hasPermission(receptionist, permission)).toBe(true);
    }

    for (const permission of [
      'user.manage',
      'role.manage',
      'system.configure',
      'audit.view',
      'entry.delete',
      'entry.reopen',
      'shift.manage',
      'shift.reassign',
    ] as PermissionKey[]) {
      expect(hasPermission(receptionist, permission)).toBe(false);
    }
  });

  it('el supervisor puede reabrir, eliminar, auditar y programar turnos', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    for (const permission of [
      'entry.reopen',
      'entry.delete',
      'incident.manage',
      'incident.close',
      'shift.manage',
      'shift.reassign',
      'audit.view',
      'metrics.view',
    ] as PermissionKey[]) {
      expect(hasPermission(supervisor, permission)).toBe(true);
    }
    // La administración de usuarios sigue siendo exclusiva del administrador.
    expect(hasPermission(supervisor, 'user.manage')).toBe(false);
    expect(hasPermission(supervisor, 'role.manage')).toBe(false);
  });

  it('el auditor nocturno suma sus controles a la operación normal', async () => {
    const auditor = await createUser({ roleKey: ROLE_KEYS.NIGHT_AUDITOR });
    expect(hasPermission(auditor, 'nightaudit.run')).toBe(true);
    expect(hasPermission(auditor, 'incident.manage')).toBe(true);
    expect(hasPermission(auditor, 'shift.start')).toBe(true);
    expect(hasPermission(auditor, 'shift.close')).toBe(true);
  });

  it('Reservas aporta contexto operativo sin operar el mesón', async () => {
    const reservations = await createUser({ roleKey: ROLE_KEYS.RESERVATIONS_CENTER });

    for (const permission of [
      'guest.view',
      'guest.manage',
      'entry.create',
      'task.create',
      'task.assign',
      'followup.create',
      'followup.manage',
      'alert.manage',
    ] as PermissionKey[]) {
      expect(hasPermission(reservations, permission)).toBe(true);
    }

    for (const permission of [
      'shift.start',
      'shift.receive',
      'shift.handover',
      'shift.close',
      'cash.manual_in',
      'cash.manual_out',
      'key.assign',
      'key.inventory',
      'user.manage',
      'role.manage',
    ] as PermissionKey[]) {
      expect(hasPermission(reservations, permission)).toBe(false);
    }
  });

  it('Gerencia dirige y analiza sin convertirse en operador de Recepción', async () => {
    const management = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });

    for (const permission of [
      'management.dashboard.view',
      'supervision.center.view',
      'supervision.task.assign',
      'supervision.followup.manage',
      'supervision.performance.view',
      'task.create',
      'task.assign',
      'followup.create',
      'followup.manage',
      'announcement.manage',
      'audit.view',
      'cash.view',
    ] as PermissionKey[]) {
      expect(hasPermission(management, permission)).toBe(true);
    }

    for (const permission of [
      'shift.start',
      'shift.receive',
      'shift.handover',
      'shift.close',
      'cash.manual_in',
      'cash.manual_out',
      'cash.audit',
      'key.assign',
      'key.inventory',
      'guest.manage',
      'user.manage',
      'role.manage',
    ] as PermissionKey[]) {
      expect(hasPermission(management, permission)).toBe(false);
    }
  });

  it('la matriz declarada coincide con la persistida', async () => {
    for (const [roleKey, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { key: roleKey },
        include: { permissions: { include: { permission: true } } },
      });
      expect(role.permissions.map((rp) => rp.permission.key).sort()).toEqual(
        [...permissions].sort(),
      );
    }
  });
});

describe('el Administrador de sistema participa con autoría propia', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('aparece entre las personas asignables', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const assignable = await listOperationalUsers();
    const ids = assignable.map((u) => u.id);

    expect(ids).toContain(receptionist.id);
    expect(ids).toContain(admin.id);
  });

  it('un usuario oculto sigue operativo pero desaparece de los selectores', async () => {
    const hidden = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepcionista oculto',
    });
    await prisma.user.update({
      where: { id: hidden.id },
      data: { hiddenFromSelectors: true },
    });

    const selectable = await listOperationalUsers();
    expect(selectable.map((person) => person.id)).not.toContain(hidden.id);

    await expect(assertAssignable(hidden.id)).resolves.toBeUndefined();

    const shift = await openShiftAs(hidden, { type: ShiftType.DIA });
    expect(shift.assignments.some((assignment) => assignment.userId === hidden.id)).toBe(true);
  });

  it('puede figurar como responsable de un registro y recibir tareas', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    await expect(assertAssignable(admin.id)).resolves.toBeUndefined();
    const entry = await createEntry(supervisor, { type: 'NOVEDAD', title: 'Responsabilidad operativa', description: 'Asignación explícita.', priority: 'MEDIA', tags: [], requiresFollowUp: false, ownerId: admin.id });
    expect(entry.ownerId).toBe(admin.id);
    const task = await createTask(supervisor, { title: 'Tarea asignada al administrador', priority: 'MEDIA', tags: [], checklist: [], assigneeId: admin.id });
    expect(task.assigneeId).toBe(admin.id);
  });

  it('inicia un turno con su propia participación, sin saltar la recepción de Caja', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const opened = await openShiftAs(admin, { type: ShiftType.DIA });
    expect(opened.assignments.some((assignment) => assignment.userId === admin.id)).toBe(true);
    expect(opened.createdById).toBe(admin.id);
  });

  it('un usuario inactivo no puede recibir asignaciones', async () => {
    const inactive = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, active: false });
    await expect(assertAssignable(inactive.id)).rejects.toThrow(/inactivo/);
  });
  it('conserva el rechazo de roles no operativos aunque tengan permisos de turno', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const role = await prisma.role.create({ data: { key: `CONSULTA_${user.id}`, name: 'Consulta técnica', operational: false } });
    try {
      await prisma.user.update({ where: { id: user.id }, data: { roleId: role.id } });
      await expect(assertAssignable(user.id)).rejects.toThrow(/fuera de la operación/);
      await expect(assertShiftAssignable(user.id)).rejects.toThrow(/no participa/);
    } finally {
      await prisma.user.update({ where: { id: user.id }, data: { roleId: user.roleId } });
      await prisma.role.delete({ where: { id: role.id } });
    }
  });

});
