'use server';

import { revalidatePath } from 'next/cache';
import { EntryType } from '@prisma/client';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  entryCreateWithContextSchema,
  entryStatusSchema,
  entryUpdateWithContextSchema,
  restoreSchema,
  softDeleteSchema,
} from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import {
  changeEntryStatus,
  createEntry,
  restoreEntry,
  softDeleteEntry,
  updateEntry,
} from '@/server/services/entries';

function refreshOperationalViews(entryId?: string) {
  revalidatePath('/');
  revalidatePath('/libro');
  revalidatePath('/incidencias');
  revalidatePath('/alertas');
  if (entryId) revalidatePath(`/libro/${entryId}`);
}

export async function createEntryAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const raw = formDataToObject(formData);
    const input = parseOrThrow(entryCreateWithContextSchema, raw);
    const permission =
      input.type === EntryType.INCIDENCIA ? 'incident.create' : 'entry.create';
    const user = await requirePermission(permission);

    const entry = await createEntry(user, input);
    refreshOperationalViews(entry.id);
    return {
      ok: true as const,
      message: `Registro #${entry.seq} creado.`,
      id: entry.id,
    };
  });
}

export async function updateEntryAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.edit');
    const input = parseOrThrow(entryUpdateWithContextSchema, formDataToObject(formData));
    const entry = await updateEntry(user, input);
    refreshOperationalViews(entry.id);
    return { ok: true as const, message: 'Registro actualizado.', id: entry.id };
  });
}

export async function changeEntryStatusAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.edit');
    const input = parseOrThrow(entryStatusSchema, formDataToObject(formData));
    const entry = await changeEntryStatus(user, input);
    refreshOperationalViews(entry.id);
    return { ok: true as const, message: 'Estado actualizado.', id: entry.id };
  });
}

export async function deleteEntryAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.delete');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));
    await softDeleteEntry(user, input);
    refreshOperationalViews(input.id);
    revalidatePath('/admin/eliminados');
    return {
      ok: true as const,
      message: 'Registro eliminado. Queda recuperable desde Administración.',
    };
  });
}

export async function restoreEntryAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.restore');
    const input = parseOrThrow(restoreSchema, formDataToObject(formData));
    await restoreEntry(user, input);
    refreshOperationalViews(input.id);
    revalidatePath('/admin/eliminados');
    return { ok: true as const, message: 'Registro restaurado.' };
  });
}
