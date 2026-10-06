'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, zOptionalString, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { finishManagementWorkday, startManagementWorkday } from '@/server/services/management-workday';

function refresh() {
  revalidatePath('/jornada');
  revalidatePath('/');
  revalidatePath('/coordinacion');
  revalidatePath('/housekeeping');
}

export async function startManagementWorkdayAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('workday.manage');
    const input = parseOrThrow(
      z.object({ departmentId: z.string().min(1, 'Selecciona un área.') }),
      formDataToObject(formData),
    );
    const shift = await startManagementWorkday(user, input);
    refresh();
    return { ok: true as const, message: 'Jornada iniciada. Tus pendientes y decisiones quedan vinculados a tu área.', id: shift.id };
  });
}

export async function finishManagementWorkdayAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('workday.manage');
    const input = parseOrThrow(
      z.object({
        shiftId: z.string().min(1),
        note: zOptionalString,
      }),
      formDataToObject(formData),
    );
    await finishManagementWorkday(user, input);
    refresh();
    return { ok: true as const, message: 'Jornada cerrada. Los pendientes abiertos conservan su continuidad.' };
  });
}
