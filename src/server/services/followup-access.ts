import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
// The source's reserved visibility is checked before projecting any linked work.
export function followUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>): Prisma.FollowUpWhereInput {
  const manager = user.permissions.includes('supervision.followup.manage');
  return { deletedAt: null, OR: [
    { visibility: 'PRIVADO', createdById: user.id },
    ...(manager ? [{ visibility: 'SUPERVISION' as const }] : []),
    { visibility: 'OPERATIVO', ...(manager ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) },
  ] };
}

export function taskFollowUpReadWhere(user:Pick<CurrentUser,'id'|'permissions'>):Prisma.TaskWhereInput {
  const scope=followUpReadWhere(user);
  return {AND:[
    {OR:[{followUpId:null},{followUp:scope}]},
    {OR:[{alertId:null},{sourceAlert:{OR:[{followUpId:null},{followUp:scope}]}}]},
  ]};
}
