import 'server-only';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { hotelDateKey } from '@/domain/time';
import { hasPermission, type CurrentUser } from '@/server/auth/current-user';
import { diffFields, recordAudit } from '@/server/audit';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import type { departmentSchema, userUpdateSchema } from '@/server/schemas';
import { adminUserRevision } from './admin-revision';

type Tx = Prisma.TransactionClient;
type UserInput = z.infer<typeof userUpdateSchema>;
type DepartmentInput = z.infer<typeof departmentSchema>;

/** Includes overnight work still running, plus undated-hours entries for today. */
export function ongoingOrFutureScheduleSlots(now = new Date()): Prisma.ScheduleSlotWhereInput {
  return {
    cancelledAt: null,
    OR: [
      { endAt: { gt: now } },
      { endAt: null, date: { gte: new Date(`${hotelDateKey(now)}T00:00:00Z`) } },
    ],
  };
}

const REVIEW_SCHEDULES = 'Revisa Equipo: cancela o reasigna primero las asignaciones futuras. Las jornadas en curso deben terminar antes de continuar. No se ha cambiado el horario.';

async function assertNoAccountSchedules(tx: Tx, userId: string) {
  const count = await tx.scheduleSlot.count({
    where: { ...ongoingOrFutureScheduleSlots(), collaborator: { userId } },
  });
  if (count) throw new RuleError(`La cuenta tiene ${count} asignación(es) vigente(s) o futura(s), incluidas las de otras áreas y mallas borrador. ${REVIEW_SCHEDULES}`);
}

async function lockAccount(tx: Tx, userId: string, departmentId?: string | null) {
  // Share User → Department → Collaborator with the catalogue/substitution reader.
  // NO KEY UPDATE still permits audit/recipient FK KEY SHARE in schedule writers.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  // Lock the destination before the collaborator: updating its FK must not acquire
  // an area while a schedule writer already holds that area and waits on this person.
  if (departmentId) await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${departmentId} FOR UPDATE`;
  const collaborator = await tx.scheduleCollaborator.findUnique({ where: { userId }, select: { id: true } });
  if (collaborator) await tx.$queryRaw`SELECT "id" FROM "ScheduleCollaborator" WHERE "id" = ${collaborator.id} FOR UPDATE`;
}

async function assertAdminRemains(tx: Tx, excludeUserId: string) {
  if (!await tx.user.count({ where: { id: { not: excludeUserId }, active: true, deletedAt: null, role: { key: ROLE_KEYS.SYSTEM_ADMIN } } })) {
    throw new RuleError('Debe existir al menos un Administrador de sistema activo. Asigna el rol a otro usuario antes de continuar.');
  }
}

/** All eligibility checks, session revocation and evidence share the account transaction. */
export async function updateAdministrativeUser(actor: CurrentUser, input: UserInput, expectedRevision?: string) {
  if (!hasPermission(actor, 'user.manage')) throw new ForbiddenError();
  return prisma.$transaction(async (tx) => {
    // Serialize removals of the last active administrators, including simultaneous changes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'admin:account-eligibility'}))::text`;
    await lockAccount(tx, input.id, input.departmentId);
    const current = await tx.user.findFirst({ where: { id: input.id, deletedAt: null }, include: { role: true } });
    if (!current) throw new NotFoundError('El usuario no existe.');
    if (expectedRevision && expectedRevision !== adminUserRevision(current)) throw new RuleError('El usuario cambió después de autorizar. Prepara una nueva propuesta.');
    const roleChanged = current.roleId !== input.roleId;
    if (roleChanged && !hasPermission(actor, 'role.manage')) throw new ForbiddenError('Cambiar roles requiere el permiso de administración de roles.');
    const role = await tx.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new NotFoundError('El rol indicado no existe.');
    if ((current.active && !input.active) || (!current.hiddenFromSelectors && input.hiddenFromSelectors) || (roleChanged && !role.operational)) {
      await assertNoAccountSchedules(tx, current.id);
    }
    if (current.role.key === ROLE_KEYS.SYSTEM_ADMIN && (roleChanged || !input.active)) await assertAdminRemains(tx, current.id);
    const data = {
      name: input.name,
      email: input.email ?? null,
      emailNotificationsEnabled: input.emailNotificationsEnabled,
      hiddenFromSelectors: input.hiddenFromSelectors,
      roleId: input.roleId,
      departmentId: input.departmentId,
      phone: input.phone,
      active: input.active,
    };
    const updated = await tx.user.update({ where: { id: current.id, updatedAt: current.updatedAt }, data, include: { role: true } });
    if (!updated.active || roleChanged) {
      await tx.session.updateMany({ where: { userId: updated.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    const changes = diffFields(current as unknown as Record<string, unknown>, data, ['name', 'email', 'emailNotificationsEnabled', 'hiddenFromSelectors', 'roleId', 'departmentId', 'phone', 'active']);
    await recordAudit({
      entity: 'User', entityId: updated.id, action: roleChanged ? 'PERMISOS' : 'EDITAR',
      summary: roleChanged ? `Rol de ${updated.name}: ${current.role.name} → ${updated.role.name}` : `Usuario ${updated.name} actualizado (${changes.changed.join(', ') || 'sin cambios'})`,
      user: actor, before: changes.before, after: changes.after,
    }, tx);
    return updated;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function deleteAdministrativeUser(actor: CurrentUser, input: { id: string; reason: string }) {
  if (!hasPermission(actor, 'user.manage')) throw new ForbiddenError();
  if (input.id === actor.id) throw new RuleError('No puedes eliminar tu propia cuenta.');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'admin:account-eligibility'}))::text`;
    await lockAccount(tx, input.id);
    const user = await tx.user.findFirst({ where: { id: input.id, deletedAt: null }, include: { role: true } });
    if (!user) throw new NotFoundError('El usuario no existe.');
    await assertNoAccountSchedules(tx, user.id);
    if (user.role.key === ROLE_KEYS.SYSTEM_ADMIN) await assertAdminRemains(tx, user.id);
    const updated = await tx.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), deletedById: actor.id, deletionReason: input.reason, active: false } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ entity: 'User', entityId: user.id, action: 'ELIMINAR', summary: `Usuario ${user.name} desactivado y eliminado lógicamente`, user: actor, reason: input.reason }, tx);
    return updated;
  }, { maxWait: 10000, timeout: 30000 });
}

export async function saveAdministrativeDepartment(actor: CurrentUser, input: DepartmentInput) {
  if (!hasPermission(actor, 'system.configure')) throw new ForbiddenError();
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      // Same boundary as plan creation, publication and schedule mutations.
      await tx.$queryRaw`SELECT "id" FROM "Department" WHERE "id" = ${input.id} FOR UPDATE`;
      const current = await tx.department.findUnique({ where: { id: input.id } });
      if (!current) throw new NotFoundError('El área no existe.');
      if (current.active && !input.active) {
        const count = await tx.scheduleSlot.count({ where: { ...ongoingOrFutureScheduleSlots(), plan: { departmentId: current.id } } });
        if (count) throw new RuleError(`El área tiene ${count} asignación(es) vigente(s) o futura(s), incluidas las de mallas borrador. ${REVIEW_SCHEDULES}`);
      }
    }
    const department = input.id
      ? await tx.department.update({ where: { id: input.id }, data: { name: input.name, order: input.order, active: input.active } })
      : await tx.department.create({ data: { key: input.key, name: input.name, order: input.order, active: input.active } });
    await recordAudit({ entity: 'Department', entityId: department.id, action: input.id ? 'EDITAR' : 'CREAR', summary: `Área ${department.name} ${input.id ? 'actualizada' : 'creada'}`, user: actor, after: { key: department.key, name: department.name, active: department.active } }, tx);
    return department;
  }, { maxWait: 10000, timeout: 30000 });
}
