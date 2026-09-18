import 'server-only';

import { ReservationStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const ACTIVE_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

export type ReservationFolderPhase = {
  stayId: string;
  status: string;
  stage: string;
  arrivalDate: Date | null;
  departureDate: Date | null;
};

export type ReservationFolderId = {
  reservationRefId: string | null;
  fnsId: string;
  guestName: string | null;
  /** Estado visible de la carpeta ID. Las fases originales se conservan abajo. */
  status: string;
  phases: ReservationFolderPhase[];
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
  reservations: ReservationFolderId[];
};

function visibleStatus(statuses: RoomStayStatus[]): RoomStayStatus {
  /*
    Una misma reserva puede aparecer simultáneamente en IN_HOUSE y CHECK_OUT
    porque el PMS describe hechos, no una única etiqueta mutable. Para la
    carpeta operativa manda lo que recepción tiene que resolver a continuación:
    salida > in house > entrada.
  */
  if (statuses.includes(RoomStayStatus.CHECK_OUT)) return RoomStayStatus.CHECK_OUT;
  if (statuses.includes(RoomStayStatus.IN_HOUSE)) return RoomStayStatus.IN_HOUSE;
  return RoomStayStatus.CHECK_IN;
}

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
          orderBy: [{ createdAt: 'asc' }],
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
    rooms: rooms.map((room) => {
      const byFns = new Map<string, typeof room.stays>();
      for (const stay of room.stays) {
        const fnsId = stay.reservationRef?.code ?? stay.reservationId;
        const list = byFns.get(fnsId) ?? [];
        list.push(stay);
        byFns.set(fnsId, list);
      }

      return {
        roomId: room.id,
        roomNumber: room.number,
        floor: room.floor,
        reservations: [...byFns.entries()].map(([fnsId, stays]) => {
          const first = stays[0]!;
          const reservationRef = stays.find((stay) => stay.reservationRef)?.reservationRef ?? null;
          return {
            reservationRefId: reservationRef?.id ?? first.reservationRefId,
            fnsId,
            guestName:
              reservationRef?.guest?.fullName ??
              stays.flatMap((stay) => stay.guestNames).find((name) => name.trim()) ??
              null,
            status: visibleStatus(stays.map((stay) => stay.status)),
            phases: stays.map((stay) => ({
              stayId: stay.id,
              status: stay.status,
              stage: stay.stage,
              arrivalDate: stay.arrivalDate,
              departureDate: stay.departureDate,
            })),
            records: {
              entries: reservationRef?._count.entries ?? 0,
              guarantees: reservationRef?._count.guarantees ?? 0,
              cashMovements: reservationRef?._count.cashMovements ?? 0,
              fines: reservationRef?._count.fines ?? 0,
            },
          };
        }),
      };
    }),
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
