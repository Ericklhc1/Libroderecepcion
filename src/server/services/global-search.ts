import 'server-only';

import { OperationalAlarmStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { hasAnyPermission, hasPermission } from '@/server/auth/current-user';
import { visibleNavItems } from '@/components/layout/nav-items';

export type GlobalSearchResult = {
  humanId: number | null;
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
  createdAt: Date | null;
  href: string;
};

type SearchRow = Omit<GlobalSearchResult, 'humanId' | 'createdAt'> & {
  humanId: number;
  createdAt: Date;
  targetUserId: string | null;
  scope: string | null;
  createdByUserId: string | null;
};

type Scored = { score: number; result: GlobalSearchResult };

const BASE_TYPES = [
  'OperationalEntry',
  'Task',
  'FollowUp',
  'Shift',
  'ShiftHandover',
] as const;

function allowedTypes(user: CurrentUser): string[] {
  const types = [...BASE_TYPES] as string[];

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
      'management.dashboard.view',
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

  if (hasAnyPermission(user, ['key.inventory', 'key.stock', 'management.dashboard.view'])) {
    types.push('KeyInventoryCount');
  }

  return types;
}

function normalizedQuery(value: string): string {
  return value.trim().replace(/^#/, '').trim();
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('es-CL');
}

function matches(text: string | null | undefined, q: string): boolean {
  const haystack = normalizedText(text);
  return q
    .toLocaleLowerCase('es-CL')
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function navigationMatches(user: CurrentUser, q: string): Scored[] {
  const seen = new Set<string>();
  const candidates = visibleNavItems(user.permissions).flatMap((item) => [
    {
      href: item.href,
      label: item.label,
      description: item.menu?.flatMap((section) => section.items).find((sub) => sub.href === item.href)?.description ?? null,
    },
    ...(item.menu?.flatMap((section) =>
      section.items.map((sub) => ({
        href: sub.href,
        label: sub.label,
        description: sub.description ?? null,
      })),
    ) ?? []),
  ]);

  return candidates.flatMap((item) => {
    if (seen.has(item.href)) return [];
    seen.add(item.href);
    const text = [item.label, item.description, item.href].filter(Boolean).join(' ');
    if (!matches(text, q)) return [];
    const exact = normalizedText(item.label) === normalizedText(q);
    return [{
      score: exact ? 0 : 8,
      result: {
        humanId: null,
        entityType: 'Navigation',
        entityId: item.href,
        kind: 'Pantalla',
        title: item.label,
        summary: item.description,
        status: null,
        roomNumber: null,
        guestName: null,
        responsible: null,
        category: 'NAVEGACION',
        createdAt: null,
        href: item.href,
      },
    }];
  });
}

export async function searchOperationalRecords(
  user: CurrentUser,
  rawQuery: string,
  limit = 60,
): Promise<GlobalSearchResult[]> {
  const q = normalizedQuery(rawQuery);
  if (!q) return [];

  const max = Math.min(100, Math.max(1, limit));
  const types = allowedTypes(user);
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

  const recordPromise =
    types.length === 0
      ? Promise.resolve([] as SearchRow[])
      : prisma.$queryRaw<SearchRow[]>(Prisma.sql`
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
          LIMIT ${max}
        `);

  const canSeeReservations = hasAnyPermission(user, [
    'reservation.center.view',
    'guest.view',
    'guest.manage',
    'management.dashboard.view',
    'supervision.center.view',
  ]);

  const [rows, rooms, reservations, alarms, notifications, supportRequests, auditLogs] =
    await Promise.all([
      recordPromise,
      prisma.room.findMany({
        where: {
          active: true,
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { kind: { contains: q, mode: 'insensitive' } },
            { notes: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, number: true, floor: true, kind: true, notes: true, updatedAt: true },
        take: 20,
      }),
      canSeeReservations
        ? prisma.reservationReference.findMany({
            where: {
              deletedAt: null,
              OR: [
                { code: { contains: q, mode: 'insensitive' } },
                { externalId: { contains: q, mode: 'insensitive' } },
                { roomNumber: { contains: q, mode: 'insensitive' } },
                { channel: { contains: q, mode: 'insensitive' } },
                { actionNote: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
                { guest: { fullName: { contains: q, mode: 'insensitive' } } },
              ],
            },
            select: {
              id: true,
              code: true,
              roomNumber: true,
              status: true,
              channel: true,
              actionNote: true,
              updatedAt: true,
              guest: { select: { fullName: true } },
            },
            take: 20,
          })
        : Promise.resolve([]),
      prisma.operationalAlarm.findMany({
        where: {
          OR: [
            { createdById: user.id },
            { recipients: { some: { userId: user.id } } },
            ...(hasAnyPermission(user, ['shift.manage', 'supervision.center.view'])
              ? [{}]
              : []),
          ],
          AND: [
            {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { note: { contains: q, mode: 'insensitive' } },
                { sourceEntity: { contains: q, mode: 'insensitive' } },
                { sourceLink: { contains: q, mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          note: true,
          status: true,
          sourceEntity: true,
          sourceLink: true,
          dueAt: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.notification.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { body: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      hasPermission(user, 'support.view')
        ? prisma.supportRequest.findMany({
            where: {
              OR: [
                { correlationId: { contains: q, mode: 'insensitive' } },
                { subject: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { requesterName: { contains: q, mode: 'insensitive' } },
                { requesterUser: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: {
              id: true,
              correlationId: true,
              kind: true,
              status: true,
              subject: true,
              description: true,
              requesterName: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        : Promise.resolve([]),
      hasPermission(user, 'audit.view')
        ? prisma.auditLog.findMany({
            where: {
              OR: [
                { summary: { contains: q, mode: 'insensitive' } },
                { entity: { contains: q, mode: 'insensitive' } },
                { reason: { contains: q, mode: 'insensitive' } },
                { user: { name: { contains: q, mode: 'insensitive' } } },
              ],
            },
            select: {
              id: true,
              entity: true,
              action: true,
              summary: true,
              reason: true,
              createdAt: true,
              user: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 15,
          })
        : Promise.resolve([]),
    ]);

  const canManageAnnouncements = hasPermission(user, 'announcement.manage');
  const canSeeSupervisionFollowUps = hasPermission(user, 'supervision.followup.manage');

  const scored: Scored[] = navigationMatches(user, q);

  for (const row of rows) {
    if (row.entityType === 'Announcement') {
      if (!(canManageAnnouncements || row.scope === 'TODOS' || row.targetUserId === user.id)) continue;
    }
    if (row.entityType === 'FollowUp') {
      if (row.scope === 'PRIVADO' && row.createdByUserId !== user.id) continue;
      if (row.scope === 'SUPERVISION' && !canSeeSupervisionFollowUps) continue;
      if (
        row.scope === 'OPERATIVO' &&
        !(canSeeSupervisionFollowUps || row.targetUserId === user.id || row.createdByUserId === user.id)
      ) continue;
    }

    scored.push({
      score:
        numeric !== null && row.humanId === numeric
          ? 0
          : normalizedText(row.roomNumber) === normalizedText(q)
            ? 1
            : 10,
      result: {
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
      },
    });
  }

  for (const room of rooms) {
    scored.push({
      score: room.number === q ? 0 : 3,
      result: {
        humanId: null,
        entityType: 'Room',
        entityId: room.id,
        kind: 'Habitación',
        title: `Habitación ${room.number}`,
        summary: [room.kind, room.notes].filter(Boolean).join(' · ') || 'Monitor de continuidad activa',
        status: null,
        roomNumber: room.number,
        guestName: null,
        responsible: null,
        category: room.floor ? `PISO_${room.floor}` : 'HABITACION',
        createdAt: room.updatedAt,
        href: `/habitaciones?habitacion=${encodeURIComponent(room.number)}`,
      },
    });
  }

  for (const reservation of reservations) {
    scored.push({
      score: normalizedText(reservation.code) === normalizedText(q) ? 0 : 4,
      result: {
        humanId: null,
        entityType: 'ReservationReference',
        entityId: reservation.id,
        kind: 'Reserva',
        title: `Reserva ${reservation.code}`,
        summary: [reservation.guest?.fullName, reservation.channel, reservation.actionNote]
          .filter(Boolean)
          .join(' · ') || null,
        status: reservation.status,
        roomNumber: reservation.roomNumber,
        guestName: reservation.guest?.fullName ?? null,
        responsible: null,
        category: 'PRELLEGADA',
        createdAt: reservation.updatedAt,
        href: `/central-reservas?q=${encodeURIComponent(reservation.code)}`,
      },
    });
  }

  for (const alarm of alarms) {
    scored.push({
      score: alarm.status === OperationalAlarmStatus.ACTIVA ? 5 : 12,
      result: {
        humanId: null,
        entityType: 'OperationalAlarm',
        entityId: alarm.id,
        kind: 'Alerta',
        title: alarm.title,
        summary: alarm.note,
        status: alarm.status,
        roomNumber: null,
        guestName: null,
        responsible: alarm.createdBy.name,
        category: alarm.sourceEntity ?? 'ALERTA',
        createdAt: alarm.createdAt,
        href: alarm.sourceLink ?? `/alertas?alerta=${alarm.id}`,
      },
    });
  }

  for (const notification of notifications) {
    scored.push({
      score: notification.readAt ? 15 : 9,
      result: {
        humanId: null,
        entityType: 'Notification',
        entityId: notification.id,
        kind: 'Notificación',
        title: notification.title,
        summary: notification.body,
        status: notification.readAt ? 'LEIDA' : 'NO_LEIDA',
        roomNumber: null,
        guestName: null,
        responsible: null,
        category: notification.type,
        createdAt: notification.createdAt,
        href: notification.link ?? '/notificaciones',
      },
    });
  }

  for (const request of supportRequests) {
    scored.push({
      score: 11,
      result: {
        humanId: null,
        entityType: 'SupportRequest',
        entityId: request.id,
        kind: request.kind === 'ERROR' ? 'Reporte' : 'Solicitud',
        title: request.subject,
        summary: request.description,
        status: request.status,
        roomNumber: null,
        guestName: null,
        responsible: request.requesterName,
        category: request.correlationId,
        createdAt: request.createdAt,
        href: '/admin/soporte',
      },
    });
  }

  for (const log of auditLogs) {
    scored.push({
      score: 18,
      result: {
        humanId: null,
        entityType: 'AuditLog',
        entityId: log.id,
        kind: 'Auditoría',
        title: log.summary,
        summary: log.reason,
        status: log.action,
        roomNumber: null,
        guestName: null,
        responsible: log.user?.name ?? 'Sistema',
        category: log.entity,
        createdAt: log.createdAt,
        href: `/admin/auditoria?q=${encodeURIComponent(q)}`,
      },
    });
  }

  const unique = new Map<string, Scored>();
  for (const item of scored) {
    const key = `${item.result.entityType}:${item.result.entityId}`;
    const current = unique.get(key);
    if (!current || item.score < current.score) unique.set(key, item);
  }

  return Array.from(unique.values())
    .sort((a, b) => a.score - b.score || (b.result.createdAt?.getTime() ?? 0) - (a.result.createdAt?.getTime() ?? 0))
    .slice(0, max)
    .map((item) => item.result);
}
