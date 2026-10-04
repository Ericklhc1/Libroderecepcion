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

// An archived origin retains its authorization; active work does not disappear.
// The views resolve every native source edge, including old chains and cycles.
export function taskFollowUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>, shared=false): Prisma.TaskWhereInput {
  return {sourceFollowUps: {none: {followUp: {NOT: followUpReadWhere(user,true,shared)}}}};
}

export function alertReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>, shared=false): Prisma.AlertWhereInput {
  return {sourceFollowUps: {none: {followUp: {NOT: followUpReadWhere(user,true,shared)}}}};
}

export function operationalAlarmReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'>): Prisma.OperationalAlarmWhereInput {
  return {sourceFollowUps: {none: {followUp: {NOT: followUpReadWhere(user,true)}}}};
}

/** Same reserved-source policy for the existing PostgreSQL search view.
 * Fixed aliases f/t are internal SQL identifiers, never supplied by a request. */
export function followUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>, includeDeleted=false) {
  const manager = user.permissions.includes('supervision.followup.manage');
  return Prisma.sql`${includeDeleted ? Prisma.sql`TRUE` : Prisma.sql`f."deletedAt" IS NULL`} AND (
    (f."visibility" = 'PRIVADO' AND f."createdById" = ${user.id}) OR
    (f."visibility" = 'SUPERVISION' AND ${manager}) OR
    (f."visibility" = 'OPERATIVO' AND (${manager} OR f."ownerId" = ${user.id} OR f."createdById" = ${user.id}))
  )`;
}

export function taskFollowUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "TaskSourceFollowUp" origin
    JOIN "FollowUp" f ON f.id=origin."followUpId"
    WHERE origin."taskId"=t.id AND NOT (${followUpReadSql(user,true)}))`;
}

export function alertReadSql(user: Pick<CurrentUser, 'id' | 'permissions'>) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "AlertSourceFollowUp" origin
    JOIN "FollowUp" f ON f.id=origin."followUpId"
    WHERE origin."alertId"=a.id AND NOT (${followUpReadSql(user,true)}))`;
}
