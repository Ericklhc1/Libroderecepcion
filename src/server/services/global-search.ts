import { entryReadSql } from './entry-visibility';
import 'server-only';
import {directFollowUpReadSql} from './followup-access';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { hasAnyPermission, hasPermission } from '@/server/auth/current-user';
import { isHkFocused } from '@/domain/housekeeping-work';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { searchHousekeepingRecords } from './housekeeping';

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
  const hkOnly = isHkFocused(user);
  const types = hkOnly ? [] : [...BASE_TYPES] as string[];

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

  if (hasAnyPermission(user, ['key.assign', 'key.inventory', 'key.stock'])) {
    types.push('KeyInventoryCount', 'KeyStaffLoan');
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
  if (types.length === 0) return canAccessHousekeeping(user) ? searchHousekeepingRecords(user, rawQuery, limit) : [];

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
    WITH reserved_sources AS MATERIALIZED (
      SELECT DISTINCT o.kind,o.id FROM "OperationalSourceFollowUp" o
      JOIN "FollowUp" f ON f.id=o."followUpId"
      WHERE NOT (${directFollowUpReadSql(user,true)})
    )
    , hidden_entries AS MATERIALIZED (
      SELECT e.id FROM "OperationalEntry" e WHERE NOT (${entryReadSql(user)})
    )
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
      AND NOT EXISTS (
        SELECT 1 FROM hidden_entries hidden WHERE
          ("entityType"='OperationalEntry' AND hidden.id="HumanOperationalRecord"."entityId") OR
          EXISTS (SELECT 1 FROM "OperationalSourceEntry" origin WHERE origin.kind=lower("HumanOperationalRecord"."entityType") AND origin.id="HumanOperationalRecord"."entityId" AND origin."entryId"=hidden.id)
      )
      AND NOT ("entityType"='Task' AND EXISTS (SELECT 1 FROM "Task" t JOIN "Alert" a ON a.id=t."alertId" WHERE t.id="HumanOperationalRecord"."entityId" AND a."dedupeKey" LIKE 'shift-validation:%'))
      AND ${user.isSystemAdmin || user.permissions.includes('supervision.center.view') ? Prisma.sql`TRUE` : Prisma.sql`NOT ("entityType"='Alert' AND EXISTS (SELECT 1 FROM "Alert" a WHERE a.id="HumanOperationalRecord"."entityId" AND a."dedupeKey" LIKE 'shift-validation:%'))`}
      AND CASE
        WHEN "entityType" = 'Task' THEN NOT EXISTS (SELECT 1 FROM reserved_sources s WHERE s.kind='task' AND s.id="HumanOperationalRecord"."entityId")
        WHEN "entityType" = 'FollowUp' THEN NOT EXISTS (SELECT 1 FROM reserved_sources s WHERE s.kind='followup' AND s.id="HumanOperationalRecord"."entityId")
          AND EXISTS (SELECT 1 FROM "FollowUp" f WHERE f.id="HumanOperationalRecord"."entityId" AND f."deletedAt" IS NULL)
        WHEN "entityType" = 'Alert' THEN NOT EXISTS (SELECT 1 FROM reserved_sources s WHERE s.kind='alert' AND s.id="HumanOperationalRecord"."entityId")
        ELSE TRUE
      END
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

  const results = rows
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
    .map((row) => ({
      humanId: row.humanId,
      entityType: row.entityType,
      entityId: row.entityId,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      status: row.status,
      roomNumber: row.roomNumber,
      guestName: row.guestName,
      responsible: row.responsible,
      category: row.category,
      createdAt: row.createdAt,
      href: row.href,
    }));
  const staffLoans = hasAnyPermission(user, ['key.assign','key.inventory','key.stock']) ? await prisma.keyStaffLoan.findMany({ where: numeric !== null ? {humanId:numeric} : {AND:terms.map(term => ({OR:[{departmentName:{contains:term,mode:'insensitive' as const}},{collaboratorName:{contains:term,mode:'insensitive' as const}},{authorizedByName:{contains:term,mode:'insensitive' as const}},{notes:{contains:term,mode:'insensitive' as const}}]}))}, orderBy:{createdAt:'desc'},take:Math.min(100,Math.max(1,limit)),include:{items:{select:{returnedAt:true}}} }) : [];
  const staffResults: GlobalSearchResult[] = staffLoans.map(l => ({humanId:l.humanId,entityType:'KeyStaffLoan',entityId:l.id,kind:'Entrega a personal',title:`Llaves · ${l.departmentName}`,summary:l.notes,status:l.items.some(i=>!i.returnedAt)?'EN CUSTODIA':'DEVUELTA',roomNumber:null,guestName:null,responsible:l.collaboratorName ?? l.departmentName,category:'LLAVES',createdAt:l.createdAt,href:`/llaves/personal/${l.id}`}));
  const housekeeping = canAccessHousekeeping(user) ? await searchHousekeepingRecords(user, rawQuery, limit) : [];
  return [...results, ...housekeeping, ...staffResults].sort((a, b) => {
    if (numeric !== null && (a.humanId === numeric || b.humanId === numeric)) return Number(b.humanId === numeric) - Number(a.humanId === numeric);
    return b.createdAt.getTime() - a.createdAt.getTime();
  }).slice(0, Math.min(100, Math.max(1, limit)));
}
