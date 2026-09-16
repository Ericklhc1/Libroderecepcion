import 'server-only';

import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { RuleError } from '@/server/errors';

const ACTIVE_GUEST_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];
const ELIGIBLE_GUEST_STATUSES = [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT];

export type GymPassRoomContext = {
  reservationReferenceId: string;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
};

/**
 * Devuelve el huésped al que se le puede vender un pase en esta habitación.
 *
 * Regla operativa: IN_HOUSE está en casa por defecto. CHECK_OUT sigue en casa
 * hasta que la salida se confirma; esa confirmación mueve la estadía a
 * FINALIZADO y desde ese momento deja de ser elegible.
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
      reservationRefId: { not: null },
    },
    select: {
      status: true,
      reservationId: true,
      guestNames: true,
      reservationRefId: true,
      reservationRef: {
        select: {
          code: true,
          guest: { select: { fullName: true } },
        },
      },
    },
  });

  // Si por una inconsistencia aparecen ambos, IN_HOUSE es el huésped vigente.
  const stay =
    stays.find((item) => item.status === RoomStayStatus.IN_HOUSE) ??
    stays.find((item) => item.status === RoomStayStatus.CHECK_OUT) ??
    null;

  if (!stay?.reservationRefId || !stay.reservationRef) return null;

  return {
    reservationReferenceId: stay.reservationRefId,
    reservationCode: stay.reservationRef.code || stay.reservationId,
    roomNumber,
    guestName: stay.reservationRef.guest?.fullName || stay.guestNames[0] || 'Huésped',
  };
}

/** Validación de servidor: la UI no puede saltarse esta regla. */
export async function assertGymPassEligibleReservation(
  reservationReferenceId: string,
): Promise<void> {
  const eligibleStay = await prisma.roomStay.findFirst({
    where: {
      deletedAt: null,
      reservationRefId: reservationReferenceId,
      status: { in: ELIGIBLE_GUEST_STATUSES },
      stage: { in: ACTIVE_GUEST_STAGES },
    },
    select: { id: true },
  });

  if (!eligibleStay) {
    throw new RuleError(
      'El pase de gimnasio sólo se puede vender a huéspedes IN_HOUSE o CHECK_OUT cuya salida todavía no haya sido confirmada.',
    );
  }
}
