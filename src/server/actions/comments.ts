'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { commentSchema, softDeleteSchema } from '@/server/schemas';
import { requireUser } from '@/server/auth/guard';
import { assertReceptionOperationPermission } from '@/server/services/reception-operation-gate';
import { addComment, softDeleteComment } from '@/server/services/comments';

export async function addCommentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await assertReceptionOperationPermission(user, 'entry.edit');
    const input = parseOrThrow(commentSchema, formDataToObject(formData));
    await addComment(user, input);
    if (input.entryId) revalidatePath(`/libro/${input.entryId}`);
    if (input.taskId) revalidatePath(`/tareas/${input.taskId}`);
    if (input.handoverId) revalidatePath(`/turno/entrega/${input.handoverId}`);
    revalidatePath('/alertas');
    revalidatePath('/seguimientos');
    return { ok: true as const, message: 'Comentario publicado.' };
  });
}

export async function deleteCommentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await assertReceptionOperationPermission(user, 'entry.edit');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));
    await softDeleteComment(user, input);
    revalidatePath('/libro');
    revalidatePath('/tareas');
    return { ok: true as const, message: 'Comentario eliminado.' };
  });
}
