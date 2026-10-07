import { entryReadWhere, entryReadSql, receptionHandoverEntryWhere, closureValidationAlertWhere } from './entry-visibility';
import 'server-only';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
// The source's reserved visibility is checked before projecting any linked work.
function directFollowUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, includeDeleted = false, shared = false, areaPolicy?:Prisma.OperationalEntryWhereInput): Prisma.FollowUpWhereInput {
  const manager = user.permissions.includes('supervision.followup.manage');
  const area:Prisma.FollowUpWhereInput={sourceEntries:{none:{entry:{NOT:areaPolicy??(shared?receptionHandoverEntryWhere:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false}))}}}};
  if (shared) return { AND:[area], ...(includeDeleted ? {} : {deletedAt:null}), visibility:'OPERATIVO' };
  return { AND:[area], ...(includeDeleted ? {} : {deletedAt: null}), OR: [
    { visibility: 'PRIVADO', createdById: user.id },
    ...(manager ? [{ visibility: 'SUPERVISION' as const }] : []),
    { visibility: 'OPERATIVO', ...(manager ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }] }) },
  ] };
}

export function followUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, includeDeleted = false, shared = false): Prisma.FollowUpWhereInput {
  return {AND:[{OR:[{taskId:null},{task:taskFollowUpReadWhere(user,shared)}]},{OR:[{entryId:null},{entry:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}]},directFollowUpReadWhere(user,includeDeleted,shared),{sourceFollowUps:{none:{followUp:{NOT:directFollowUpReadWhere(user,true,shared)}}}}]};
}

// An archived origin retains its authorization; active work does not disappear.
// The views resolve every native source edge, including old chains and cycles.
export function taskFollowUpReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, shared=false, areaPolicy?:Prisma.OperationalEntryWhereInput): Prisma.TaskWhereInput {
  return { AND: [
    { sourceEntries: {none: {entry: {NOT: areaPolicy??(shared ? receptionHandoverEntryWhere : entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false}))}}} },
    { OR: [{ alertId: null }, { sourceAlert: { OR: [{dedupeKey:null}, {NOT:closureValidationAlertWhere}] } }] },
    { sourceFollowUps: {none: {followUp: {NOT: directFollowUpReadWhere(user,true,shared,areaPolicy)}}}},
  ] };
}

export function alertReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, shared=false): Prisma.AlertWhereInput {
  return { AND: [
    { sourceEntries: {none: {entry: {NOT: shared ? receptionHandoverEntryWhere : entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}}} },
    ...(shared || !(user.isSystemAdmin || user.permissions.includes('supervision.center.view')) ? [{ OR: [{dedupeKey:null}, {NOT:closureValidationAlertWhere}] }] : []),
    { sourceFollowUps: {none: {followUp: {NOT: directFollowUpReadWhere(user,true,shared)}}}},
  ] };
}

export function operationalAlarmReadWhere(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, shared=false): Prisma.OperationalAlarmWhereInput {
  return {AND:[{sourceEntries:{none:{entry:{NOT:shared?receptionHandoverEntryWhere:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}}}},{sourceFollowUps: {none: {followUp: {NOT: directFollowUpReadWhere(user,true,shared)}}}}]};
}

/** Same reserved-source policy for the existing PostgreSQL search view.
 * Fixed aliases f/t are internal SQL identifiers, never supplied by a request. */
// Use the direct node rule only when the caller already expands every origin edge.
export function directFollowUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, includeDeleted=false) {
  const manager = user.permissions.includes('supervision.followup.manage');
  return Prisma.sql`${includeDeleted ? Prisma.sql`TRUE` : Prisma.sql`f."deletedAt" IS NULL`} AND (
    (f."visibility" = 'PRIVADO' AND f."createdById" = ${user.id}) OR
    (f."visibility" = 'SUPERVISION' AND ${manager}) OR
    (f."visibility" = 'OPERATIVO' AND (${manager} OR f."ownerId" = ${user.id} OR f."createdById" = ${user.id}))
  ) AND NOT EXISTS (SELECT 1 FROM "OperationalEntry" e WHERE EXISTS (SELECT 1 FROM "complete_native_entry_origin_ids"('followup',f.id) origin WHERE origin."entryId"=e.id) AND NOT (${entryReadSql({...user,isSystemAdmin:user.isSystemAdmin??false})}))`;
}

export function followUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>, includeDeleted=false) {
  return Prisma.sql`(${directFollowUpReadSql(user,includeDeleted)}) AND NOT EXISTS (
    SELECT 1 FROM "FollowUpSourceFollowUp" inherited WHERE inherited."descendantId"=f.id
    AND inherited."followUpId" IN (SELECT f.id FROM "FollowUp" f WHERE NOT (${directFollowUpReadSql(user,true)}))
  )`;
}

export function taskFollowUpReadSql(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "complete_native_entry_origin_ids"('task',t.id) origin JOIN "OperationalEntry" e ON e.id=origin."entryId" WHERE NOT (${entryReadSql({...user,isSystemAdmin:user.isSystemAdmin??false})})) AND NOT EXISTS (SELECT 1 FROM "TaskSourceFollowUp" origin
    JOIN "FollowUp" f ON f.id=origin."followUpId"
    WHERE origin."taskId"=t.id AND NOT (${directFollowUpReadSql(user,true)}))`;
}

export function alertReadSql(user: Pick<CurrentUser, 'id' | 'permissions'> & Partial<Pick<CurrentUser, 'isSystemAdmin' | 'departmentId' | 'roleKey'>>) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "complete_native_entry_origin_ids"('alert',a.id) origin JOIN "OperationalEntry" e ON e.id=origin."entryId" WHERE NOT (${entryReadSql({...user,isSystemAdmin:user.isSystemAdmin??false})})) AND NOT EXISTS (SELECT 1 FROM "AlertSourceFollowUp" origin
    JOIN "FollowUp" f ON f.id=origin."followUpId"
    WHERE origin."alertId"=a.id AND NOT (${directFollowUpReadSql(user,true)}))`;
}

export function auditFollowUpReadWhere(user: Pick<CurrentUser,'id'|'permissions'> & Partial<Pick<CurrentUser,'roleKey'|'departmentId'|'isSystemAdmin'>>): Prisma.AuditLogWhereInput {
  return {AND:[{sourceEntries:{none:{entry:{NOT:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}}}},{sourceFollowUps:{none:{followUp:{NOT:directFollowUpReadWhere(user,true)}}}}]};
}

export function notificationReadWhere(user: Pick<CurrentUser,'id'|'permissions'> & Partial<Pick<CurrentUser,'roleKey'|'departmentId'|'isSystemAdmin'>>): Prisma.NotificationWhereInput {
  // Independent relation predicates remain conjunctive when combined with legacy AND filters.
  return {sourceEntries:{none:{entry:{NOT:entryReadWhere({...user,isSystemAdmin:user.isSystemAdmin??false})}}},sourceFollowUps:{none:{followUp:{NOT:directFollowUpReadWhere(user,true)}}}};
}
