import 'server-only';

import { AnnouncementScope } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { NotificationFeedSnapshot } from '@/domain/notifications';

export const NOTIFICATION_FEED_LIMIT = 40;

/**
 * Snapshot compacto para la campana global.
 *
 * La UI consume sólo datos serializables y no conoce Prisma. Esto permite que
 * el mismo contrato alimente el render inicial y el stream en tiempo real.
 */
export async function getNotificationFeedForUser(
  userId: string,
  limit = NOTIFICATION_FEED_LIMIT,
): Promise<NotificationFeedSnapshot> {
  const safeLimit = Math.max(1, Math.min(limit, NOTIFICATION_FEED_LIMIT));

  const now = new Date();
  const [rows, unread, blockingAnnouncements] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: safeLimit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        entity: true,
        entityId: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.announcement.findMany({
      where: {
        active: true,
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        AND: [
          {
            OR: [
              { scope: AnnouncementScope.TODOS },
              { scope: AnnouncementScope.USUARIO, targetUserId: userId },
            ],
          },
          { reads: { none: { userId } } },
        ],
      },
      select: { id: true },
      orderBy: [{ scope: 'desc' }, { createdAt: 'asc' }],
      take: 20,
    }),
  ]);

  return {
    unread,
    blockingAnnouncementIds: blockingAnnouncements.map((row) => row.id),
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      entity: row.entity,
      entityId: row.entityId,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}
