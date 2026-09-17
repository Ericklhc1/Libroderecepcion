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

type StayIdentityRow = {
  status: RoomStayStatus;
  guestNames: string[];
};

type GuestCandidate = {
  name: string;
  status: RoomStayStatus;
};

function derivedReservationStatus(statuses: RoomStayStatus[]): ReservationStatus {
  /*
    Una reserva multihabitación puede tener una habitación saliendo mientras
    otra sigue alojada. Mientras exista al menos una IN_HOUSE, la reserva sigue
    en casa; luego se prioriza una entrada pendiente y finalmente la salida.
  */
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

function normalizedName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function nameScore(value: string | null | undefined): number {
  const name = (value ?? '').trim();
  if (!name) return 0;
  const tokens = name.split(/\s+/).filter(Boolean).length;
  const letters = (name.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? []).length;
  return tokens * 20 + letters;
}

function nameExistsInStatus(
  stays: StayIdentityRow[],
  status: RoomStayStatus,
  name: string,
): boolean {
  const normalized = normalizedName(name);
  return stays.some(
    (stay) =>
      stay.status === status &&
      stay.guestNames.some((value) => normalizedName(value) === normalized),
  );
}

/**
 * Entradas puede traer «Cliente» (que incluso puede ser empresa/agencia) y
 * Salidas suele traer Nombre + Apellidos ya identificados durante la estadía.
 * El ID de reserva manda siempre; el nombre sólo enriquece la ficha.
 *
 * Si el huésped actual coincide con el dato de CHECK_IN y posteriormente el
 * MISMO ID trae otro nombre en CHECK_OUT, la salida gana aunque el texto no sea
 * más largo: es una fuente más rica, no una nueva identidad. Fuera de ese caso
 * sólo sustituimos por un nombre claramente más informativo para no pisar una
 * corrección manual con datos peores del PMS.
 */
function shouldUpgradeGuestName(
  current: string,
  candidate: GuestCandidate | null,
  stays: StayIdentityRow[],
): boolean {
  if (!candidate?.name.trim()) return false;
  if (normalizedName(current) === normalizedName(candidate.name)) return false;

  if (
    candidate.status === RoomStayStatus.CHECK_OUT &&
    nameExistsInStatus(stays, RoomStayStatus.CHECK_IN, current)
  ) {
    return true;
  }

  if (
    candidate.status === RoomStayStatus.IN_HOUSE &&
    nameExistsInStatus(stays, RoomStayStatus.CHECK_IN, current)
  ) {
    return true;
  }

  return nameScore(candidate.name) >= nameScore(current) + 8;
}

function primaryGuestCandidate(stays: StayIdentityRow[]): GuestCandidate | null {
  const statusPriority: RoomStayStatus[] = [
    RoomStayStatus.CHECK_OUT,
    RoomStayStatus.IN_HOUSE,
    RoomStayStatus.CHECK_IN,
  ];

  for (const status of statusPriority) {
    const candidate = stays.find(
      (stay) => stay.status === status && stay.guestNames.some((name) => name.trim()),
    );
    const name = candidate?.guestNames.find((value) => value.trim())?.trim();
    if (name) return { name, status };
  }

  for (const stay of stays) {
    const name = stay.guestNames.find((value) => value.trim())?.trim();
    if (name) return { name, status: stay.status };
  }
  return null;
}

/**
 * Convierte las estadías normalizadas del PMS en el núcleo interno del hotel:
 * Huésped -> Reserva -> Estadía.
 *
 * REGLA DE IDENTIDAD:
 *   1. código/ID exacto de reserva = identidad de la reserva;
 *   2. ID + habitación = ocupación física concreta;
 *   3. nombre = dato descriptivo/enriquecible, nunca clave.
 *
 * Los campos que el PMS conoce objetivamente (estado, fechas y habitación)
 * vuelven a sincronizarse en cada carga. Antes sólo se rellenaban huecos y una
 * reserva podía quedarse EN_CASA después de que el informe ya dijera SALIDA.
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
      createdAt: true,
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
      guest: { select: { id: true, fullName: true } },
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
    const primaryGuest = primaryGuestCandidate(reservationStays);
    const primaryName = primaryGuest?.name ?? null;
    const rooms = [
      ...new Set(
        reservationStays
          .map((stay) => stay.room?.number)
          .filter((room): room is string => Boolean(room)),
      ),
    ];
    // Una reserva multihabitación no tiene una habitación única a nivel reserva.
    const roomNumber = rooms.length === 1 ? rooms[0] : null;
    const checkIn = firstDate(reservationStays.map((stay) => stay.arrivalDate));
    const checkOut = lastDate(reservationStays.map((stay) => stay.departureDate));
    const channel = reservationStays.find((stay) => stay.channel?.trim())?.channel?.trim() ?? null;
    const status = derivedReservationStatus(reservationStays.map((stay) => stay.status));

    let reservation = reservationByCode.get(code) ?? null;

    if (!reservation) {
      const guest = primaryName
        ? await db.guestReference.create({
            data: { fullName: primaryName, roomNumber },
            select: { id: true, fullName: true },
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
          guest: { select: { id: true, fullName: true } },
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
      } else if (
        reservation.guest &&
        shouldUpgradeGuestName(reservation.guest.fullName, primaryGuest, reservationStays)
      ) {
        await db.guestReference.update({
          where: { id: reservation.guest.id },
          data: { fullName: primaryName!, roomNumber },
        });
      }

      const data: Prisma.ReservationReferenceUpdateInput = {
        // PMS es fuente de verdad para estos campos; `null` también informa que
        // una reserva es multihabitación o que el dato ya no aplica.
        roomNumber,
        checkIn,
        checkOut,
        status,
        ...(channel ? { channel } : {}),
      };
      if (!reservation.guestId && guestId) data.guest = { connect: { id: guestId } };

      await db.reservationReference.update({ where: { id: reservation.id }, data });
      result.reservationsUpdated += 1;
    }

    /*
      El vínculo también se corrige, no sólo se completa. Si una estadía quedó
      enlazada a una referencia incorrecta en una versión antigua, el ID exacto
      de reserva la vuelve a llevar a la referencia canónica.
    */
    const linked = await db.roomStay.updateMany({
      where: {
        id: { in: reservationStays.map((stay) => stay.id) },
        OR: [
          { reservationRefId: null },
          { reservationRefId: { not: reservation.id } },
        ],
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
