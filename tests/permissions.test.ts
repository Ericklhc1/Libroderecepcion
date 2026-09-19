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
import { assertAssignable, listOperationalUsers } from '@/server/services/users';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createShift } from './helpers';
import { ShiftType } from '@prisma/client';
import { RuleError } from '@/server/errors';

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

  it('el Administrador de sistema queda fuera del ciclo de turnos', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    expect(admin.roleOperational).toBe(false);
    expect(hasPermission(admin, 'shift.start')).toBe(false);
    expect(hasPermission(admin, 'shift.receive')).toBe(false);
    expect(hasPermission(admin, 'shift.handover')).toBe(false);
  });

  it('el Administrador de sistema no opera el mesón pero sí carga los informes', async () => {
    /*
      La regla del proyecto es que no aparezca como responsable operativo de
      nada: no inicia, recibe ni entrega turno, no confirma salidas ni
      entradas, no entrega llaves.

      Importar los tres informes del PMS no es eso: es alimentar el sistema
      con su fuente de datos y no asigna a nadie. Excluirlo dejaba un
      callejón sin salida —en un hotel recién instalado la única cuenta es la
      suya y no podía cargar el primer día— sin proteger nada.
    */
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    expect(hasPermission(admin, 'pms.import')).toBe(true);
    expect(hasPermission(admin, 'room.view')).toBe(true);

    for (const operational of ['room.manage', 'key.assign'] as PermissionKey[]) {
      expect(hasPermission(admin, operational)).toBe(false);
    }
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
    ] as PermissionKey[]) {
      expect(hasPermission(receptionist, permission)).toBe(false);
    }
  });

  it('el recepcionista opera Caja rutinaria sin autorización implícita', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    for (const permission of [
      'cash.view',
      'cash.manual_in',
      'cash.manual_out',
      'cash.audit',
      'cash.guarantee_in',
      'cash.guarantee_out',
      'cash.treasury_transfer',
      'cash.count_declare',
      'cash.count_receive',
      'cash.usd_rate',
      'cash.close',
    ] as PermissionKey[]) {
      expect(hasPermission(receptionist, permission)).toBe(true);
    }
    expect(hasPermission(receptionist, 'cash.reopen')).toBe(false);
  });

  it('el supervisor puede reabrir, eliminar, auditar y programar turnos', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    for (const permission of [
      'entry.reopen',
      'entry.delete',
      'incident.manage',
      'incident.close',
      'shift.manage',
      'audit.view',
      'metrics.view',
      'cash.reopen',
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

describe('el Administrador de sistema no participa en la operación', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('no aparece entre las personas asignables', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const assignable = await listOperationalUsers();
    const ids = assignable.map((u) => u.id);

    expect(ids).toContain(receptionist.id);
    expect(ids).not.toContain(admin.id);
  });

  it('no puede figurar como responsable de un registro', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    await expect(assertAssignable(admin.id)).rejects.toThrow(/fuera de la operación/);

    await expect(
      createEntry(supervisor, {
        type: 'NOVEDAD',
        title: 'Registro de prueba con responsable inválido',
        description: 'El administrador no puede ser responsable operativo.',
        priority: 'MEDIA',
        tags: [],
        requiresFollowUp: false,
        ownerId: admin.id,
      }),
    ).rejects.toThrow(/fuera de la operación/);
  });

  it('no puede recibir tareas asignadas', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    await expect(
      createTask(supervisor, {
        title: 'Tarea con asignado inválido',
        priority: 'MEDIA',
        tags: [],
        checklist: [],
        assigneeId: admin.id,
      }),
    ).rejects.toThrow(/fuera de la operación/);
  });

  it('no puede iniciar un turno aunque esté asignado', async () => {
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    const shift = await createShift({ userId: admin.id, type: ShiftType.DIA });

    await expect(openShiftAs(admin, shift)).rejects.toThrow(RuleError);
    await expect(openShiftAs(admin, shift)).rejects.toThrow(
      /no participa en la operación de turnos/,
    );
  });

  it('un usuario inactivo no puede recibir asignaciones', async () => {
    const inactive = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, active: false });
    await expect(assertAssignable(inactive.id)).rejects.toThrow(/inactivo/);
  });
});
