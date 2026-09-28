import { randomUUID } from 'node:crypto';
import 'server-only';
import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  queueOperationalMail,
  tryDeliverOperationalMail,
} from '@/server/services/operational-mail';

type Client = PrismaClient | Prisma.TransactionClient;

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  entity?: string | null;
  entityId?: string | null;
  isDemo?: boolean;
};

/**
 * Centro de notificaciones interno.
 *
 * Único punto de entrada para notificar: cuando se agreguen canales externos
 * (correo, WhatsApp, push) basta con extender este despachador, sin tocar los
 * módulos operativos.
 */
export async function notify(
  input: NotifyInput | NotifyInput[],
  client: Client = prisma,
): Promise<void> {
  const list = Array.isArray(input) ? input : [input];
  if (list.length === 0) return;
  try {
    await client.notification.createMany({
      data: list.map((n) => ({
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        entity: n.entity ?? null,
        entityId: n.entityId ?? null,
        isDemo: n.isDemo ?? false,
      })),
    });
  } catch (error) {
    console.error('[notificaciones] no se pudo notificar', error);
    return;
  }
  await dispatchExternal(list, client);
}

/**
 * El correo complementa, pero nunca reemplaza, la campana interna.
 *
 * Chat y alarmas se excluyen: son señales de alta frecuencia o de presencia
 * inmediata y convertirlas en correo produciría ruido. El resto de novedades
 * operativas se agrupa por usuario por cada despacho.
 */
const EMAIL_EXCLUDED_TYPES = new Set<NotificationType>([
  'CHAT_MENSAJE',
  'ALARMA',
]);

async function dispatchExternal(
  notifications: NotifyInput[],
  client: Client,
): Promise<void> {
  const eligible = notifications.filter(
    (notification) =>
      !notification.isDemo && !EMAIL_EXCLUDED_TYPES.has(notification.type),
  );
  if (eligible.length === 0) return;

  const userIds = [...new Set(eligible.map((notification) => notification.userId))];
  const users = await client.user.findMany({
    where: {
      id: { in: userIds },
      active: true,
      deletedAt: null,
      email: { not: null },
      emailNotificationsEnabled: true,
    },
    select: { id: true, name: true, email: true },
  });

  const eventKeys: string[] = [];
  for (const user of users) {
    if (!user.email) continue;
    const items = eligible.filter((notification) => notification.userId === user.id);
    if (items.length === 0) continue;

    const eventKey = `user-notification:${user.id}:${randomUUID()}`;
    await queueOperationalMail(client, {
      eventKey,
      recipients: [user.email],
      subject:
        items.length === 1
          ? `Libro Operativo · ${items[0]!.title}`
          : `Libro Operativo · ${items.length} novedades nuevas`,
      text: [
        `Hola ${user.name},`,
        '',
        items.length === 1
          ? 'Tienes una nueva novedad en el Libro Operativo:'
          : `Tienes ${items.length} novedades nuevas en el Libro Operativo:`,
        '',
        ...items.flatMap((item, index) => [
          `${index + 1}. ${item.title}`,
          ...(item.body ? [item.body] : []),
          ...(item.link ? [`Abrir en el Libro: ${item.link}`] : []),
          '',
        ]),
        'Este correo es informativo. El estado vigente y la trazabilidad oficial permanecen en el Libro.',
      ].join('\n'),
    });
    eventKeys.push(eventKey);
  }

  /*
   * Fuera de una transacción intentamos el envío inmediatamente. Dentro de
   * una transacción la fila queda en la outbox y se entrega tras el commit por
   * el mecanismo normal de rescate/cron, evitando correos sobre operaciones
   * que pudieran revertirse.
   */
  if (client === prisma) {
    for (const eventKey of eventKeys) {
      await tryDeliverOperationalMail(eventKey);
    }
  }
}
