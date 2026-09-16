import 'server-only';

import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const ACTIVE_GUEST_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];
const ELIGIBLE_GUEST_STATUSES = [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT];

export type GymPassRoomContext = {
  stayId: string;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
};

/**
 * Devuelve el huésped al que se le puede vender un pase en esta habitación.
 *
 * La fuente de verdad es RoomStay, que sí viene del PMS. IN_HOUSE está en casa
 * por defecto. CHECK_OUT sigue en casa hasta que la salida se confirma; al
 * pasar a FINALIZADO deja de ser elegible.
 */
export async function getGymPassContextForRoom(
  roomNumber: string,
): Promise<GymPassRoomContext | null> {
  const stays = await prisma.roomStay.findMany({
    where: {
      deletedAt: null,
      room: { number: roomNumber },
      status: { in: ELIGIBLE_GUEST_STATUSES },
      stage: { in: ACTIVE_GUEST_STAGES },
    },
    select: {
      id: true,
      status: true,
      reservationId: true,
      guestNames: true,
    },
  });

  const stay =
    stays.find((item) => item.status === RoomStayStatus.IN_HOUSE) ??
    stays.find((item) => item.status === RoomStayStatus.CHECK_OUT) ??
    null;

  if (!stay) return null;

  return {
    stayId: stay.id,
    reservationCode: stay.reservationId,
    roomNumber,
    guestName: stay.guestNames[0] || 'Huésped',
  };
}
