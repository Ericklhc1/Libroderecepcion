import 'server-only';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
// The source's reserved visibility is checked before projecting any linked work.
export function followUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>, includeDeleted = false, shared = false): Prisma.FollowUpWhereInput {
  const manager = user.permissions.includes('supervision.followup.manage');
  return { ...(includeDeleted ? {} : {deletedAt: null}), ...(shared ? {visibility:'OPERATIVO' as const}:{}), OR: [
    { visibility: 'PRIVADO', createdById: user.id },
    ...(manager ? [{ visibility: 'SUPERVISION' as const }] : []),
    { visibility: 'OPERATIVO', ...(manager ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) },
  ] };
}

function taskSourceReadWhere(user:Pick<CurrentUser,'id'|'permissions'>,shared=false):Prisma.TaskWhereInput {
  const scope=followUpReadWhere(user,false,shared);
  return {AND:[
    {OR:[{followUpId:null},{followUp:scope}]},
    {OR:[{alertId:null},{sourceAlert:{OR:[{followUpId:null},{followUp:scope}]}}]},
  ]};
}

export function taskFollowUpReadWhere(user:Pick<CurrentUser,'id'|'permissions'>,shared=false):Prisma.TaskWhereInput {
  return {AND:[taskSourceReadWhere(user,shared),{OR:[{alertId:null},{sourceAlert:{OR:[{taskId:null},{task:taskSourceReadWhere(user,shared)}]}}]}]};
}

export function alertReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>,shared=false): Prisma.AlertWhereInput {
  return {AND:[
    {OR:[{followUpId:null},{followUp:followUpReadWhere(user,false,shared)}]},
    {OR:[{taskId:null},{task:taskFollowUpReadWhere(user,shared)}]},
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
      (a."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id = a."followUpId" AND ${scope})) AND
      (a."taskId" IS NULL OR EXISTS (SELECT 1 FROM "Task" source_task WHERE source_task.id=a."taskId" AND
        (source_task."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id=source_task."followUpId" AND ${scope})) AND
        (source_task."alertId" IS NULL OR EXISTS (SELECT 1 FROM "Alert" source_alert WHERE source_alert.id=source_task."alertId" AND
          (source_alert."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id=source_alert."followUpId" AND ${scope}))))))))
  )`;
}

export function alertReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  return Prisma.sql`(
    (a."followUpId" IS NULL OR EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id = a."followUpId" AND ${followUpReadSql(user)})) AND
    (a."taskId" IS NULL OR EXISTS (SELECT 1 FROM "Task" t WHERE t.id = a."taskId" AND ${taskFollowUpReadSql(user)}))
  )`;
}
