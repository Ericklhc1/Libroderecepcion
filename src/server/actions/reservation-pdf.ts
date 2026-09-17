'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  applyReservationPdfDraft,
  createReservationPdfDraft,
  discardReservationPdfDraft,
} from '@/server/services/reservation-pdf';

export async function prepareReservationPdfAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let draftId: string | null = null;
  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const file = formData.get('reservationPdf');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false as const, error: 'Adjunta un PDF de la reserva.' };
    }
    if (file.type && file.type !== 'application/pdf') {
      return { ok: false as const, error: 'El archivo debe ser PDF.' };
    }
    if (file.size > 8 * 1024 * 1024) {
      return { ok: false as const, error: 'El PDF supera los 8 MB permitidos.' };
    }
    const draft = await createReservationPdfDraft(user, {
      fileName: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
    });
    draftId = draft.id;
    return {
      ok: true as const,
      message: draft.extracted.code
        ? `PDF leído. Confirma la reserva ${draft.extracted.code} antes de aplicarla.`
        : 'PDF leído. No pude identificar el ID con seguridad: escríbelo en la revisión antes de aplicar.',
      id: draft.id,
    };
  });
  if (draftId) redirect(`/huespedes/nueva-reserva?revision=${draftId}`);
  return result;
}

const applySchema = z.object({
  draftId: z.string().min(1),
  code: z.string().trim().min(3).max(80),
  guestName: z.string().trim().max(160).optional().transform((value) => value || null),
  roomNumber: z.string().trim().max(10).optional().transform((value) => value || null),
  checkInDate: z.string().trim().optional().transform((value) => value || null),
  checkOutDate: z.string().trim().optional().transform((value) => value || null),
  channel: z.string().trim().max(80).optional().transform((value) => value || null),
});

export async function applyReservationPdfAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let reservationId: string | null = null;
  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(applySchema, formDataToObject(formData));
    const applied = await applyReservationPdfDraft(user, input);
    reservationId = applied.reservationId;
    revalidatePath('/huespedes');
    revalidatePath('/habitaciones');
    revalidatePath('/turno');
    revalidatePath('/supervision');
    revalidatePath(`/huespedes/reservas/${applied.reservationId}`);
    return {
      ok: true as const,
      message: applied.created
        ? `Reserva ${applied.code} creada desde el PDF.`
        : `Reserva ${applied.code} ya existía: se reconcilió por ID sin duplicarla.`,
      id: applied.reservationId,
    };
  });
  if (reservationId) redirect(`/huespedes/reservas/${reservationId}`);
  return result;
}

export async function discardReservationPdfAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let done = false;
  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const draftId = String(formData.get('draftId') ?? '');
    if (!draftId) return { ok: false as const, error: 'Falta el borrador a descartar.' };
    await discardReservationPdfDraft(user, draftId);
    done = true;
    return { ok: true as const, message: 'Borrador descartado. No se modificó ninguna reserva.' };
  });
  if (done) redirect('/huespedes');
  return result;
}
