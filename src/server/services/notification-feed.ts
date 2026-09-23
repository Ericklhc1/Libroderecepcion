import 'server-only';

import { prisma } from '@/lib/prisma';

export const NOTIFICATION_FEED_LIMIT = 40;

export type NotificationFeedItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  entity: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationFeedSnapshot = {
  unread: number;
  items: NotificationFeedItem[];
  generatedAt: string;
};

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

  const [rows, unread] = await Promise.all([
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
  ]);

  return {
    unread,
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
