'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireHousekeepingUser } from '@/server/auth/housekeeping';
import { runAction, parseOrThrow, formDataToObject, zOptionalDate, type ActionState } from '@/server/action';
import { HOUSEKEEPING_ACTIONS } from '@/domain/housekeeping';
import { createHousekeepingRequest, changeHousekeepingRequest } from '@/server/services/housekeeping';

const optionalText = (max: number) => z.string().trim().max(max).optional();
const createSchema = z.object({
  requestKey: z.string().uuid(), title: optionalText(160), description: optionalText(3000),
  sourceEntryId: optionalText(100).transform((v) => v || undefined), location: optionalText(160),
  priority: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).default('MEDIA'), dueAt: zOptionalDate,
});
const changeSchema = z.object({
  id: z.string().min(1).max(100), version: z.coerce.number().int().min(1),
  action: z.enum(HOUSEKEEPING_ACTIONS), note: optionalText(3000), dueAt: zOptionalDate,
});

export async function createHousekeepingAction(_state: ActionState | null, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireHousekeepingUser();
    const input = parseOrThrow(createSchema, formDataToObject(formData));
    const request = await createHousekeepingRequest(user, input);
    revalidatePath('/admin/housekeeping');
    return { ok: true as const, message: `Aviso de prueba #${request.humanId} guardado.`, id: request.id };
  });
}

export async function changeHousekeepingAction(_state: ActionState | null, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireHousekeepingUser();
    const input = parseOrThrow(changeSchema, formDataToObject(formData));
    const request = await changeHousekeepingRequest(user, input);
    revalidatePath('/admin/housekeeping');
    return { ok: true as const, message: `Aviso #${request.humanId} actualizado; acción de prueba registrada.`, id: request.id };
  });
}
