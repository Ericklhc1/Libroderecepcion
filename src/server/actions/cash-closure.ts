'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { closeShiftCash, reopenShiftCash } from '@/server/services/cash-closure';
import {
  failOperationalMetric,
  finishOperationalMetric,
  shiftCloseCorrelationId,
  startOperationalMetric,
} from '@/server/observability/operational';

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
    const user = await requirePermission('cash.close');
    const input = parseOrThrow(closeSchema, formDataToObject(formData));
    const metric = startOperationalMetric({
      startedEventType: 'CASH_CLOSE_STARTED',
      completedEventType: 'CASH_CLOSED',
      failedEventType: 'CASH_CLOSE_FAILED',
      userId: user.id,
      shiftId: input.shiftId,
      entityType: 'Shift',
      entityId: input.shiftId,
      correlationId: shiftCloseCorrelationId(input.shiftId),
    });

    try {
      const closure = await closeShiftCash(user, input);
      finishOperationalMetric(metric, {
        metadata: {
          hasDifference: closure.snapshot.currencies.some(
            (currency) => currency.difference !== 0,
          ),
        },
      });
      refresh(input.shiftId);
      return {
        ok: true as const,
        message: `Caja cerrada por ${closure.closedByName}. El turno ya puede continuar a su entrega.`,
        id: closure.id,
      };
    } catch (error) {
      failOperationalMetric(metric, error);
      throw error;
    }
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
    const user = await requirePermission('cash.reopen');
    const input = parseOrThrow(reopenSchema, formDataToObject(formData));
    await reopenShiftCash(user, input);
    refresh(input.shiftId);
    return { ok: true as const, message: 'Caja reabierta. Debe auditarse y cerrarse nuevamente antes de entregar el turno.' };
  });
}
