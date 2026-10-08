import { entryReadWhere } from './entry-visibility';
import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { taskFollowUpReadWhere } from './followup-access';
export { followUpReadWhere as coordinationFollowUps } from './followup-access';
import { isHkFocused } from '@/domain/housekeeping-work';

export function canCoordinate(user: Pick<CurrentUser, 'id' | 'roleKey' | 'permissions'>) {
  return user.permissions.some(p => ['entry.create','entry.edit','incident.manage','task.assign','task.edit','supervision.view','management.dashboard.view'].includes(p));
}
export function coordinationEntries(user: Pick<CurrentUser, 'id' | 'roleKey' | 'permissions'>): Prisma.OperationalEntryWhereInput {
  return { deletedAt: null, isDemo: false, AND:[entryReadWhere({...user,isSystemAdmin:user.roleKey==='ADMINISTRADOR_SISTEMA'})], ...(isHkFocused(user) ? { id: { in: [] } } : canCoordinate(user) ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) };
}
export function coordinationTasks(user: Pick<CurrentUser, 'id' | 'roleKey' | 'permissions'>): Prisma.TaskWhereInput {
  return { deletedAt: null, isDemo: false, AND: [
    ...(isHkFocused(user) ? [{ id: { in: [] } }] : canCoordinate(user) ? [] : [{ OR: [{ assigneeId: user.id }, { createdById: user.id }] }]),
    taskFollowUpReadWhere(user),
  ] };
}
