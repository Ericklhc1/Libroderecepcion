import { AssignmentRole, KeyStatus, PrismaClient, ShiftStatus, ShiftType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS, type PermissionKey, type RoleKey } from '@/lib/permissions';
import { seedCatalog as domainSeedCatalog } from '@/domain/catalog';
import type { CurrentUser } from '@/server/auth/current-user';
import { plannedWindow } from '@/domain/shift';
import { addCalendarDateDays, hotelCalendarDate } from '@/domain/time';

export const prisma = new PrismaClient();

export const TEST_PASSWORD = 'PruebaSegura1';

export async function seedCatalog() {
  await domainSeedCatalog(prisma);
}

/**
 * Borra los datos que genera la operación y deja el catálogo intacto.
 * Las tablas creadas deliberadamente por SQL (sin modelos Prisma) se limpian
 * primero: ambas tienen FK hacia User/Shift y, si quedaran vivas, contaminarían
 * archivos de pruebas posteriores.
 */
export async function resetOperationalData() {
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationPdfDraft"');
  await prisma.$executeRawUnsafe('DELETE FROM "ShiftCashClosure"');

  await prisma.$transaction([
    prisma.keyMovement.deleteMany(),
    prisma.roomKey.updateMany({
      data: {
        stayId: null,
        status: KeyStatus.DISPONIBLE,
        assignedAt: null,
        assignedById: null,
      },
    }),
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
    prisma.cashMovement.deleteMany(),
    prisma.cashAudit.deleteMany(),
    prisma.gymPass.deleteMany(),
    prisma.assistantActionReceipt.deleteMany(),
    prisma.ai_message.deleteMany(),
    prisma.ai_memory.deleteMany(),
    prisma.ai_conversation.deleteMany(),
    prisma.operationalEntry.deleteMany(),
    prisma.fine.deleteMany(),
    prisma.checklistRunItem.deleteMany(),
    prisma.checklistRun.deleteMany(),
    prisma.checklistTemplateItem.deleteMany(),
    prisma.checklistTemplate.deleteMany(),
    prisma.announcementRead.deleteMany(),
    prisma.announcement.deleteMany(),
    prisma.mailSettings.deleteMany(),
    prisma.handoverItem.deleteMany(),
    prisma.cashCountLine.deleteMany(),
    prisma.cashCount.deleteMany(),
    prisma.cashTransfer.deleteMany(),
    prisma.handoverElement.deleteMany(),
    prisma.cashFund.deleteMany(),
    prisma.handoverElementType.deleteMany(),
    prisma.systemSetting.deleteMany(),
    prisma.shiftHandover.deleteMany(),
    prisma.shiftAssignment.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.guarantee.deleteMany(),
    prisma.reservationReference.deleteMany(),
    prisma.guestReference.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

export async function resetRoomsAndKeys() {
  await prisma.fine.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.gymPass.deleteMany();
  await prisma.keyMovement.deleteMany();
  await prisma.roomKey.updateMany({ data: { stayId: null } });
  await prisma.roomStay.deleteMany();
  await prisma.pmsImportBatch.deleteMany();
  await prisma.roomKey.deleteMany();
  await prisma.room.deleteMany();
}

export async function createUser(options: {
  roleKey: RoleKey;
  name?: string;
  password?: string;
  active?: boolean;
  username?: string;
}): Promise<CurrentUser & { passwordPlain: string; username: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: options.roleKey },
    include: { permissions: { include: { permission: true } } },
  });
  const password = options.password ?? TEST_PASSWORD;

  const user = await prisma.user.create({
    data: {
      name: options.name ?? `Usuario ${role.name}`,
      username:
        options.username ??
        `U${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      passwordHash: await bcrypt.hash(password, 4),
      roleId: role.id,
      active: options.active ?? true,
    },
  });

  return {
    id: user.id,
    name: user.name,
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
    username: user.username,
  };
}

export async function createShift(options: {
  userId?: string;
  type: ShiftType;
  dayOffset?: number;
  status?: ShiftStatus;
}) {
  const date = addCalendarDateDays(hotelCalendarDate(), options.dayOffset ?? 0);
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

export async function openShiftAs(
  user: CurrentUser,
  slot?: { type?: ShiftType; date?: Date },
) {
  const { openShift } = await import('@/server/services/shifts');
  const result = await openShift(user, {
    type: slot?.type ?? null,
    date: slot?.date ?? null,
  });
  return result.shift;
}

/** Limpia la pizarra sin disparar reglas de cierre real de Caja. */
export async function closeAllShifts() {
  const now = new Date();
  await prisma.$transaction([
    prisma.shiftAssignment.updateMany({
      where: { activatedAt: { not: null }, leftAt: null },
      data: { leftAt: now },
    }),
    prisma.shift.updateMany({
      where: {
        status: {
          in: [ShiftStatus.INICIADO, ShiftStatus.ACTIVO, ShiftStatus.PREPARANDO_ENTREGA],
        },
      },
      data: { status: ShiftStatus.ANULADO, actualEnd: now },
    }),
  ]);
}

export { ROLE_KEYS, ShiftStatus, ShiftType };