'use server';

import { revalidatePath } from 'next/cache';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { confirmCheckOut, softDeleteStay } from '@/server/services/rooms';

async function inheritPendingStayContext(stayId: string) {
  const stay = await prisma.roomStay.findUnique({
    where: { id: stayId },
    select: {
      id: true,
      roomId: true,
      reservationRefId: true,
      reservationRef: { select: { guestId: true } },
    },
  });
  if (!stay?.roomId) return;

  await prisma.operationalEntry.updateMany({
    where: {
      roomId: stay.roomId,
      deletedAt: null,
      status: { in: ENTRY_OPEN_STATUSES },
      ...(stay.reservationRefId
        ? { OR: [{ reservationId: stay.reservationRefId }, { reservationId: null }] }
        : {}),
    },
    data: {
      roomId: null,
      ...(stay.reservationRefId ? { reservationId: stay.reservationRefId } : {}),
      ...(stay.reservationRef?.guestId ? { guestId: stay.reservationRef.guestId } : {}),
    },
  });
}

function refresh(roomNumber?: string | null) {
  revalidatePath('/');
  revalidatePath('/libro');
  revalidatePath('/habitaciones');
  revalidatePath('/supervision');
  revalidatePath('/turno');
  revalidatePath('/historial');
  revalidatePath('/estadias-pasadas');
  if (roomNumber) revalidatePath(`/habitaciones/${roomNumber}`);
}

const checkoutSchema = z.object({
  stayId: z.string().min(1),
  note: z.string().trim().max(300).optional(),
});

/** Salida única: sirve tanto para CHECK_OUT PMS como para IN_HOUSE anticipado. */
export async function completeStayCheckoutAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(checkoutSchema, formDataToObject(formData));
    const stay = await prisma.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      select: { id: true, status: true, stage: true, departureDate: true, room: { select: { number: true } } },
    });
    if (!stay) throw new RuleError('Esa estadía no existe o fue eliminada.');
    if (stay.stage === RoomStayStage.FINALIZADO) throw new RuleError('Esa salida ya fue confirmada.');
    if (stay.status !== RoomStayStatus.IN_HOUSE && stay.status !== RoomStayStatus.CHECK_OUT) {
      throw new RuleError('Sólo se puede dar salida a una estadía in house o en check-out.');
    }

    const early = stay.status === RoomStayStatus.IN_HOUSE;
    if (early) {
      await prisma.roomStay.update({
        where: { id: stay.id },
        data: {
          status: RoomStayStatus.CHECK_OUT,
          touchedManually: true,
          note: [
            `CHECK-OUT ANTICIPADO. Salida prevista original: ${stay.departureDate?.toISOString() ?? 'sin fecha'}.`,
            input.note?.trim(),
          ].filter(Boolean).join(' '),
        },
      });
    }

    const result = await confirmCheckOut(user, {
      stayId: stay.id,
      note: early
        ? `CHECK-OUT ANTICIPADO. ${input.note?.trim() ?? ''}`.trim()
        : input.note?.trim() || null,
    });
    await inheritPendingStayContext(stay.id);
    refresh(result.roomNumber);

    return {
      ok: true as const,
      message:
        `${early ? 'Check-out anticipado' : 'Salida'} confirmado. ` +
        `La habitación ${result.roomNumber ?? stay.room?.number ?? ''} quedó liberada.` +
        (result.pendingKeys > 0 ? ` Quedan ${result.pendingKeys} llave(s) por recibir.` : ''),
    };
  });
}

const deleteSchema = z.object({
  stayId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
});

/** Eliminar una estadía conserva sus pendientes en el mismo historial heredable. */
export async function deleteStayPreservingPendingAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('stay.delete');
    const input = parseOrThrow(deleteSchema, formDataToObject(formData));
    await inheritPendingStayContext(input.stayId);
    const result = await softDeleteStay(user, input);
    const roomNumber = result.stay.room?.number ?? null;
    refresh(roomNumber);
    return {
      ok: true as const,
      message:
        `Estadía eliminada sin perder pendientes.` +
        (result.releasedKeys > 0 ? ` ${result.releasedKeys} llave(s) liberada(s).` : ''),
    };
  });
}
