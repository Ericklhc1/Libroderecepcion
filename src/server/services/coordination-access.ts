import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { followUpReadWhere } from './followup-access';
export { followUpReadWhere as coordinationFollowUps } from './followup-access';
import { isHkFocused } from '@/domain/housekeeping-work';

export function canCoordinate(user: CurrentUser) {
  return user.permissions.some(p => ['entry.create','entry.edit','incident.manage','task.assign','task.edit','supervision.view','management.dashboard.view'].includes(p));
}
export function coordinationEntries(user: CurrentUser): Prisma.OperationalEntryWhereInput {
  return { deletedAt: null, isDemo: false, ...(isHkFocused(user) ? { id: { in: [] } } : canCoordinate(user) ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) };
}
export function coordinationTasks(user: CurrentUser): Prisma.TaskWhereInput {
  const scope = followUpReadWhere(user);
  return { deletedAt: null, isDemo: false, AND: [
    ...(isHkFocused(user) ? [{ id: { in: [] } }] : canCoordinate(user) ? [] : [{ OR: [{ assigneeId: user.id }, { createdById: user.id }] }]),
    { OR: [{ followUpId: null }, { followUp: scope }] },
    { OR: [{ alertId: null }, { sourceAlert: { OR: [{ followUpId: null }, { followUp: scope }] } }] },
  ] };
}
