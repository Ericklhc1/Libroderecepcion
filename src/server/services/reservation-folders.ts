import 'server-only';

import { ReservationStatus, RoomStayStage } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const ACTIVE_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

export type ReservationFolderStay = {
  stayId: string;
  reservationRefId: string | null;
  fnsId: string;
  guestName: string | null;
  status: string;
  stage: string;
  arrivalDate: Date | null;
  departureDate: Date | null;
  records: {
    entries: number;
    guarantees: number;
    cashMovements: number;
    fines: number;
  };
};

export type ReservationRoomFolder = {
  roomId: string;
  roomNumber: string;
  floor: number | null;
  stays: ReservationFolderStay[];
};

export async function listReservationFolders(): Promise<{
  rooms: ReservationRoomFolder[];
  unassigned: Array<{
    reservationRefId: string;
    fnsId: string;
    guestName: string | null;
    status: string;
    checkIn: Date | null;
    checkOut: Date | null;
  }>;
}> {
  const [rooms, unassigned] = await Promise.all([
    prisma.room.findMany({
      where: { active: true },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        floor: true,
        stays: {
          where: {
            deletedAt: null,
            stage: { in: ACTIVE_STAGES },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            reservationId: true,
            reservationRefId: true,
            status: true,
            stage: true,
            arrivalDate: true,
            departureDate: true,
            guestNames: true,
            reservationRef: {
              select: {
                id: true,
                code: true,
                guest: { select: { fullName: true } },
                _count: {
                  select: {
                    entries: true,
                    guarantees: true,
                    cashMovements: true,
                    fines: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.reservationReference.findMany({
      where: {
        deletedAt: null,
        status: {
          in: [
            ReservationStatus.PENDIENTE,
            ReservationStatus.CONFIRMADA,
            ReservationStatus.EN_CASA,
          ],
        },
        stays: {
          none: {
            deletedAt: null,
            stage: { in: ACTIVE_STAGES },
            roomId: { not: null },
          },
        },
      },
      orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        code: true,
        status: true,
        checkIn: true,
        checkOut: true,
        guest: { select: { fullName: true } },
      },
    }),
  ]);

  return {
    rooms: rooms.map((room) => ({
      roomId: room.id,
      roomNumber: room.number,
      floor: room.floor,
      stays: room.stays.map((stay) => ({
        stayId: stay.id,
        reservationRefId: stay.reservationRefId,
        fnsId: stay.reservationRef?.code ?? stay.reservationId,
        guestName:
          stay.reservationRef?.guest?.fullName ??
          stay.guestNames.find((name) => name.trim()) ??
          null,
        status: stay.status,
        stage: stay.stage,
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
        records: {
          entries: stay.reservationRef?._count.entries ?? 0,
          guarantees: stay.reservationRef?._count.guarantees ?? 0,
          cashMovements: stay.reservationRef?._count.cashMovements ?? 0,
          fines: stay.reservationRef?._count.fines ?? 0,
        },
      })),
    })),
    unassigned: unassigned.map((reservation) => ({
      reservationRefId: reservation.id,
      fnsId: reservation.code,
      guestName: reservation.guest?.fullName ?? null,
      status: reservation.status,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
    })),
  };
}
