'use server';

import { AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';

const emailPreferencesSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Ingresa un correo válido')
    .max(254, 'El correo es demasiado largo')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  emailNotificationsEnabled: z
    .union([z.literal('on'), z.literal('true'), z.literal('1')])
    .optional()
    .transform(Boolean),
});

/**
 * El usuario administra su canal de avisos, nunca su identidad ni su rol.
 * El correo puede repetirse: username sigue siendo la identidad única.
 */
export async function updateMyEmailPreferencesAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(emailPreferencesSchema, formDataToObject(formData));

    const previous = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, emailNotificationsEnabled: true },
    });
    const email = input.email ?? null;
    const enabled = Boolean(email) && input.emailNotificationsEnabled;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        emailNotificationsEnabled: enabled,
      },
    });

    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.EDITAR,
      summary: `Canal de correo actualizado por ${user.name}`,
      user,
      before: previous,
      after: { email, emailNotificationsEnabled: enabled },
    });

    revalidatePath('/perfil');
    return {
      ok: true,
      message: email
        ? enabled
          ? 'Correo guardado. Recibirás los avisos opcionales habilitados de la Central.'
          : 'Correo guardado. Los avisos opcionales por correo están desactivados; los obligatorios seguirán llegando.'
        : 'Correo eliminado. Las notificaciones seguirán disponibles dentro de la Central.',
    };
  });
}
