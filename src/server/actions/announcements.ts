'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AnnouncementScope } from '@prisma/client';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalCuid,
  zOptionalDate,
  zRequiredString,
  type ActionState,
} from '@/server/action';
import { requirePermission, requireUser } from '@/server/auth/guard';
import {
  closeAnnouncement,
  confirmAnnouncement,
  createAnnouncement,
} from '@/server/services/announcements';

/**
 * Acciones de los comunicados obligatorios.
 *
 * Emitir y retirar exigen `announcement.manage`. **Confirmar no exige
 * permiso**, sólo sesión: si lo exigiera, alguien podría quedar bloqueado por
 * un comunicado que no tiene forma de confirmar, y eso lo dejaría sin poder
 * trabajar. El servicio ya comprueba que el comunicado le corresponda.
 */

const createSchema = z
  .object({
    title: zRequiredString(200, 'El título'),
    body: z
      .string()
      .trim()
      .min(10, 'El cuerpo del comunicado debe explicar algo (mínimo 10 caracteres)')
      .max(4000),
    scope: z.nativeEnum(AnnouncementScope),
    targetUserId: zOptionalCuid,
    expiresAt: zOptionalDate,
  })
  .refine(
    (data) => data.scope !== AnnouncementScope.USUARIO || Boolean(data.targetUserId),
    { path: ['targetUserId'], message: 'Elige a quién va dirigido' },
  );

export async function createAnnouncementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('announcement.manage');
    const input = parseOrThrow(createSchema, formDataToObject(formData));

    const announcement = await createAnnouncement(user, {
      title: input.title,
      body: input.body,
      scope: input.scope,
      // Un comunicado para todos no lleva destinatario, aunque el formulario
      // haya dejado el selector con algo elegido.
      targetUserId:
        input.scope === AnnouncementScope.USUARIO ? (input.targetUserId ?? null) : null,
      expiresAt: input.expiresAt ?? null,
    });

    revalidatePath('/supervision');
    revalidatePath('/');
    return {
      ok: true as const,
      message:
        input.scope === AnnouncementScope.TODOS
          ? 'Comunicado emitido. Bloqueará la pantalla de todo el personal hasta que confirme la lectura.'
          : 'Comunicado emitido. Bloqueará la pantalla de esa persona hasta que confirme la lectura.',
      id: announcement.id,
    };
  });
}

const confirmSchema = z.object({
  announcementId: z.string().min(1),
  text: z
    .string()
    .trim()
    .min(3, 'Escribe qué entendiste o qué vas a hacer')
    .max(2000),
});

export async function confirmAnnouncementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(confirmSchema, formDataToObject(formData));

    await confirmAnnouncement(user, input);

    /*
      Se revalida la raíz porque el bloqueo se calcula en el layout: sin esto
      la pantalla seguiría mostrando el comunicado ya confirmado.
    */
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'Lectura confirmada.' };
  });
}

const closeSchema = z.object({
  announcementId: z.string().min(1),
  reason: zRequiredString(500, 'El motivo'),
});

export async function closeAnnouncementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('announcement.manage');
    const input = parseOrThrow(closeSchema, formDataToObject(formData));

    await closeAnnouncement(user, input);

    revalidatePath('/supervision');
    revalidatePath('/', 'layout');
    return {
      ok: true as const,
      message: 'Comunicado retirado. Deja de bloquear y se conserva quién lo confirmó.',
    };
  });
}
