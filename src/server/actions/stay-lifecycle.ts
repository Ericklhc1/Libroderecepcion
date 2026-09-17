'use server';

import { revalidatePath } from 'next/cache';
import {
  AuditAction,
  EntryStatus,
  EntryType,
  Priority,
  ReservationStatus,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { addHotelCalendarDays, hotelDateKey, hotelWallDateTime } from '@/domain/time';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { recordAudit } from '@/server/audit';
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

function refresh(roomNumber?: string | null, reservationRefId?: string | null) {
  revalidatePath('/');
  revalidatePath('/libro');
  revalidatePath('/habitaciones');
  revalidatePath('/huespedes');
  revalidatePath('/llaves');
  revalidatePath('/notificaciones');
  revalidatePath('/supervision');
  revalidatePath('/turno');
  revalidatePath('/historial');
  revalidatePath('/estadias-pasadas');
  if (roomNumber) revalidatePath(`/habitaciones/${roomNumber}`);
  if (reservationRefId) revalidatePath(`/huespedes/reservas/${reservationRefId}`);
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
        reservationRefId: true,
        room: { select: { number: true } },
      },
    });
    if (!stay) throw new RuleError('Esa estadía no existe o fue eliminada.');
    if (stay.stage === RoomStayStage.FINALIZADO) throw new RuleError('Esa salida ya fue confirmada.');
    if (stay.status !== RoomStayStatus.IN_HOUSE && stay.status !== RoomStayStatus.CHECK_OUT) {
      throw new RuleError('Sólo se puede dar salida a una estadía in house o en check-out.');
    }

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
    refresh(result.roomNumber, stay.reservationRefId);

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

const modifyStaySchema = z.object({
  stayId: z.string().min(1),
  mode: z.enum(['LATE_CHECKOUT', 'EXTEND']),
  nights: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce.number().int().min(1).max(30).optional(),
  ),
  note: z.string().trim().max(300).optional(),
});

/**
 * Modifica la permanencia sin crear otra identidad.
 *
 * La reserva FNS sigue siendo la misma: se cambia el vencimiento de la estadía
 * física y de su ReservationReference. Si el PMS ya la había puesto en
 * CHECK_OUT, una extensión la devuelve a IN_HOUSE. El antes/después se publica
 * como información del Libro para que el turno siguiente vea el cambio.
 */
export async function modifyStayAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(modifyStaySchema, formDataToObject(formData));
    if (input.mode === 'EXTEND' && !input.nights) {
      throw new RuleError('Indica cuántas noches se extiende la estadía.');
    }

    const stay = await prisma.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      select: {
        id: true,
        reservationId: true,
        reservationRefId: true,
        guestNames: true,
        status: true,
        stage: true,
        departureDate: true,
        roomId: true,
        room: { select: { number: true } },
      },
    });
    if (!stay) throw new RuleError('Esa estadía no existe o fue eliminada.');
    if (stay.stage === RoomStayStage.FINALIZADO) {
      throw new RuleError('No se puede modificar una estadía ya finalizada.');
    }
    if (stay.status !== RoomStayStatus.IN_HOUSE && stay.status !== RoomStayStatus.CHECK_OUT) {
      throw new RuleError('Sólo se modifica una estadía IN_HOUSE o con check-out pendiente.');
    }
    if (!stay.departureDate) {
      throw new RuleError('La estadía no tiene fecha de salida para modificar.');
    }

    const previousDeparture = stay.departureDate;
    const previousStatus = stay.status;
    const nextDeparture =
      input.mode === 'LATE_CHECKOUT'
        ? hotelWallDateTime(hotelDateKey(previousDeparture), 17, 0)
        : addHotelCalendarDays(previousDeparture, input.nights!);

    if (nextDeparture <= new Date()) {
      throw new RuleError(
        input.mode === 'LATE_CHECKOUT'
          ? 'Las 17:00 de esta fecha ya pasaron. Usa Extender si la estadía continúa.'
          : 'La nueva fecha de salida debe quedar en el futuro.',
      );
    }

    const label = input.mode === 'LATE_CHECKOUT' ? 'Late checkout hasta las 17:00' : `Extensión de ${input.nights} noche(s)`;
    const oldText = `${previousStatus} · salida ${previousDeparture.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;
    const newText = `IN_HOUSE · salida ${nextDeparture.toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`;

    await prisma.$transaction(async (tx) => {
      await tx.roomStay.update({
        where: { id: stay.id },
        data: {
          status: RoomStayStatus.IN_HOUSE,
          stage: RoomStayStage.CONFIRMADO,
          departureDate: nextDeparture,
          touchedManually: true,
          note: [
            stay.status === RoomStayStatus.CHECK_OUT ? 'CHECK-OUT REVERTIDO POR MODIFICACIÓN DE ESTADÍA.' : null,
            label,
            input.note?.trim(),
          ].filter(Boolean).join(' '),
        },
      });

      if (stay.reservationRefId) {
        await tx.reservationReference.update({
          where: { id: stay.reservationRefId },
          data: {
            status: ReservationStatus.EN_CASA,
            checkOut: nextDeparture,
            ...(stay.room?.number ? { roomNumber: stay.room.number } : {}),
          },
        });
      }

      await tx.operationalEntry.create({
        data: {
          type: EntryType.NOVEDAD,
          status: EntryStatus.RESUELTO,
          title: `${label} · ${stay.room?.number ? `hab. ${stay.room.number}` : stay.reservationId}`,
          description:
            `MODIFICACIÓN DE ESTADÍA · reserva ${stay.reservationId}. ` +
            `Información anterior: ${oldText}. Información nueva: ${newText}.` +
            (input.note ? ` Observación: ${input.note}` : ''),
          category: 'MODIFICACION_ESTADIA',
          roomId: stay.roomId,
          reservationId: stay.reservationRefId,
          priority: Priority.BAJA,
          ownerId: user.id,
          occurredAt: new Date(),
          tags: [
            'informacion',
            'modificacion-estadia',
            `reserva-${stay.reservationId}`,
            input.mode === 'LATE_CHECKOUT' ? 'late-checkout' : 'extension',
          ],
          requiresFollowUp: false,
          resolution: `Cambio aplicado: ${newText}`,
          createdById: user.id,
        },
      });

      await recordAudit(
        {
          entity: 'RoomStay',
          entityId: stay.id,
          action: AuditAction.EDITAR,
          user,
          summary: `${label} · reserva ${stay.reservationId}${stay.room?.number ? ` · hab. ${stay.room.number}` : ''}`,
          before: { status: previousStatus, departureDate: previousDeparture },
          after: { status: RoomStayStatus.IN_HOUSE, departureDate: nextDeparture },
          reason: input.note?.trim() || null,
        },
        tx,
      );
    });

    refresh(stay.room?.number, stay.reservationRefId);
    return {
      ok: true as const,
      message:
        input.mode === 'LATE_CHECKOUT'
          ? 'Late checkout aplicado. La estadía queda IN_HOUSE hasta las 17:00 y el cambio quedó publicado en el Libro.'
          : `Estadía extendida ${input.nights} noche(s). La reserva vuelve/se mantiene IN_HOUSE y el antes/después quedó publicado.`,
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
