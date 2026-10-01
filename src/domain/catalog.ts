import { KeyStatus, KeyType } from '@prisma/client';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
} from '@/lib/permissions';
import { roomNumbers } from '@/domain/room-catalog';
export { roomNumbers } from '@/domain/room-catalog';

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
 * Denominaciones de efectivo en circulación.
 *
 * Es CATÁLOGO: no cambia con la operación, así que se siembra siempre. Lo que
 * NO se siembra acá es el fondo fijo (`CashFund`), porque cuánto dinero debe
 * quedar en el cajón es una decisión de cada hotel y su existencia es la que
 * activa la exigencia de arqueo. Un despliegue nuevo tiene las denominaciones
 * listas y ninguna obligación hasta que alguien configure el fondo.
 *
 * El valor va en la unidad de la divisa, no en la menor: 20000 son veinte mil
 * pesos y 100 son cien dólares. La conversión a unidad menor la hace
 * `domain/cash.ts`, que es quien sabe que el peso no usa centavos.
 */
export const CASH_DENOMINATIONS: Array<{
  currency: string;
  value: number;
  medium: 'BILLETE' | 'MONEDA';
}> = [
  { currency: 'CLP', value: 20000, medium: 'BILLETE' },
  { currency: 'CLP', value: 10000, medium: 'BILLETE' },
  { currency: 'CLP', value: 5000, medium: 'BILLETE' },
  { currency: 'CLP', value: 2000, medium: 'BILLETE' },
  { currency: 'CLP', value: 1000, medium: 'BILLETE' },
  { currency: 'CLP', value: 500, medium: 'MONEDA' },
  { currency: 'CLP', value: 100, medium: 'MONEDA' },
  { currency: 'CLP', value: 50, medium: 'MONEDA' },
  { currency: 'CLP', value: 10, medium: 'MONEDA' },
  { currency: 'USD', value: 100, medium: 'BILLETE' },
  { currency: 'USD', value: 50, medium: 'BILLETE' },
  { currency: 'USD', value: 20, medium: 'BILLETE' },
  { currency: 'USD', value: 10, medium: 'BILLETE' },
  { currency: 'USD', value: 5, medium: 'BILLETE' },
  { currency: 'USD', value: 1, medium: 'BILLETE' },
];

/** Copias de llave sin asignar con las que arranca el stock del Supervisor. */
const SPARE_KEYS = 12;

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Catálogo base: permisos, roles con su matriz, áreas y nombre del hotel.
 *
 * Es idempotente, de modo que puede ejecutarse tanto desde la semilla de
 * desarrollo como desde la instalación inicial de un despliegue real.
 */
/**
 * Catálogo base: permisos, roles con su matriz, áreas, habitaciones y llaves.
 *
 * Es idempotente, de modo que puede ejecutarse tanto desde la semilla de
 * desarrollo como desde la instalación inicial de un despliegue real.
 *
 * Está escrito por lotes a propósito. La versión anterior hacía un `upsert`
 * por fila —más de doscientas consultas— y eso sólo es barato cuando la base
 * está en la misma máquina. En un despliegue real la función y la base pueden
 * estar en continentes distintos, con unos 120 ms por consulta, y la
 * transacción se agotaba antes de terminar. Ahora son una decena de consultas,
 * cada una con todas sus filas.
 */
export async function seedCatalog(
  client: Client,
  options: { hotelName?: string } = {},
): Promise<void> {
  // --- Permisos -----------------------------------------------------------
  await client.permission.createMany({
    data: ALL_PERMISSIONS.map((key) => ({
      key,
      name: PERMISSIONS[key].name,
      group: PERMISSIONS[key].group,
    })),
    skipDuplicates: true,
  });

  // --- Roles --------------------------------------------------------------
  await client.role.createMany({
    data: ROLE_DEFINITIONS.map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      level: definition.level,
      operational: definition.operational,
      isSystem: true,
    })),
    skipDuplicates: true,
  });

  const roles = await client.role.findMany({ select: { id: true, key: true } });
  const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));

  /*
    Los roles que ya existían pueden traer nombre o nivel antiguos: se
    actualizan, que son cuatro filas. Los permisos y las áreas no se tocan
    porque su nombre no cambia con el tiempo.
  */
  for (const definition of ROLE_DEFINITIONS) {
    const id = roleIdByKey.get(definition.key);
    if (!id) continue;
    await client.role.update({
      where: { id },
      data: {
        name: definition.name,
        description: definition.description,
        level: definition.level,
        operational: definition.operational,
        isSystem: true,
      },
    });
  }

  // --- Matriz de permisos por rol -----------------------------------------
  const permissions = await client.permission.findMany({
    select: { id: true, key: true },
  });
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  const matrix: Array<{ roleId: string; permissionId: string }> = [];
  for (const definition of ROLE_DEFINITIONS) {
    const roleId = roleIdByKey.get(definition.key);
    if (!roleId) continue;
    for (const key of ROLE_PERMISSIONS[definition.key]) {
      const permissionId = permissionIdByKey.get(key);
      if (permissionId) matrix.push({ roleId, permissionId });
    }
  }

  // La matriz se reemplaza completa: es la definición vigente del código.
  await client.rolePermission.deleteMany({
    where: { roleId: { in: [...roleIdByKey.values()] } },
  });
  await client.rolePermission.createMany({ data: matrix, skipDuplicates: true });

  // --- Áreas --------------------------------------------------------------
  await client.department.createMany({ data: DEPARTMENTS, skipDuplicates: true });
  const receptionArea = await client.department.findUnique({ where: { key: 'RECEPCION' }, select: { id: true } });
  if (receptionArea) await client.scheduleTemplate.createMany({
    data: [
      { code: 'RD01', startTime: '08:00', endTime: '19:00', crossesMidnight: false },
      { code: 'RD02', startTime: '11:00', endTime: '22:00', crossesMidnight: false },
      { code: 'RN01', startTime: '21:00', endTime: '08:00', crossesMidnight: true },
    ].map((t) => ({ ...t, id: `schedule_template_recepcion_${t.code.toLowerCase()}_1`, departmentId: receptionArea.id, label: `Glosa de recepción ${t.code}`, revision: 1 })),
    skipDuplicates: true,
  });

  // --- Habitaciones y llaves ----------------------------------------------
  await client.room.createMany({ data: roomNumbers(), skipDuplicates: true });

  const rooms = await client.room.findMany({ select: { id: true, number: true } });

  await client.roomKey.createMany({
    data: [
      // La llave principal pertenece a su habitación desde el primer día.
      ...rooms.map((room) => ({
        code: `P-${room.number}`,
        type: KeyType.PRINCIPAL,
        status: KeyStatus.DISPONIBLE,
        roomId: room.id,
      })),
      // Stock del Supervisor: copias sin destino.
      ...Array.from({ length: SPARE_KEYS }, (_, index) => ({
        code: `C-${String(index + 1).padStart(2, '0')}`,
        type: KeyType.COPIA,
        status: KeyStatus.DISPONIBLE,
      })),
    ],
    skipDuplicates: true,
  });

  /*
    Una llave principal creada por una versión anterior pudo quedar sin
    habitación asociada. Se vincula por su código en una sola sentencia.
  */
  await client.$executeRaw`
    UPDATE "RoomKey" AS k
    SET "roomId" = r.id
    FROM "Room" AS r
    WHERE k."type" = 'PRINCIPAL' AND k."roomId" IS NULL AND k."code" = 'P-' || r."number"
  `;

  // --- Denominaciones de efectivo -----------------------------------------
  await client.cashDenomination.createMany({
    data: CASH_DENOMINATIONS.map((denomination, index) => ({
      currency: denomination.currency,
      value: denomination.value,
      medium: denomination.medium,
      order: index,
    })),
    skipDuplicates: true,
  });

  // --- Nombre del hotel ---------------------------------------------------
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
