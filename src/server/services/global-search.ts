import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { hasAnyPermission, hasPermission } from '@/server/auth/current-user';

export type GlobalSearchResult = {
  humanId: number;
  entityType: string;
  entityId: string;
  kind: string;
  title: string;
  summary: string | null;
  status: string | null;
  roomNumber: string | null;
  guestName: string | null;
  responsible: string | null;
  category: string | null;
  createdAt: Date;
  href: string;
};

type SearchRow = GlobalSearchResult & {
  targetUserId: string | null;
  scope: string | null;
  createdByUserId: string | null;
};

const BASE_TYPES = [
  'OperationalEntry',
  'Task',
  'FollowUp',
  'Shift',
  'ShiftHandover',
] as const;

function allowedTypes(user: CurrentUser): string[] {
  const types = [...BASE_TYPES] as string[];

  if (hasPermission(user, 'alert.manage')) {
    types.push('Alert');
  }

  if (hasPermission(user, 'cash.view')) {
    types.push(
      'Guarantee',
      'CashMovement',
      'CashAudit',
      'CashCount',
      'CashTransfer',
      'ShiftCashClosure',
      'GymPass',
      'Fine',
    );
  }

  if (
    hasAnyPermission(user, [
      'supervision.view',
      'supervision.center.view',
      'supervision.history.view',
      'audit.view',
    ])
  ) {
    types.push(
      'SupervisionShift',
      'SupervisionShiftHandover',
      'Announcement',
      'ChecklistRun',
      'AuditFinding',
      'CorrectiveMeasure',
    );
  }

  if (hasAnyPermission(user, ['key.inventory', 'key.stock'])) {
    types.push('KeyInventoryCount');
  }

  return types;
}

function normalizedQuery(value: string): string {
  return value.trim().replace(/^#/, '').trim();
}

export async function searchOperationalRecords(
  user: CurrentUser,
  rawQuery: string,
  limit = 60,
): Promise<GlobalSearchResult[]> {
  const q = normalizedQuery(rawQuery);
  if (!q) return [];

  const types = allowedTypes(user);
  if (types.length === 0) return [];

  const terms = q
    .toLocaleLowerCase('es-CL')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const numeric = /^\d+$/.test(q) && Number.isSafeInteger(Number(q)) ? Number(q) : null;
  const contains = (value: string) => `%${value}%`;

  const haystack = Prisma.sql`lower(concat_ws(' ',
    "humanId"::text,
    "kind",
    "title",
    coalesce("summary", ''),
    coalesce("status", ''),
    coalesce("roomNumber", ''),
    coalesce("guestName", ''),
    coalesce("responsible", ''),
    coalesce("category", '')
  ))`;

  const termFilters = terms.map(
    (term) => Prisma.sql`${haystack} LIKE ${contains(term)}`,
  );

  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      "humanId",
      "entityType",
      "entityId",
      "kind",
      "title",
      "summary",
      "status",
      "roomNumber",
      "guestName",
      "responsible",
      "category",
      "createdAt",
      "href",
      "targetUserId",
      "scope",
      "createdByUserId"
    FROM "HumanOperationalRecord"
    WHERE "entityType" IN (${Prisma.join(types)})
      AND ${Prisma.join(termFilters, ' AND ')}
    ORDER BY
      CASE
        WHEN ${numeric}::integer IS NOT NULL AND "humanId" = ${numeric} THEN 0
        WHEN lower(coalesce("roomNumber", '')) = lower(${q}) THEN 1
        WHEN lower(coalesce("guestName", '')) LIKE lower(${contains(q)}) THEN 2
        WHEN lower(coalesce("responsible", '')) LIKE lower(${contains(q)}) THEN 3
        WHEN lower("title") LIKE lower(${contains(q)}) THEN 4
        WHEN lower(coalesce("summary", '')) LIKE lower(${contains(q)}) THEN 5
        WHEN lower(coalesce("category", '')) LIKE lower(${contains(q)}) THEN 6
        WHEN lower(coalesce("status", '')) LIKE lower(${contains(q)}) THEN 7
        ELSE 8
      END,
      "createdAt" DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `);

  const canManageAnnouncements = hasPermission(user, 'announcement.manage');
  const canSeeSupervisionFollowUps = hasPermission(user, 'supervision.followup.manage');

  return rows
    .filter((row) => {
      if (row.entityType === 'Announcement') {
        return canManageAnnouncements || row.scope === 'TODOS' || row.targetUserId === user.id;
      }
      if (row.entityType === 'Alert') {
        if (row.scope?.startsWith('shift-validation:') && !hasPermission(user, 'shift.manage')) {
          return false;
        }
        if (
          (row.scope?.startsWith('cash-transfer:') || row.scope?.startsWith('cash-manual:')) &&
          !hasPermission(user, 'cash.approve')
        ) {
          return false;
        }
      }
      if (row.entityType === 'FollowUp') {
        if (row.scope === 'PRIVADO') return row.createdByUserId === user.id;
        if (row.scope === 'SUPERVISION') return canSeeSupervisionFollowUps;
        if (row.scope === 'OPERATIVO') {
          return canSeeSupervisionFollowUps || row.targetUserId === user.id || row.createdByUserId === user.id;
        }
      }
      return true;
    })
    .map(({ targetUserId: _targetUserId, scope: _scope, createdByUserId: _createdByUserId, ...row }) => row);
}
