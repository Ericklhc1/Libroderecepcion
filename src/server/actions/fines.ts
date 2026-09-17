'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { FineKind, LinenKind } from '@prisma/client';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalString,
  zRequiredString,
  type ActionState,
} from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  changeFineStatus,
  createFine,
  softDeleteFine,
} from '@/server/services/fines';

/**
 * Acciones de las multas.
 *
 * El permiso es `incident.manage`: cobrar a un huésped es una decisión de
 * supervisión, no de mesón. Registrarla también, porque una multa mal puesta
 * cuesta más que una no puesta.
 */

const createSchema = z.object({
  roomNumber: z.string().trim().min(1),
  reservationCode: zRequiredString(40, 'El número de reserva'),
  guestName: zRequiredString(150, 'El nombre del huésped'),
  stayId: zOptionalString,
  reservationReferenceId: zOptionalString,
  kind: z.nativeEnum(FineKind).default(FineKind.BLANCO),
  linenKind: z
    .union([z.nativeEnum(LinenKind), z.literal('')])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  itemDetail: zOptionalString,
  stainType: zOptionalString,
  reason: zRequiredString(2000, 'El motivo del cobro'),
  guestStatement: zOptionalString,
  quantity: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === '' || value === undefined || value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }),
  amount: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === '' || value === undefined || value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }),
});

export async function createFineAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('incident.manage');
    const input = parseOrThrow(createSchema, formDataToObject(formData));

    const fine = await createFine(user, {
      roomNumber: input.roomNumber,
      reservationCode: input.reservationCode,
      guestName: input.guestName,
      stayId: input.stayId ?? null,
      reservationReferenceId: input.reservationReferenceId ?? null,
      kind: input.kind,
      linenKind: input.linenKind,
      itemDetail: input.itemDetail ?? null,
      stainType: input.stainType ?? null,
      reason: input.reason,
      guestStatement: input.guestStatement ?? null,
      quantity: input.quantity,
      amount: input.amount,
    });

    revalidatePath(`/habitaciones/${input.roomNumber}`);
    revalidatePath('/habitaciones');
    revalidatePath('/supervision');
    return {
      ok: true as const,
      message: 'Multa registrada. Queda en la habitación y en Supervisión.',
      id: fine.id,
    };
  });
}

const statusSchema = z.object({
  fineId: z.string().min(1),
  status: z.enum(['NOTIFICADA', 'COBRADA', 'CONDONADA', 'ANULADA']),
  note: zOptionalString,
  roomNumber: z.string().trim().min(1),
});

export async function changeFineStatusAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('incident.manage');
    const input = parseOrThrow(statusSchema, formDataToObject(formData));

    await changeFineStatus(user, {
      fineId: input.fineId,
      status: input.status,
      note: input.note ?? null,
    });

    revalidatePath(`/habitaciones/${input.roomNumber}`);
    revalidatePath('/supervision');
    return { ok: true as const, message: 'Estado de la multa actualizado.' };
  });
}

export async function deleteFineAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('incident.manage');
    const input = parseOrThrow(
      z.object({
        fineId: z.string().min(1),
        reason: zRequiredString(500, 'El motivo'),
        roomNumber: z.string().trim().min(1),
      }),
      formDataToObject(formData),
    );

    await softDeleteFine(user, { fineId: input.fineId, reason: input.reason });

    revalidatePath(`/habitaciones/${input.roomNumber}`);
    revalidatePath('/supervision');
    return { ok: true as const, message: 'Multa eliminada. Queda en el registro.' };
  });
}
