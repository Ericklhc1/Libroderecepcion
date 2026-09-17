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
import {
  getCheckoutKeyContext,
  resolveCheckoutKeyReturn,
} from '@/server/services/checkout-keys';

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
  revalidatePath('/llaves');
  revalidatePath('/notificaciones');
  revalidatePath('/supervision');
  revalidatePath('/turno');
  revalidatePath('/historial');
  revalidatePath('/estadias-pasadas');
  if (roomNumber) revalidatePath(`/habitaciones/${roomNumber}`);
}

const checkoutSchema = z.object({
  stayId: z.string().min(1),
  note: z.string().trim().max(300).optional(),
  returnedKeyCount: z.coerce.number().int().min(0).default(0),
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
      select: {
        id: true,
        status: true,
        stage: true,
        departureDate: true,
        room: { select: { number: true } },
      },
    });
    if (!stay) throw new RuleError('Esa estadía no existe o fue eliminada.');
    if (stay.stage === RoomStayStage.FINALIZADO) throw new RuleError('Esa salida ya fue confirmada.');
    if (stay.status !== RoomStayStatus.IN_HOUSE && stay.status !== RoomStayStatus.CHECK_OUT) {
      throw new RuleError('Sólo se puede dar salida a una estadía in house o en check-out.');
    }

    /*
      Validamos la cantidad ANTES de cerrar la estadía. Así un dato incorrecto
      en el modal nunca deja un check-out confirmado a medias con las llaves sin
      resolver.
    */
    const keyContext = await getCheckoutKeyContext(stay.id);
    if (input.returnedKeyCount > keyContext.count) {
      throw new RuleError(
        `La habitación tiene ${keyContext.count} llave(s) asociada(s); no puedes confirmar ${input.returnedKeyCount} devuelta(s).`,
      );
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
    const keys = await resolveCheckoutKeyReturn(user, {
      stayId: stay.id,
      returnedCount: input.returnedKeyCount,
    });

    await inheritPendingStayContext(stay.id);
    refresh(result.roomNumber);

    const keyMessage =
      keyContext.count === 0
        ? ' No había llaves asociadas a la estadía.'
        : keys.pending > 0
          ? ` Se recibieron ${keys.returned} de ${keyContext.count} llave(s); ${keys.pending} queda(n) pendiente(s) de devolución.`
          : ` Se recibieron las ${keys.returned} llave(s) y volvieron al inventario.`;

    return {
      ok: true as const,
      message:
        `${early ? 'Check-out anticipado' : 'Salida'} confirmado. ` +
        `La habitación ${result.roomNumber ?? stay.room?.number ?? ''} quedó liberada.` +
        keyMessage,
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
