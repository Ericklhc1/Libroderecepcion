'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  closeLaundryShipment,
  deliverLaundryShipment,
  prepareLaundryShipment,
  receiveLaundryShipment,
} from '@/server/services/laundry';

const lineSchema = z.object({
  itemId: z.string().min(1),
  sentQuantity: z.number().int().positive(),
  weightSentKg: z.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const receiveLineSchema = z.object({
  itemId: z.string().min(1),
  receivedNow: z.number().int().nonnegative(),
  conformingNow: z.number().int().nonnegative(),
  reprocessNow: z.number().int().nonnegative(),
  reprocessResolvedNow: z.number().int().nonnegative().optional(),
  weightReceivedKg: z.number().nonnegative().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

function json<T>(value: unknown, schema: z.ZodType<T>): T {
  if (typeof value !== 'string') throw new Error('Faltan líneas de lavandería.');
  return schema.parse(JSON.parse(value));
}
function refresh() {
  revalidatePath('/lavanderia');
  revalidatePath('/inventario');
  revalidatePath('/coordinacion');
  revalidatePath('/libro');
}

const prepareSchema = z.object({
  requestKey: z.string().min(8).max(180),
  originLocationId: z.string().min(1),
  laundryLocationId: z.string().min(1),
  notes: z.string().trim().max(1000).optional().transform((value) => value || null),
  lines: z.string().min(2),
});

export async function prepareLaundryShipmentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('laundry.manage');
    const input = parseOrThrow(prepareSchema, formDataToObject(formData));
    const lines = json(input.lines, z.array(lineSchema).min(1).max(100));
    const result = await prepareLaundryShipment(user, { ...input, lines });
    refresh();
    return {
      ok: true as const,
      id: result.shipment.id,
      message: result.repeated
        ? `El folio ${result.shipment.folio} ya estaba preparado.`
        : `Folio ${result.shipment.folio} preparado. Confirma la entrega física cuando salga.`,
    };
  });
}

const idSchema = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(1000).optional().transform((value) => value || null),
});

export async function deliverLaundryShipmentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('laundry.manage');
    const input = parseOrThrow(idSchema, formDataToObject(formData));
    const result = await deliverLaundryShipment(user, input);
    refresh();
    return {
      ok: true as const,
      id: result.shipment.id,
      message: result.repeated ? 'La entrega ya estaba confirmada.' : 'Entrega física a lavandería confirmada.',
    };
  });
}

const receiveSchema = z.object({
  id: z.string().min(1),
  requestKey: z.string().min(8).max(180),
  withDifferences: z.string().optional().transform((value) => ['1','true','on'].includes(value ?? '')),
  note: z.string().trim().max(1000).optional().transform((value) => value || null),
  lines: z.string().min(2),
});

export async function receiveLaundryShipmentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('laundry.manage');
    const input = parseOrThrow(receiveSchema, formDataToObject(formData));
    const lines = json(input.lines, z.array(receiveLineSchema).min(1).max(100));
    const result = await receiveLaundryShipment(user, { ...input, lines });
    refresh();
    return {
      ok: true as const,
      id: result.receiptId,
      message: result.repeated
        ? 'Esta recepción ya estaba registrada.'
        : result.shipment.status === 'RECIBIDO_DIFERENCIAS'
          ? 'Recepción guardada con diferencias. El incidente vinculado permanece abierto para seguimiento.'
          : result.shipment.status === 'RECIBIDO'
            ? 'Recepción completa registrada.'
            : 'Recepción parcial registrada; el folio continúa abierto.',
    };
  });
}

export async function closeLaundryShipmentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('laundry.manage');
    const input = parseOrThrow(idSchema, formDataToObject(formData));
    const row = await closeLaundryShipment(user, input);
    refresh();
    return { ok: true as const, id: row.id, message: `Folio ${row.folio} cerrado.` };
  });
}
