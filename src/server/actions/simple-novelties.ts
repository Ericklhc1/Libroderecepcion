'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction, parseOrThrow, formDataToObject, type ActionState } from '@/server/action';
import { requireUser, requirePermission } from '@/server/auth/guard';
import { createSimpleNovelty, resolveSimpleNovelty, updateSimpleNovelty } from '@/server/services/simple-novelties';

const content = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(10000), departmentId: z.string().max(100).optional().transform(v => v || null), workNextAction: z.string().trim().max(2000).optional().transform(v => v || null) });
const revision = z.string().regex(/^[a-f0-9]{64}$/);
function refresh() { for (const path of ['/libro', '/', '/coordinacion', '/housekeeping', '/turno', '/supervision', '/gerencia']) revalidatePath(path); }

export async function createSimpleNoveltyAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.create');
    const input = parseOrThrow(content.extend({ roomId: z.string().max(100).optional().transform(v => v || null), reservationReference: z.string().trim().max(100).optional().transform(v => v || null), internal: z.enum(['true', 'false']).optional().transform(v => v === 'true') }), formDataToObject(form));
    const row = await createSimpleNovelty(user, input); refresh();
    return { ok: true as const, message: `Novedad #${row.humanId} guardada.`, id: row.id };
  });
}
export async function resolveSimpleNoveltyAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(z.object({ id: z.string().min(1), revision, resolution: z.string().trim().max(10000).optional() }), formDataToObject(form));
    const row = await resolveSimpleNovelty(user, input.id, input.revision, input.resolution); refresh();
    return { ok: true as const, message: 'Novedad resuelta.', id: row.id };
  });
}
export async function updateSimpleNoveltyAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('entry.edit');
    const input = parseOrThrow(content.extend({ id: z.string().min(1), revision }), formDataToObject(form));
    const row = await updateSimpleNovelty(user, input, input.revision); refresh(); revalidatePath(`/libro/${row.id}`);
    return { ok: true as const, message: 'Novedad actualizada.', id: row.id };
  });
}
