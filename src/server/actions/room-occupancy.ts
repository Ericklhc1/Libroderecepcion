 'use server';

import { revalidatePath } from 'next/cache';
import { RoomStayStatus } from '@prisma/client';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { attachReservationToRoom } from '@/server/services/room-occupancy';

const schema = z.object({
  roomId: z.string().min(1),
  reservationRefId: z.string().min(1),
  status: z.enum(['CHECK_IN', 'IN_HOUSE', 'CHECK_OUT']),
  note: z.string().trim().max(300).optional(),
});

export async function addGuestToRoomAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(schema, formDataToObject(formData));
    const result = await attachReservationToRoom(user, {
      roomId: input.roomId,
      reservationRefId: input.reservationRefId,
      status: RoomStayStatus[input.status],
      note: input.note?.trim() || null,
    });

    revalidatePath('/');
    revalidatePath('/habitaciones');
    revalidatePath('/huespedes');
    revalidatePath('/libro');
    revalidatePath('/llaves');
    revalidatePath('/notificaciones');
    revalidatePath('/habitaciones/' + result.roomNumber);

    return {
      ok: true as const,
      message:
        (result.guestName ?? 'La reserva ' + result.reservationCode) +
        ' quedó vinculada a la habitación ' + result.roomNumber + '.',
    };
  });
}
