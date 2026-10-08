'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/server/auth/guard';
import { runAction, parseOrThrow, formDataToObject, type ActionState } from '@/server/action';
import { reviewShiftClosure } from '@/server/services/closure-review';
export async function reviewShiftClosureAction(_state: ActionState | null, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(z.object({ shiftId: z.string().min(1), revision: z.string().datetime(), decision: z.enum(['VALIDADA', 'OBSERVADA']), note: z.string().trim().min(1).max(2000) }), formDataToObject(formData));
    await reviewShiftClosure(user, input);
    revalidatePath('/alertas/sistema'); revalidatePath('/supervision'); revalidatePath(`/supervision/cierres/${input.shiftId}`); revalidatePath('/turno');
    return { ok: true as const, message: input.decision === 'VALIDADA' ? 'Cierre validado y auditado.' : 'Observación registrada; el cierre sigue pendiente de validación.' };
  });
}
