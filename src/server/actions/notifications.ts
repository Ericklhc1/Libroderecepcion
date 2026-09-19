'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { getUnreadCountsForUser } from '@/server/services/notification-poll';

/**
 * Cuántas cosas sin leer hay ahora mismo.
 *
 * La cabecera renderiza el contador en el servidor, así que sólo cambia al
 * navegar. Para que una notificación **suene** cuando llega hay que saberlo sin
 * que nadie navegue, y de eso se encarga esta consulta.
 *
 * Antes de contar, mantiene fresco el motor automático como máximo una vez por
 * minuto. Después hace los dos `count` en paralelo. Devuelve también las
 * alertas vivas porque recordatorios, seguimientos y reglas operativas llegan
 * como alerta, no como notificación.
 */
export async function getUnreadCounts(): Promise<{
  notifications: number;
  alerts: number;
}> {
  const user = await requireUser();
  return getUnreadCountsForUser(user.id);
}

const markSchema = z.object({ id: z.string().min(1).optional() });

/**
 * Marca como leída una notificación propia (o todas si no se indica id).
 * El filtro por `userId` evita el acceso horizontal a notificaciones ajenas.
 */
export async function markNotificationsReadAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(markSchema, formDataToObject(formData));

    const result = await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(input.id ? { id: input.id } : {}),
      },
      data: { readAt: new Date() },
    });

    revalidatePath('/notificaciones');
    revalidatePath('/');
    return {
      ok: true as const,
      message: input.id
        ? 'Notificación marcada como leída.'
        : `${result.count} notificación(es) marcadas como leídas.`,
    };
  });
}
