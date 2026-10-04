import 'server-only';
import { Prisma } from '@prisma/client';
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

export function alertReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>): Prisma.AlertWhereInput {
  return {AND:[
    {OR:[{followUpId:null},{followUp:followUpReadWhere(user)}]},
    {OR:[{taskId:null},{task:taskFollowUpReadWhere(user)}]},
  ]};
}

/** Same reserved-source policy for the existing PostgreSQL search view.
 * Fixed aliases f/t are internal SQL identifiers, never supplied by a request. */
export function followUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  const manager = user.permissions.includes('supervision.followup.manage');
  return Prisma.sql`f."deletedAt" IS NULL AND (
    (f."visibility" = 'PRIVADO' AND f."createdById" = ${user.id}) OR
    (f."visibility" = 'SUPERVISION' AND ${manager}) OR
    (f."visibility" = 'OPERATIVO' AND (${manager} OR f."ownerId" = ${user.id} OR f."createdById" = ${user.id}))
  )`;
}

export function taskFollowUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  const scope = followUpReadSql(user);
  return Prisma.sql`(
    (t."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id = t."followUpId" AND ${scope})) AND
    (t."alertId" IS NULL OR EXISTS (SELECT 1 FROM "Alert" a WHERE a.id = t."alertId" AND
      (a."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id = a."followUpId" AND ${scope}))))
  )`;
}

export function alertReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  return Prisma.sql`(
    (a."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id = a."followUpId" AND ${followUpReadSql(user)})) AND
    (a."taskId" IS NULL OR EXISTS (SELECT 1 FROM "Task" t WHERE t.id = a."taskId" AND ${taskFollowUpReadSql(user)}))
  )`;
}
