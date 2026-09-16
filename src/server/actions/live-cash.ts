'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  createGymPass,
  saveLiveCashAudit,
  voidGymPass,
} from '@/server/services/live-cash';

const gymPassSchema = z.object({
  stayId: z.string().min(1),
  currency: z.enum(['CLP', 'USD']),
  paymentMethod: z.enum(['EFECTIVO', 'TARJETA', 'OTRO']),
});

export async function createGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(gymPassSchema, formDataToObject(formData));
    const pass = await createGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/habitaciones');
    return {
      ok: true as const,
      message: `Folio ${pass.formattedFolio} generado. Escríbelo en el pase físico.`,
      id: pass.id,
    };
  });
}

const voidSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(5, 'Indica por qué se anula el folio.').max(500),
});

export async function voidGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(voidSchema, formDataToObject(formData));
    await voidGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/habitaciones');
    return { ok: true as const, message: 'Folio anulado. La trazabilidad se conserva.' };
  });
}

const auditSchema = z.object({
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  countedAmount: z.coerce.number().nonnegative(),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function saveLiveCashAuditAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.view');
    const input = parseOrThrow(auditSchema, formDataToObject(formData));
    const result = await saveLiveCashAudit(user, input);
    revalidatePath('/caja');
    const difference = result.difference;
    return {
      ok: true as const,
      message:
        difference === 0
          ? `Caja ${input.currency} auditada: cuadra exactamente.`
          : `Caja ${input.currency} auditada: diferencia ${difference > 0 ? '+' : ''}${difference}.`,
    };
  });
}
