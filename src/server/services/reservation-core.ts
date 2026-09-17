import 'server-only';
import { ReservationStatus, RoomStayStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

type SyncScope = {
  businessDate?: Date;
};

export type ReservationCoreSyncResult = {
  reservationsCreated: number;
  reservationsUpdated: number;
  guestsCreated: number;
  staysLinked: number;
};

function derivedReservationStatus(statuses: RoomStayStatus[]): ReservationStatus {
  if (statuses.includes(RoomStayStatus.IN_HOUSE)) return ReservationStatus.EN_CASA;
  if (statuses.includes(RoomStayStatus.CHECK_IN)) return ReservationStatus.CONFIRMADA;
  if (statuses.includes(RoomStayStatus.CHECK_OUT)) return ReservationStatus.SALIDA;
  return ReservationStatus.PENDIENTE;
}

function firstDate(dates: Array<Date | null>): Date | null {
  const values = dates.filter((date): date is Date => date !== null);
  return values.length ? new Date(Math.min(...values.map((date) => date.getTime()))) : null;
}

function lastDate(dates: Array<Date | null>): Date | null {
  const values = dates.filter((date): date is Date => date !== null);
  return values.length ? new Date(Math.max(...values.map((date) => date.getTime()))) : null;
}

/**
 * Convierte las estadías normalizadas del PMS en el núcleo interno del hotel:
 * Huésped -> Reserva -> Estadía.
 *
 * La reserva se identifica SIEMPRE por el código que entrega el PMS. El nombre
 * nunca se usa como clave de identidad. Para una reserva nueva se crea una
 * ficha de huésped propia; para una reserva ya existente se conserva cualquier
 * dato que una persona haya completado y sólo se rellenan huecos.
 *
 * Esto hace que Garantías, Caja, Multas, Libro, Llaves y Habitaciones puedan
 * consumir la misma reserva en vez de copiar nombre/código por separado.
 */
export async function syncReservationCoreFromPms(
  db: Db = prisma,
  scope: SyncScope = {},
): Promise<ReservationCoreSyncResult> {
  const stays = await db.roomStay.findMany({
    where: {
      deletedAt: null,
      ...(scope.businessDate ? { businessDate: scope.businessDate } : {}),
    },
    select: {
      id: true,
      reservationId: true,
      reservationRefId: true,
      guestNames: true,
      room: { select: { number: true } },
      arrivalDate: true,
      departureDate: true,
      channel: true,
      status: true,
    },
  });

  const byCode = new Map<string, typeof stays>();
  for (const stay of stays) {
    const list = byCode.get(stay.reservationId) ?? [];
    list.push(stay);
    byCode.set(stay.reservationId, list);
  }

  if (byCode.size === 0) {
    return { reservationsCreated: 0, reservationsUpdated: 0, guestsCreated: 0, staysLinked: 0 };
  }

  const codes = [...byCode.keys()];
  const existing = await db.reservationReference.findMany({
    where: { code: { in: codes }, deletedAt: null },
    select: {
      id: true,
      code: true,
      guestId: true,
      roomNumber: true,
      checkIn: true,
      checkOut: true,
      channel: true,
      status: true,
    },
  });
  const reservationByCode = new Map(existing.map((reservation) => [reservation.code, reservation]));

  const result: ReservationCoreSyncResult = {
    reservationsCreated: 0,
    reservationsUpdated: 0,
    guestsCreated: 0,
    staysLinked: 0,
  };

  for (const [code, reservationStays] of byCode) {
    const primaryName = reservationStays.find((stay) => stay.guestNames[0]?.trim())?.guestNames[0]?.trim() ?? null;
    const rooms = [...new Set(reservationStays.map((stay) => stay.room?.number).filter((room): room is string => Boolean(room)))];
    const roomNumber = rooms.length === 1 ? rooms[0] : null;
    const checkIn = firstDate(reservationStays.map((stay) => stay.arrivalDate));
    const checkOut = lastDate(reservationStays.map((stay) => stay.departureDate));
    const channel = reservationStays.find((stay) => stay.channel?.trim())?.channel ?? null;
    const status = derivedReservationStatus(reservationStays.map((stay) => stay.status));

    let reservation = reservationByCode.get(code) ?? null;

    if (!reservation) {
      const guest = primaryName
        ? await db.guestReference.create({
            data: { fullName: primaryName, roomNumber },
            select: { id: true },
          })
        : null;
      if (guest) result.guestsCreated += 1;

      reservation = await db.reservationReference.create({
        data: {
          code,
          guestId: guest?.id ?? null,
          roomNumber,
          checkIn,
          checkOut,
          channel,
          status,
        },
        select: {
          id: true,
          code: true,
          guestId: true,
          roomNumber: true,
          checkIn: true,
          checkOut: true,
          channel: true,
          status: true,
        },
      });
      reservationByCode.set(code, reservation);
      result.reservationsCreated += 1;
    } else {
      let guestId = reservation.guestId;
      if (!guestId && primaryName) {
        const guest = await db.guestReference.create({
          data: { fullName: primaryName, roomNumber },
          select: { id: true },
        });
        guestId = guest.id;
        result.guestsCreated += 1;
      }

      const data: Prisma.ReservationReferenceUpdateInput = {};
      if (!reservation.guestId && guestId) data.guest = { connect: { id: guestId } };
      if (!reservation.roomNumber && roomNumber) data.roomNumber = roomNumber;
      if (!reservation.checkIn && checkIn) data.checkIn = checkIn;
      if (!reservation.checkOut && checkOut) data.checkOut = checkOut;
      if (!reservation.channel && channel) data.channel = channel;
      if (reservation.status === ReservationStatus.PENDIENTE && status !== ReservationStatus.PENDIENTE) {
        data.status = status;
      }

      if (Object.keys(data).length > 0) {
        await db.reservationReference.update({ where: { id: reservation.id }, data });
        result.reservationsUpdated += 1;
      }
    }

    const linked = await db.roomStay.updateMany({
      where: {
        id: { in: reservationStays.map((stay) => stay.id) },
        reservationRefId: null,
      },
      data: { reservationRefId: reservation.id },
    });
    result.staysLinked += linked.count;
  }

  return result;
}

export async function getReservationProfile(id: string) {
  return prisma.reservationReference.findFirst({
    where: { id, deletedAt: null },
    include: {
      guest: true,
      guarantees: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { name: true } },
          returnedBy: { select: { name: true } },
        },
      },
      stays: {
        where: { deletedAt: null },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        include: { room: { select: { number: true } } },
      },
      fines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { room: { select: { number: true } }, createdBy: { select: { name: true } } },
      },
      cashMovements: {
        where: { voidedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true } } },
      },
      entries: {
        where: { deletedAt: null },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      },
    },
  });
}
