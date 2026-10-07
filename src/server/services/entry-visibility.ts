import 'server-only';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError } from '@/server/errors';
import { isReceptionDeskRole } from '@/lib/permissions';

export type EntryReader = Pick<CurrentUser, 'id' | 'permissions' | 'isSystemAdmin'> & Partial<Pick<CurrentUser, 'departmentId' | 'roleKey'>>;

export function canManageEntryVisibility(user: EntryReader, createdById: string) {
  return user.id === createdById || user.isSystemAdmin || user.roleKey === 'SUPERVISOR';
}

/** Visibility is presentation/access by area; assignment does not grant access. */
export function entryReadWhere(user: EntryReader): Prisma.OperationalEntryWhereInput {
  // Explicit identity predicate: Prisma prunes an empty relation filter inside OR.
  if (user.isSystemAdmin || user.roleKey === 'SUPERVISOR') return { id: { not: '' } };
  return { OR: [
    { createdById: user.id },
    { hiddenFromDepartments: { none: { OR: [
      { users: { some: { id: user.id } } },
      ...(user.departmentId ? [{ id: user.departmentId }] : []),
      ...(user.roleKey && isReceptionDeskRole(user.roleKey) ? [{ key: 'RECEPCION' }] : []),
    ] } } },
  ] };
}

/** Shared Reception handovers never inherit the supervisor/creator override. */
export const receptionHandoverEntryWhere: Prisma.OperationalEntryWhereInput = {
  includeInReceptionHandover: true,
  hiddenFromDepartments: { none: { key: 'RECEPCION' } },
};

export const closureValidationAlertWhere: Prisma.AlertWhereInput = {
  dedupeKey: { startsWith: 'shift-validation:' },
};

/** SQL counterpart for the existing global search view. Alias e is fixed. */
export function entryReadSql(user: EntryReader) {
  if (user.isSystemAdmin || user.roleKey === 'SUPERVISOR') return Prisma.sql`TRUE`;
  return Prisma.sql`(e."createdById" = ${user.id} OR NOT EXISTS (
    SELECT 1 FROM "_EntryHiddenAreas" h JOIN "Department" d ON d.id=h."A"
    WHERE h."B"=e.id AND (d.id=${user.departmentId ?? null}
      OR EXISTS (SELECT 1 FROM "User" u WHERE u.id=${user.id} AND u."departmentId"=d.id)
      OR (d.key='RECEPCION' AND ${!!user.roleKey && isReceptionDeskRole(user.roleKey)}))
  ))`;
}

/** Source lookups and visibility changes serialize on the same entry row. */
export async function assertEntryVisibleForWrite(tx: Prisma.TransactionClient, user: EntryReader, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${id} FOR UPDATE`;
  if (!await tx.operationalEntry.count({where:{id,deletedAt:null,AND:[entryReadWhere(user)]}})) throw new NotFoundError('El registro de origen no está visible para tu área.');
}
