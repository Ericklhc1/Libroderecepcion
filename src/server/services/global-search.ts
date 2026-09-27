import 'server-only';

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';

export type GlobalSearchResult = {
  humanId: number;
  entity: string;
  kindLabel: string;
  title: string;
  summary: string | null;
  status: string | null;
  room: string | null;
  guest: string | null;
  person: string | null;
  category: string | null;
  createdAt: Date;
  href: string | null;
};

type SearchRow = GlobalSearchResult & { technicalId: string };

function normalize(value: string): string {
  return value
    .trim()
    .replace(/^#/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CL')
    .replace(/\s+/g, ' ');
}

function hasAny(user: CurrentUser, permissions: CurrentUser['permissions']) {
  return permissions.some((permission) => user.permissions.includes(permission));
}

function hrefFor(row: SearchRow): string | null {
  switch (row.entity) {
    case 'OperationalEntry': return `/libro/${row.technicalId}`;
    case 'Task': return `/tareas/${row.technicalId}`;
    case 'FollowUp': return `/seguimientos?q=%23${row.humanId}`;
    case 'Alert': return `/alertas?alerta=${row.technicalId}`;
    case 'ShiftHandover': return `/turno/entrega/${row.technicalId}`;
    case 'Shift':
    case 'ShiftCashClosure':
    case 'CashCount':
    case 'CashTransfer': return '/turno';
    case 'Guarantee': return `/caja?q=%23${row.humanId}&seccion=garantias`;
    case 'CashMovement': return `/caja?q=%23${row.humanId}&seccion=movimientos`;
    case 'CashAudit': return `/caja?q=%23${row.humanId}&seccion=auditorias`;
    case 'GymPass': return `/caja?q=%23${row.humanId}&seccion=gimnasio`;
    case 'KeyInventoryCount':
    case 'KeyMovement': return '/llaves';
    case 'SupervisionShift':
    case 'SupervisionShiftHandover': return '/supervision';
    case 'ChecklistRun':
    case 'AuditFinding':
    case 'CorrectiveMeasure': return '/supervision/auditorias';
    case 'Announcement': return null;
    case 'Fine': return null;
    default: return null;
  }
}

export async function searchOperationalRecords(
  user: CurrentUser,
  rawQuery: string,
  limit = 60,
): Promise<GlobalSearchResult[]> {
  const query = normalize(rawQuery);
  if (!query) return [];
  const tokens = query.split(' ').filter(Boolean);
  const exactId = /^\d+$/.test(query) && Number.isSafeInteger(Number(query)) ? Number(query) : null;
  const domains = ['OPEN', 'ANNOUNCEMENT'];
  if (user.permissions.includes('cash.view')) domains.push('CASH');
  if (hasAny(user, ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage'])) domains.push('SHIFT');
  if (user.permissions.includes('room.view')) domains.push('ROOM');
  if (hasAny(user, ['key.assign', 'key.inventory', 'key.stock'])) domains.push('KEYS');
  if (user.permissions.includes('supervision.center.view')) domains.push('SUPERVISION');
  const canManageAnnouncements = user.permissions.includes('announcement.manage');

  const domainSql = Prisma.join(domains.map((domain) => Prisma.sql`${domain}`));
  const tokenSql = Prisma.join(
    tokens.map((token) => Prisma.sql`normalized_text LIKE ${`%${token}%`}`),
    ' AND ',
  );
  const containsQuery = `%${query}%`;
  const maxRows = Math.min(100, Math.max(10, limit));

  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH visible AS (
      SELECT *,
        translate(lower(COALESCE("searchText", '')), 'áéíóúüñ', 'aeiouun') AS normalized_text,
        translate(lower(COALESCE(room, '')), 'áéíóúüñ', 'aeiouun') AS normalized_room,
        translate(lower(COALESCE(guest, '')), 'áéíóúüñ', 'aeiouun') AS normalized_guest,
        translate(lower(COALESCE(person, '')), 'áéíóúüñ', 'aeiouun') AS normalized_person,
        translate(lower(COALESCE(title, '')), 'áéíóúüñ', 'aeiouun') AS normalized_title,
        translate(lower(COALESCE(summary, '')), 'áéíóúüñ', 'aeiouun') AS normalized_summary,
        translate(lower(COALESCE(category, '')), 'áéíóúüñ', 'aeiouun') AS normalized_category,
        translate(lower(COALESCE(status, '')), 'áéíóúüñ', 'aeiouun') AS normalized_status
      FROM "OperationalHumanSearch"
      WHERE domain IN (${domainSql})
        AND (
          domain <> 'ANNOUNCEMENT'
          OR "targetUserId" IS NULL
          OR "targetUserId" = ${user.id}
          OR ${canManageAnnouncements}
        )
    )
    SELECT "humanId", "technicalId", entity, "kindLabel", title, summary, status,
           room, guest, person, category, "createdAt"
    FROM visible
    WHERE (${exactId}::integer IS NOT NULL AND "humanId" = ${exactId}::integer)
       OR (${tokenSql})
    ORDER BY
      CASE
        WHEN ${exactId}::integer IS NOT NULL AND "humanId" = ${exactId}::integer THEN 0
        WHEN normalized_room LIKE ${containsQuery} THEN 1
        WHEN normalized_guest LIKE ${containsQuery} THEN 2
        WHEN normalized_person LIKE ${containsQuery} THEN 3
        WHEN normalized_title LIKE ${containsQuery} THEN 4
        WHEN normalized_summary LIKE ${containsQuery} THEN 5
        WHEN normalized_category LIKE ${containsQuery} THEN 6
        WHEN normalized_status LIKE ${containsQuery} THEN 7
        ELSE 8
      END,
      "createdAt" DESC
    LIMIT ${maxRows}
  `);

  return rows.map((row) => ({
    humanId: row.humanId,
    entity: row.entity,
    kindLabel: row.kindLabel,
    title: row.title,
    summary: row.summary,
    status: row.status,
    room: row.room,
    guest: row.guest,
    person: row.person,
    category: row.category,
    createdAt: row.createdAt,
    href: hrefFor(row),
  }));
}
