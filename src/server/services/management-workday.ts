import 'server-only';

import { AuditAction, SupervisionShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError, NotFoundError } from '@/server/errors';
import { recordAudit } from '@/server/audit';

const OPEN = [SupervisionShiftStatus.ACTIVO, SupervisionShiftStatus.ENTREGADO] as const;

function assertWorkdayPermission(user: CurrentUser) {
  if (!user.permissions.includes('workday.manage')) {
    throw new RuleError('No tienes permiso para gestionar una jornada de jefatura.');
  }
}

export async function managementWorkdayDepartmentIds(user: CurrentUser): Promise<string[]> {
  assertWorkdayPermission(user);
  const now = new Date();
  const [grants, memberships, delegations] = await Promise.all([
    prisma.scheduleAreaGrant.findMany({
      where: { userId: user.id },
      select: { departmentId: true },
    }),
    prisma.scheduleMembership.findMany({
      where: {
        active: true,
        collaborator: { userId: user.id, active: true },
      },
      select: { departmentId: true },
    }),
    prisma.housekeepingDelegation.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      select: { departmentId: true },
    }),
  ]);
  return [...new Set([
    ...(user.departmentId ? [user.departmentId] : []),
    ...grants.map(row => row.departmentId),
    ...memberships.map(row => row.departmentId),
    ...delegations.map(row => row.departmentId),
  ])];
}

export async function getManagementWorkday(user: CurrentUser) {
  const departmentIds = await managementWorkdayDepartmentIds(user);
  const [departments, active, recent] = await Promise.all([
    prisma.department.findMany({
      where: { active: true, id: { in: departmentIds } },
      select: { id: true, key: true, name: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    }),
    prisma.supervisionShift.findMany({
      where: {
        supervisorId: user.id,
        departmentId: { in: departmentIds },
        status: { in: [...OPEN] },
      },
      include: { department: { select: { id: true, key: true, name: true } } },
      orderBy: { startedAt: 'asc' },
    }),
    prisma.supervisionShift.findMany({
      where: {
        supervisorId: user.id,
        departmentId: { in: departmentIds },
        status: SupervisionShiftStatus.CERRADO,
      },
      include: { department: { select: { id: true, key: true, name: true } } },
      orderBy: { finishedAt: 'desc' },
      take: 10,
    }),
  ]);

  return { departments, active, recent };
}

export async function startManagementWorkday(
  user: CurrentUser,
  input: { departmentId: string },
) {
  assertWorkdayPermission(user);
  const allowed = new Set(await managementWorkdayDepartmentIds(user));
  if (!allowed.has(input.departmentId)) {
    throw new RuleError('Esa área no pertenece a tu alcance vigente.');
  }

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${input.departmentId} FOR UPDATE`;
    const department = await tx.department.findFirst({
      where: { id: input.departmentId, active: true },
      select: { id: true, name: true },
    });
    if (!department) throw new NotFoundError('El área ya no está disponible.');

    const existing = await tx.supervisionShift.findFirst({
      where: {
        supervisorId: user.id,
        departmentId: input.departmentId,
        status: { in: [...OPEN] },
      },
      select: { id: true },
    });
    if (existing) throw new RuleError('Ya tienes una jornada abierta en esa área.');

    const now = new Date();
    const shift = await tx.supervisionShift.create({
      data: {
        supervisorId: user.id,
        departmentId: input.departmentId,
        status: SupervisionShiftStatus.ACTIVO,
        priorities: [],
        openingCompletedAt: now,
        openingState: {
          version: 1,
          kind: 'MANAGEMENT_WORKDAY',
          departmentId: input.departmentId,
          startedAt: now.toISOString(),
        },
      },
    });
    await recordAudit({
      entity: 'SupervisionShift',
      entityId: shift.id,
      action: AuditAction.TURNO_INICIAR,
      summary: `Jornada de jefatura iniciada · ${department.name} · ${user.name}`,
      user,
      after: {
        departmentId: input.departmentId,
        status: shift.status,
        startedAt: shift.startedAt,
        kind: 'MANAGEMENT_WORKDAY',
      },
    }, tx);
    return shift;
  });
}

export async function finishManagementWorkday(
  user: CurrentUser,
  input: { shiftId: string; note?: string | null },
) {
  assertWorkdayPermission(user);
  const allowed = new Set(await managementWorkdayDepartmentIds(user));
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "SupervisionShift" WHERE "id" = ${input.shiftId} FOR UPDATE`;
    const shift = await tx.supervisionShift.findUnique({
      where: { id: input.shiftId },
      include: { department: { select: { id: true, name: true } } },
    });
    if (!shift || !shift.departmentId || !shift.department) {
      throw new NotFoundError('La jornada de jefatura no existe.');
    }
    if (shift.supervisorId !== user.id) {
      throw new RuleError('Sólo puedes cerrar tu propia jornada.');
    }
    if (!OPEN.includes(shift.status as (typeof OPEN)[number])) {
      throw new RuleError('La jornada ya está cerrada.');
    }

    if (!allowed.has(shift.departmentId)) {
      throw new RuleError('Tu alcance sobre esa área ya no está vigente. Solicita regularización a Administración.');
    }

    const finishedAt = new Date();
    const finished = await tx.supervisionShift.update({
      where: { id: shift.id },
      data: {
        status: SupervisionShiftStatus.CERRADO,
        finishedAt,
        deliveredAt: shift.deliveredAt ?? finishedAt,
      },
    });
    await recordAudit({
      entity: 'SupervisionShift',
      entityId: shift.id,
      action: AuditAction.TURNO_CERRAR,
      summary: `Jornada de jefatura cerrada · ${shift.department.name} · ${user.name}`,
      user,
      reason: input.note?.trim() || undefined,
      after: {
        departmentId: shift.departmentId,
        finishedAt,
        kind: 'MANAGEMENT_WORKDAY',
        continuity: 'Las tareas, seguimientos e incidencias permanecen en sus objetos de origen.',
      },
    }, tx);
    return finished;
  });
}
