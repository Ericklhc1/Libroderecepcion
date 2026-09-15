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
  { key: 'AREAS_PUBLICAS', name: 'Áreas públicas', order: 10 },
  { key: 'OTRO', name: 'Otro', order: 99 },
];

/**
 * Inventario de habitaciones del hotel: pisos 4, 5 y 6.
 *
 * Es el catálogo real del Hotel HW Libertad. Las habitaciones son la entidad
 * central del módulo operativo, así que existen desde la instalación y no
 * dependen de que un informe del PMS las mencione.
 */
export const ROOM_RANGES = [
  { floor: 4, from: 401, to: 429 },
  { floor: 5, from: 501, to: 530 },
  { floor: 6, from: 601, to: 630 },
];

export function roomNumbers(): Array<{ number: string; floor: number }> {
  const rooms: Array<{ number: string; floor: number }> = [];
  for (const range of ROOM_RANGES) {
    for (let number = range.from; number <= range.to; number += 1) {
      rooms.push({ number: String(number), floor: range.floor });
    }
  }
  return rooms;
}

/** Copias de llave sin asignar con las que arranca el stock del Supervisor. */
const SPARE_KEYS = 12;

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

  /*
    Habitaciones y llaves. Cada habitación nace con su llave principal en el
    inventario (disponible, no asignada: nadie ha hecho check-in todavía) y el
    stock del Supervisor arranca con un puñado de copias sin destino.
  */
  for (const room of roomNumbers()) {
    const created = await client.room.upsert({
      where: { number: room.number },
      update: { floor: room.floor },
      create: { number: room.number, floor: room.floor },
    });
    // La llave principal pertenece a la habitación desde el primer día: queda
    // ligada a ella aunque todavía no se haya entregado a nadie.
    await client.roomKey.upsert({
      where: { code: `P-${room.number}` },
      update: { roomId: created.id },
      create: {
        code: `P-${room.number}`,
        type: 'PRINCIPAL',
        status: 'DISPONIBLE',
        roomId: created.id,
      },
    });
  }

  for (let index = 1; index <= SPARE_KEYS; index += 1) {
    const code = `C-${String(index).padStart(2, '0')}`;
    await client.roomKey.upsert({
      where: { code },
      update: {},
      create: { code, type: 'COPIA', status: 'DISPONIBLE' },
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
