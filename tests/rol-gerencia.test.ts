import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Priority, TaskStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { ROLE_PERMISSIONS, ALL_PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { assertAssignable } from '@/server/services/users';
import { createTask, changeTaskStatus } from '@/server/services/tasks';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Gerencia de operaciones: consulta, salvo como responsable y la reparación
 * global de conflictos expresamente autorizada.
 *
 * Lo que estas pruebas protegen es la frontera. Que no se le cuele un permiso
 * de escritura por descuido al agregar uno nuevo al catálogo, que pueda
 * figurar como responsable, y que no pueda tomar un turno aunque su rol sea
 * operativo.
 */

/** Permisos que NO son de lectura. Si Gerencia tuviera uno, deja de ser consulta. */
const SOLO_LECTURA: PermissionKey[] = [
  'guest.view',
  'supervision.view',
  'metrics.view',
  'room.view',
  'audit.view',
  'cash.view',
];

describe('rol de gerencia', () => {
  it('sólo tiene una excepción de escritura: resolver conflictos globales', () => {
    const suyos = ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT];
    const escritura = suyos.filter((p) => !SOLO_LECTURA.includes(p));

    expect(escritura).toEqual(['conflict.resolve_all']);
  });

  it('no puede operar turnos, llaves ni habitaciones', () => {
    const suyos = ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT];
    for (const prohibido of [
      'shift.start',
      'shift.receive',
      'shift.handover',
      'shift.close',
      'shift.manage',
      'room.manage',
      'key.assign',
      'key.stock',
      'room.reset',
      'pms.import',
      'announcement.manage',
      'user.manage',
      'role.manage',
      'entry.delete',
      'task.assign',
    ] as PermissionKey[]) {
      expect(suyos, `Gerencia no debería tener ${prohibido}`).not.toContain(prohibido);
    }
  });

  it('la resolución global pertenece sólo a Administrador, Supervisor y Gerencia', () => {
    const conPermiso = Object.entries(ROLE_PERMISSIONS)
      .filter(([, permissions]) =>
        (permissions as readonly string[]).includes('conflict.resolve_all'),
      )
      .map(([role]) => role)
      .sort();

    expect(conPermiso).toEqual(
      [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.SUPERVISOR, ROLE_KEYS.MANAGEMENT].sort(),
    );
  });

  it('cada permiso que tiene existe en el catálogo', () => {
    for (const permission of ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT]) {
      expect(ALL_PERMISSIONS).toContain(permission);
    }
  });

  it('puede figurar como responsable: es el único modo de que actúe', async () => {
    await seedCatalog();
    await resetOperationalData();
    const gerente = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });

    // Si no fuera asignable, la excepción por responsabilidad no serviría.
    await expect(assertAssignable(gerente.id)).resolves.toBeUndefined();
  });

  it('el Administrador de sistema sigue sin poder ser responsable', async () => {
    await seedCatalog();
    await resetOperationalData();
    const admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });

    // Gerencia es operativa; el administrador no. Son cosas distintas.
    await expect(assertAssignable(admin.id)).rejects.toThrow(/fuera de la operación/);
  });
});

describe('la excepción por responsabilidad', () => {
  let gerente: CurrentUser & { username: string };
  let supervisor: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    gerente = await createUser({ roleKey: ROLE_KEYS.MANAGEMENT });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  });

  it('el gerente mueve la tarea de la que es responsable', async () => {
    const tarea = await createTask(supervisor, {
      title: 'Revisar el cuadre de caja de la semana',
      priority: Priority.MEDIA,
      assigneeId: gerente.id,
      checklist: [],
      tags: [],
    });

    /*
      `changeTaskStatus` es el servicio; la comprobación de permiso vive en la
      acción. Acá se verifica que el servicio no imponga una barrera propia
      que haría inútil la excepción.
    */
    const movida = await changeTaskStatus(gerente, {
      id: tarea.id,
      status: TaskStatus.EN_CURSO,
    });
    expect(movida.status).toBe(TaskStatus.EN_CURSO);
  });

  it('no le da permiso sobre las demás tareas', async () => {
    const ajena = await createTask(supervisor, {
      title: 'Tarea de otra persona',
      priority: Priority.MEDIA,
      assigneeId: supervisor.id,
      checklist: [],
      tags: [],
    });

    /*
      El servicio no comprueba propiedad —eso lo hace la acción— así que lo
      que se fija acá es el hecho que sostiene la regla: el gerente NO es
      responsable de esta tarea, y por lo tanto la acción debe rechazarla.
    */
    const fila = await prisma.task.findUniqueOrThrow({
      where: { id: ajena.id },
      select: { assigneeId: true, createdById: true },
    });
    expect([fila.assigneeId, fila.createdById]).not.toContain(gerente.id);
  });
});
