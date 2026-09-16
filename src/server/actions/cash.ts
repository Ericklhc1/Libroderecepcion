'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import {
  markHandoverElements,
  recordCashTransfer,
  saveCashCount,
} from '@/server/services/cash';
import { fromMinor } from '@/domain/cash';

/**
 * Acciones de caja.
 *
 * El permiso es `shift.handover` para declarar y `shift.receive` para
 * confirmar, de modo que quien cuenta es quien entrega o quien recibe, y no un
 * tercero. Las cantidades llegan en campos `d_<idDenominación>`, porque un
 * formulario no puede enviar un objeto.
 */

const handoverIdSchema = z.object({ handoverId: z.string().min(1) });

/** Extrae las cantidades de los campos `d_<id>` del formulario. */
function quantitiesFrom(formData: FormData): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('d_') || typeof value !== 'string') continue;
    const raw = value.trim();
    if (raw === '') continue;

    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RuleError(
        'Las cantidades del arqueo deben ser números enteros: no hay medio billete.',
      );
    }
    quantities[key.slice(2)] = quantity;
  }
  return quantities;
}

function summarise(statuses: Array<{ currency: string; countedMinor: number }>): string {
  if (statuses.length === 0) return 'Arqueo guardado sin efectivo declarado.';
  return `Arqueo guardado: ${statuses
    .map((status) => `${fromMinor(status.countedMinor, status.currency)} ${status.currency}`)
    .join(' · ')}.`;
}

export async function declareCashCountAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));
    const notes = formData.get('notes');

    const { statuses } = await saveCashCount(user, {
      handoverId,
      kind: 'DECLARADO',
      quantities: quantitiesFrom(formData),
      notes: typeof notes === 'string' ? notes : null,
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: summarise(statuses) };
  });
}

export async function confirmCashCountAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.receive');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));
    const notes = formData.get('notes');

    const { statuses } = await saveCashCount(user, {
      handoverId,
      kind: 'CONFIRMADO',
      quantities: quantitiesFrom(formData),
      notes: typeof notes === 'string' ? notes : null,
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: summarise(statuses) };
  });
}

const transferSchema = z.object({
  handoverId: z.string().min(1),
  currency: z.string().trim().toUpperCase().length(3, 'La divisa lleva tres letras'),
  amount: z.coerce.number().positive('El monto debe ser mayor que cero'),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordCashTransferAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = transferSchema.parse(formDataToObject(formData));

    await recordCashTransfer(user, {
      handoverId: input.handoverId,
      currency: input.currency,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${input.handoverId}`);
    return {
      ok: true as const,
      message: `Egreso de ${input.amount} ${input.currency} registrado.`,
    };
  });
}

/** Marca los elementos como declarados o confirmados según quién los envía. */
function elementMarks(formData: FormData): Record<string, boolean> {
  const marks: Record<string, boolean> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('e_')) continue;
    marks[key.slice(2)] = value === 'on' || value === 'true' || value === '1';
  }
  return marks;
}

export async function declareElementsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));

    await markHandoverElements(user, {
      handoverId,
      field: 'declared',
      marks: elementMarks(formData),
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: 'Elementos declarados.' };
  });
}

export async function confirmElementsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.receive');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));

    await markHandoverElements(user, {
      handoverId,
      field: 'confirmed',
      marks: elementMarks(formData),
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: 'Elementos confirmados.' };
  });
}
