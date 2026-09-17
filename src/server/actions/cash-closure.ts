'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { closeShiftCash, reopenShiftCash } from '@/server/services/cash-closure';

const closeSchema = z.object({
  shiftId: z.string().min(1),
  notes: z.string().trim().max(1000).optional().transform((value) => value || null),
});

function refresh(shiftId: string) {
  revalidatePath('/caja');
  revalidatePath('/turno');
  revalidatePath(`/turno/${shiftId}`);
  revalidatePath('/supervision');
  revalidatePath('/indicadores');
}

export async function closeShiftCashAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = parseOrThrow(closeSchema, formDataToObject(formData));
    const closure = await closeShiftCash(user, input);
    refresh(input.shiftId);
    return {
      ok: true as const,
      message: `Caja cerrada por ${closure.closedByName}. El turno ya puede continuar a su entrega.`,
      id: closure.id,
    };
  });
}

const reopenSchema = z.object({
  shiftId: z.string().min(1),
  reason: z.string().trim().min(5, 'Indica por qué se reabre Caja.').max(500),
});

export async function reopenShiftCashAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.view');
    const input = parseOrThrow(reopenSchema, formDataToObject(formData));
    await reopenShiftCash(user, input);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Caja reabierta. Debe auditarse y cerrarse nuevamente antes de entregar el turno.' };
  });
}
