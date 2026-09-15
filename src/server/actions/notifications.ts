'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';

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
