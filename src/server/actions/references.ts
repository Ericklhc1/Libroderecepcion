'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction, RoomStayStage } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  guaranteeCreateSchema,
  guaranteeDeleteSchema,
  guaranteeStateSchema,
  guestSchema,
  reservationSchema,
} from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { AppError, RuleError } from '@/server/errors';
import {
  changeGuaranteeState,
  createGuarantee,
  softDeleteGuarantee,
} from '@/server/services/guarantees';
import { GUARANTEE_STATE_LABELS } from '@/domain/guarantees';
import { hotelDateKey } from '@/domain/time';

/**
 * Referencias ligeras de huésped y reserva.
 *
 * No son un PMS: sólo permiten asociar registros operativos a un huésped, una
 * habitación y una reserva. El campo `externalId` queda disponible para
 * sincronizar con el PMS más adelante sin migrar datos.
 */
export async function saveGuestAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('guest.manage');
    const input = parseOrThrow(guestSchema, formDataToObject(formData));

    const guest = input.id
      ? await prisma.guestReference.update({
          where: { id: input.id },
          data: {
            fullName: input.fullName,
            roomNumber: input.roomNumber,
            documentId: input.documentId,
            email: input.email,
            phone: input.phone,
            language: input.language,
            vip: input.vip,
            notes: input.notes,
          },
        })
      : await prisma.guestReference.create({
          data: {
            fullName: input.fullName,
            roomNumber: input.roomNumber,
            documentId: input.documentId,
            email: input.email,
            phone: input.phone,
            language: input.language,
            vip: input.vip,
            notes: input.notes,
          },
        });

    await recordAudit({
      entity: 'GuestReference',
      entityId: guest.id,
      action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
      summary: `Huésped ${guest.fullName}${guest.roomNumber ? ` (hab. ${guest.roomNumber})` : ''} ${input.id ? 'actualizado' : 'registrado'}`,
      user,
      after: { fullName: guest.fullName, roomNumber: guest.roomNumber, vip: guest.vip },
    });

    revalidatePath('/huespedes');
    revalidatePath('/libro');
    return {
      ok: true as const,
      message: `Huésped ${input.id ? 'actualizado' : 'registrado'}.`,
      id: guest.id,
    };
  });
}

/** Convierte una fecha de pared del hotel a la fecha pura que guarda RoomStay. */
function stayDate(value: Date | null | undefined): Date | null {
  return value ? new Date(`${hotelDateKey(value)}T00:00:00.000Z`) : null;
}

export async function saveReservationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('guest.manage');
    const input = parseOrThrow(reservationSchema, formDataToObject(formData));

    if (input.checkIn && input.checkOut && input.checkOut < input.checkIn) {
      throw new RuleError('La salida no puede quedar antes de la llegada.');
    }

    if (!input.id) {
      const exists = await prisma.reservationReference.findUnique({
        where: { code: input.code },
      });
      if (exists) throw new AppError('Ya existe una reserva con ese código.', 'DUPLICATE');
    }

    const previous = input.id
      ? await prisma.reservationReference.findUnique({
          where: { id: input.id },
          select: { checkIn: true, checkOut: true },
        })
      : null;

    const data = {
      code: input.code,
      guestId: input.guestId,
      roomNumber: input.roomNumber,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      channel: input.channel,
      status: input.status,
      guaranteeStatus: input.guaranteeStatus,
      balanceDue: input.balanceDue,
      requiresAction: input.requiresAction,
      actionNote: input.actionNote,
      notes: input.notes,
    };

    const datesChanged = Boolean(
      input.id &&
        previous &&
        (previous.checkIn?.getTime() !== input.checkIn?.getTime() ||
          previous.checkOut?.getTime() !== input.checkOut?.getTime()),
    );

    const { reservation, syncedStays } = await prisma.$transaction(async (tx) => {
      const reservation = input.id
        ? await tx.reservationReference.update({ where: { id: input.id }, data })
        : await tx.reservationReference.create({ data });

      /*
        La referencia de reserva no reemplaza al PMS. Pero cuando una persona
        corrige explícitamente las fechas de una reserva ya vinculada, dejar la
        estadía con las fechas viejas crea dos verdades dentro del propio Libro.
        Sólo se tocan estadías VIVAS y se marca `touchedManually`: una carga
        posterior del PMS no puede deshacer la corrección humana en silencio.
      */
      let syncedStays = 0;
      if (datesChanged) {
        const updated = await tx.roomStay.updateMany({
          where: {
            reservationRefId: reservation.id,
            deletedAt: null,
            stage: { not: RoomStayStage.FINALIZADO },
          },
          data: {
            arrivalDate: stayDate(input.checkIn),
            departureDate: stayDate(input.checkOut),
            touchedManually: true,
          },
        });
        syncedStays = updated.count;
      }

      return { reservation, syncedStays };
    });

    await recordAudit({
      entity: 'ReservationReference',
      entityId: reservation.id,
      action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
      summary:
        `Reserva ${reservation.code} ${input.id ? 'actualizada' : 'registrada'} (${reservation.status})` +
        (syncedStays > 0 ? ` · ${syncedStays} estadía(s) activa(s) sincronizada(s)` : ''),
      user,
      after: {
        code: reservation.code,
        status: reservation.status,
        guaranteeStatus: reservation.guaranteeStatus,
        requiresAction: reservation.requiresAction,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        syncedStays,
      },
    });

    revalidatePath('/huespedes');
    revalidatePath('/alertas');
    revalidatePath('/habitaciones');
    revalidatePath('/turno');
    revalidatePath('/');
    revalidatePath('/libro');
    if (reservation.roomNumber) revalidatePath(`/habitaciones/${reservation.roomNumber}`);
    return {
      ok: true as const,
      message:
        `Reserva ${input.id ? 'actualizada' : 'registrada'}.` +
        (syncedStays > 0 ? ` Se actualizaron ${syncedStays} estadía(s) vinculada(s).` : ''),
      id: reservation.id,
    };
  });
}

/** Pantallas que muestran garantías. Invalidación acotada, no global. */
function refreshGuarantees(): void {
  revalidatePath('/caja');
  revalidatePath('/supervision');
  revalidatePath('/turno');
  revalidatePath('/');
}

/* --------------------------------- Garantías -------------------------------- */

/**
 * Las garantías se administran con el mismo permiso que las reservas
 * (`guest.manage`): son parte del contexto de la reserva, no un módulo aparte,
 * así que no se agrega un permiso nuevo.
 */
export async function createGuaranteeAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseOrThrow(guaranteeCreateSchema, formDataToObject(formData));
    const user = await requirePermission('cash.guarantee_in');
    const guarantee = await createGuarantee(user, input);
    refreshGuarantees();
    return {
      ok: true as const,
      message: `Garantía registrada por ${input.currency} ${input.amount}.`,
      id: guarantee.id,
    };
  });
}

export async function changeGuaranteeStateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.guarantee_out');
    const input = parseOrThrow(guaranteeStateSchema, formDataToObject(formData));
    await changeGuaranteeState(user, input);
    refreshGuarantees();
    return {
      ok: true as const,
      message: `Garantía actualizada: ${GUARANTEE_STATE_LABELS[input.state]}.`,
    };
  });
}

export async function deleteGuaranteeAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.guarantee_out');
    const input = parseOrThrow(guaranteeDeleteSchema, formDataToObject(formData));
    await softDeleteGuarantee(user, input);
    refreshGuarantees();
    return { ok: true as const, message: 'Garantía eliminada. Se conserva y puede auditarse.' };
  });
}
