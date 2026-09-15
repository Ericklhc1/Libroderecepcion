import { AssignmentRole, PrismaClient, ShiftStatus, ShiftType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
  ROLE_KEYS,
  type PermissionKey,
  type RoleKey,
} from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { plannedWindow } from '@/domain/shift';

export const prisma = new PrismaClient();

export const TEST_PASSWORD = 'PruebaSegura1';

const DEPARTMENTS = [
  { key: 'RECEPCION', name: 'Recepción', order: 1 },
  { key: 'MANTENIMIENTO', name: 'Mantenimiento', order: 2 },
  { key: 'HOUSEKEEPING', name: 'Housekeeping', order: 3 },
];

/** Catálogo base: permisos, roles y áreas. Idempotente. */
export async function seedCatalog() {
  for (const key of ALL_PERMISSIONS) {
    const meta = PERMISSIONS[key];
    await prisma.permission.upsert({
      where: { key },
      update: { name: meta.name, group: meta.group },
      create: { key, name: meta.name, group: meta.group },
    });
  }

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: {
        name: definition.name,
        level: definition.level,
        operational: definition.operational,
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
    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...ROLE_PERMISSIONS[definition.key]] } },
      select: { id: true },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  for (const department of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { key: department.key },
      update: {},
      create: department,
    });
  }
}

/** Borra los datos operativos y de usuarios, conservando el catálogo base. */
export async function resetOperationalData() {
  await prisma.$transaction([
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
