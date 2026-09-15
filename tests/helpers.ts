import { AssignmentRole, PrismaClient, ShiftStatus, ShiftType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS, type PermissionKey, type RoleKey } from '@/lib/permissions';
import { seedCatalog as domainSeedCatalog } from '@/domain/catalog';
import type { CurrentUser } from '@/server/auth/current-user';
import { plannedWindow } from '@/domain/shift';

export const prisma = new PrismaClient();

export const TEST_PASSWORD = 'PruebaSegura1';

/**
 * Catálogo base para las pruebas.
 *
 * Reutiliza la misma siembra que usan la instalación real y la semilla de
 * desarrollo: si hubiera una copia aparte, las pruebas podrían pasar contra un
 * catálogo que no existe en producción.
 */
export async function seedCatalog() {
  await domainSeedCatalog(prisma);
}

/**
 * Borra los datos que genera la operación y deja el catálogo intacto.
 *
 * Las estadías y los lotes de importación entran acá aunque hablen de
 * habitaciones: los crea la operación, no la siembra, y **referencian al
 * usuario que los creó**. Sin borrarlos, `user.deleteMany()` choca contra la
 * clave ajena de `PmsImportBatch` y revienta cualquier archivo de pruebas que
 * corra después de uno que haya importado algo.
 *
 * El orden importa: los movimientos de llave y las estadías antes que los
 * lotes, y las llaves se desligan de la estadía en lugar de borrarse, porque
 * son catálogo.
 */
export async function resetOperationalData() {
  await prisma.$transaction([
    prisma.keyMovement.deleteMany(),
    prisma.roomKey.updateMany({ data: { stayId: null } }),
    prisma.roomStay.deleteMany(),
    prisma.pmsImportBatch.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.taskChecklistItem.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.followUp.deleteMany(),
    prisma.task.deleteMany(),
    prisma.operationalEntry.deleteMany(),
    prisma.handoverItem.deleteMany(),
    prisma.shiftHandover.deleteMany(),
    prisma.shiftAssignment.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.reservationReference.deleteMany(),
    prisma.guestReference.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

/**
 * Devuelve el inventario de habitaciones y llaves a su estado sembrado.
 *
 * Habitaciones y llaves son catálogo, así que `resetOperationalData` no las
 * borra. Pero una prueba que agrega una llave extra —para provocar el
 * conflicto de dos principales, por ejemplo— la deja ahí para todos los
 * archivos que corran después, sobre la misma base. Este reinicio lo evita, y
 * se comparte en lugar de repetirse en cada archivo.
 *
 * Hay que llamarlo **antes** de volver a sembrar.
 */
export async function resetRoomsAndKeys() {
  await prisma.keyMovement.deleteMany();
  await prisma.roomKey.updateMany({ data: { stayId: null } });
  await prisma.roomStay.deleteMany();
  await prisma.pmsImportBatch.deleteMany();
  await prisma.roomKey.deleteMany();
  await prisma.room.deleteMany();
}

export async function createUser(options: {
  roleKey: RoleKey;
  email?: string;
  name?: string;
  password?: string;
  active?: boolean;
}): Promise<CurrentUser & { passwordPlain: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: options.roleKey },
    include: { permissions: { include: { permission: true } } },
  });
  const password = options.password ?? TEST_PASSWORD;
  const email = options.email ?? `${role.key.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.local`;

  const user = await prisma.user.create({
    data: {
      email,
      name: options.name ?? `Usuario ${role.name}`,
      username: `U${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      passwordHash: await bcrypt.hash(password, 4),
      roleId: role.id,
      active: options.active ?? true,
    },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    sessionId: 'sesion-de-prueba',
    roleId: role.id,
    roleKey: role.key,
    roleName: role.name,
    roleLevel: role.level,
    roleOperational: role.operational,
    departmentId: null,
    mustChangePassword: false,
    permissions: role.permissions.map((rp) => rp.permission.key as PermissionKey),
    isSystemAdmin: role.key === ROLE_KEYS.SYSTEM_ADMIN,
    passwordPlain: password,
  };
}

/** Crea un turno programado y asigna al usuario como titular. */
export async function createShift(options: {
  userId?: string;
  type: ShiftType;
  dayOffset?: number;
  status?: ShiftStatus;
}) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + (options.dayOffset ?? 0));
  const window = plannedWindow(date, options.type);

  return prisma.shift.create({
    data: {
      date,
      type: options.type,
      status: options.status ?? ShiftStatus.PROGRAMADO,
      plannedStart: window.start,
      plannedEnd: window.end,
      ...(options.userId
        ? {
            assignments: {
              create: [{ userId: options.userId, role: AssignmentRole.TITULAR }],
            },
          }
        : {}),
    },
    include: { assignments: true },
  });
}

export { ROLE_KEYS, ShiftStatus, ShiftType };
