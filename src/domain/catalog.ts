import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
} from '@/lib/permissions';

/** Áreas operativas con las que arranca cualquier instalación. */
export const DEPARTMENTS = [
  { key: 'RECEPCION', name: 'Recepción', order: 1 },
  { key: 'RESERVAS', name: 'Reservas', order: 2 },
  { key: 'HOUSEKEEPING', name: 'Housekeeping', order: 3 },
  { key: 'MANTENIMIENTO', name: 'Mantenimiento', order: 4 },
  { key: 'SEGURIDAD', name: 'Seguridad', order: 5 },
  { key: 'AYB', name: 'A&B', order: 6 },
  { key: 'ADMINISTRACION', name: 'Administración', order: 7 },
  { key: 'VENTAS', name: 'Ventas', order: 8 },
  { key: 'SISTEMAS', name: 'Sistemas', order: 9 },
  { key: 'OTRO', name: 'Otro', order: 99 },
];

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Catálogo base: permisos, roles con su matriz, áreas y nombre del hotel.
 *
 * Es idempotente, de modo que puede ejecutarse tanto desde la semilla de
 * desarrollo como desde la instalación inicial de un despliegue real.
 */
export async function seedCatalog(
  client: Client,
  options: { hotelName?: string } = {},
): Promise<void> {
  for (const key of ALL_PERMISSIONS) {
    const meta = PERMISSIONS[key];
    await client.permission.upsert({
      where: { key },
      update: { name: meta.name, group: meta.group },
      create: { key, name: meta.name, group: meta.group },
    });
  }

  for (const definition of ROLE_DEFINITIONS) {
    const role = await client.role.upsert({
      where: { key: definition.key },
      update: {
        name: definition.name,
        description: definition.description,
        level: definition.level,
        operational: definition.operational,
        isSystem: true,
      },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        level: definition.level,
        operational: definition.operational,
        isSystem: true,
      },
    });

    const permissions = await client.permission.findMany({
      where: { key: { in: [...ROLE_PERMISSIONS[definition.key]] } },
      select: { id: true },
    });
    await client.rolePermission.deleteMany({ where: { roleId: role.id } });
    await client.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  for (const department of DEPARTMENTS) {
    await client.department.upsert({
      where: { key: department.key },
      update: { name: department.name, order: department.order },
      create: department,
    });
  }

  if (options.hotelName) {
    await client.systemSetting.upsert({
      where: { key: 'hotel.name' },
      update: { value: options.hotelName },
      create: {
        key: 'hotel.name',
        value: options.hotelName,
        category: 'general',
        description: 'Nombre del hotel que se muestra en la cabecera.',
      },
    });
  }
}
