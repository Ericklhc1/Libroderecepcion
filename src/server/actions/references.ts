'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { guestSchema, reservationSchema } from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { AppError } from '@/server/errors';

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

export async function saveReservationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('guest.manage');
    const input = parseOrThrow(reservationSchema, formDataToObject(formData));

    if (!input.id) {
      const exists = await prisma.reservationReference.findUnique({
        where: { code: input.code },
      });
      if (exists) throw new AppError('Ya existe una reserva con ese código.', 'DUPLICATE');
    }

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

    const reservation = input.id
      ? await prisma.reservationReference.update({ where: { id: input.id }, data })
      : await prisma.reservationReference.create({ data });

    await recordAudit({
      entity: 'ReservationReference',
      entityId: reservation.id,
      action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
      summary: `Reserva ${reservation.code} ${input.id ? 'actualizada' : 'registrada'} (${reservation.status})`,
      user,
      after: {
        code: reservation.code,
        status: reservation.status,
        guaranteeStatus: reservation.guaranteeStatus,
        requiresAction: reservation.requiresAction,
      },
    });

    revalidatePath('/huespedes');
    revalidatePath('/alertas');
    return {
      ok: true as const,
      message: `Reserva ${input.id ? 'actualizada' : 'registrada'}.`,
      id: reservation.id,
    };
  });
}
