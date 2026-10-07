'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { runAction, parseOrThrow, formDataToObject, type ActionState } from '@/server/action';
import { assertCleanupAdmin, cleanupAdminRecord, cleanupInput } from '@/server/services/admin-cleanup';
import { removeShiftMember } from '@/server/services/shifts';

export async function cleanupAdminRecordAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    assertCleanupAdmin(user);
    await cleanupAdminRecord(user, parseOrThrow(cleanupInput, formDataToObject(form)));
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'Registro eliminado de las vistas operativas. La auditoría y el historial se conservan.' };
  });
}
const memberSchema = z.object({ shiftId: z.string().min(1), userId: z.string().min(1), reason: z.string().trim().min(5).max(500), confirmation: z.literal('RETIRAR') });
export async function cleanupShiftMemberAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    assertCleanupAdmin(user);
    const input = parseOrThrow(memberSchema, formDataToObject(form));
    await removeShiftMember(user, { ...input, adminCleanup: true });
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'Persona retirada. El turno y su historial se conservan.' };
  });
}
