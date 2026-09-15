import 'server-only';
import type { NotificationType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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
  }
  await dispatchExternal(list);
}

/**
 * Punto de extensión para canales externos. Deliberadamente vacío en la
 * primera versión: la arquitectura queda preparada sin agregar dependencias.
 */
async function dispatchExternal(_notifications: NotifyInput[]): Promise<void> {
  // Pendiente: correo / WhatsApp / push. Ver docs/ARQUITECTURA.md.
  return;
}
