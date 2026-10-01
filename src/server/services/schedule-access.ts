import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError } from '@/server/errors';
import { scheduleAllowed, scheduleTeamAccess } from '@/domain/schedule';

export type ScheduleClient = PrismaClient | Prisma.TransactionClient;
export function assertSchedulePermission(user: CurrentUser, permission?: PermissionKey) {
  if (!scheduleAllowed(user, permission)) throw new ForbiddenError('Equipo y horarios no está habilitado para esta acción.');
}
export async function scheduleAreaIds(user: CurrentUser, read = false, client: ScheduleClient = prisma): Promise<string[] | null> {
  assertSchedulePermission(user);
  if (user.roleKey === 'ADMINISTRADOR_SISTEMA' || user.permissions.includes('schedule.configure') || (read && user.permissions.includes('schedule.view.all'))) return null;
  const grants = await client.scheduleAreaGrant.findMany({ where: { userId: user.id }, select: { departmentId: true } });
  return [...new Set([...(user.departmentId ? [user.departmentId] : []), ...grants.map((g) => g.departmentId)])];
}
export async function assertScheduleArea(user: CurrentUser, departmentId: string, permission: PermissionKey, client: ScheduleClient = prisma) {
  assertSchedulePermission(user, permission);
  const scope = await scheduleAreaIds(user, permission === 'schedule.view' || permission === 'schedule.view.all', client);
  if (scope && !scope.includes(departmentId)) throw new ForbiddenError('Esta área está fuera de tu alcance autorizado.');
}
export async function scheduleAuditVisibility(user: CurrentUser): Promise<Prisma.AuditLogWhereInput> {
  if (user.roleKey === 'ADMINISTRADOR_SISTEMA') return {};
  const outside = { NOT: { entity: { startsWith: 'Schedule' } } };
  if (!scheduleAllowed(user) || !scheduleTeamAccess(user)) return outside;
  const areas = await scheduleAreaIds(user, true);
  const departments = await prisma.department.findMany({ where: { ...(areas ? { id: { in: areas } } : {}) }, select: { id: true } });
  const writeAreas = await scheduleAreaIds(user);
  const manageable = departments.filter((d) => !writeAreas || writeAreas.includes(d.id));
  const manage = scheduleAllowed(user, 'schedule.manage') || scheduleAllowed(user, 'schedule.publish');
  const plans = await prisma.schedulePlan.findMany({ where: { departmentId: { in: departments.map((d) => d.id) }, OR: [{ status: 'PUBLICADO' }, ...(manage ? [{ departmentId: { in: manageable.map((d) => d.id) } }] : [])] }, select: { id: true } });
  return { OR: [outside, { entity: 'SchedulePlan', entityId: { in: plans.map((p) => p.id) } }, ...(scheduleAllowed(user, 'schedule.catalog.manage') ? [{ entity: 'ScheduleCatalog', entityId: { in: manageable.map((d) => d.id) } }] : [])] };
}
