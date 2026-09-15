'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  followUpCreateSchema,
  followUpUpdateSchema,
  restoreSchema,
  softDeleteSchema,
} from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import {
  createFollowUp,
  restoreFollowUp,
  softDeleteFollowUp,
  updateFollowUp,
} from '@/server/services/followups';

function refresh(entryId?: string | null) {
  revalidatePath('/');
  revalidatePath('/seguimientos');
  revalidatePath('/libro');
  revalidatePath('/supervision');
  if (entryId) revalidatePath(`/libro/${entryId}`);
}

export async function createFollowUpAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('followup.create');
    const input = parseOrThrow(followUpCreateSchema, formDataToObject(formData));
    const followUp = await createFollowUp(user, input);
    refresh(followUp.entryId);
    return { ok: true as const, message: 'Seguimiento registrado.', id: followUp.id };
  });
}

export async function updateFollowUpAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('followup.create');
    const input = parseOrThrow(followUpUpdateSchema, formDataToObject(formData));
    const followUp = await updateFollowUp(user, input);
    refresh(followUp.entryId);
    return { ok: true as const, message: 'Seguimiento actualizado.', id: followUp.id };
  });
}

export async function deleteFollowUpAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.delete');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));
    await softDeleteFollowUp(user, input);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Seguimiento eliminado. Queda recuperable.' };
  });
}

export async function restoreFollowUpAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(restoreSchema, formDataToObject(formData));
    await restoreFollowUp(user, input);
    refresh();
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Seguimiento restaurado.' };
  });
}
