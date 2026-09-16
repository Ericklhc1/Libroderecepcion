import 'server-only';
import { AuditAction, KeyStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  buildRoomSnapshot,
  type KeyFacts,
  type RoomSnapshot,
  type StayFacts,
} from '@/domain/rooms';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { assignMainKey, releaseStayKeys, markKeysPendingReturn } from './keys';

/**
 * Estado operativo de habitaciones.
 *
 * Las confirmaciones de salida y de check-in son las dos únicas puertas por las
 * que una habitación cambia de manos, y las dos exigen que una persona las
 * apriete: el sistema nunca mueve a un huésped de una capa a otra por su cuenta.
 */

const ACTIVE_STAGES: RoomStayStage[] = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

const stayFactsSelect = {
  id: true,
  reservationId: true,
  guestNames: true,
  status: true,
  stage: true,
  arrivalDate: true,
  departureDate: true,
  channel: true,
} satisfies Prisma.RoomStaySelect;

const keyFactsSelect = {
  id: true,
  code: true,
  type: true,
  status: true,
  stayId: true,
} satisfies Prisma.RoomKeySelect;

export type RoomWithState = {
  id: string;
  number: string;
  floor: number | null;
  snapshot: RoomSnapshot;
  openIncidents: number;
};

function toStayFacts(stay: Prisma.RoomStayGetPayload<{ select: typeof stayFactsSelect }>): StayFacts {
  return {
    id: stay.id,
    reservationId: stay.reservationId,
    guestNames: stay.guestNames,
    status: stay.status,
    stage: stay.stage,
    arrivalDate: stay.arrivalDate,
    departureDate: stay.departureDate,
    channel: stay.channel,
  };
}

function toKeyFacts(key: Prisma.RoomKeyGetPayload<{ select: typeof keyFactsSelect }>): KeyFacts {
  return {
    id: key.id,
    code: key.code,
    type: key.type,
    status: key.status,
    stayId: key.stayId,
  };
}

/** Tablero completo: una ficha por habitación, con sus tres capas y sus llaves. */
export async function listRoomsWithState(): Promise<RoomWithState[]> {
  const rooms = await prisma.room.findMany({
    where: { active: true },
    orderBy: { number: 'asc' },
    select: {
      id: true,
      number: true,
      floor: true,
      stays: {
        where: { deletedAt: null, stage: { in: ACTIVE_STAGES } },
        select: stayFactsSelect,
      },
      keys: { select: keyFactsSelect },
      _count: {
        select: {
          entries: {
            where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
          },
        },
      },
    },
  });

  return rooms.map((room) => ({
    id: room.id,
    number: room.number,
    floor: room.floor,
    snapshot: buildRoomSnapshot(room.stays.map(toStayFacts), room.keys.map(toKeyFacts)),
    openIncidents: room._count.entries,
  }));
}

/**
 * Contexto interno de la reserva, cuando la estadía se pudo vincular.
 *
 * Es información del sistema, no del PMS: saldo, garantías y si la reserva
 * pide una acción. Va aparte del snapshot a propósito, porque el snapshot
 * describe el estado físico de la habitación y esto describe la cuenta.
 */
export type RoomReservationContext = {
  stayId: string;
  code: string;
  guestName: string | null;
  vip: boolean;
  status: string;
  guaranteeSummary: string;
  balanceDue: number | null;
  guarantees: Array<{
    id: string;
    state: string;
    kind: string;
    amount: string;
    currency: string;
    appliedAmount: string | null;
    penaltyAmount: string | null;
  }>;
};

export type RoomDetail = RoomWithState & {
  notes: string | null;
  /** Historial del día: incluye las estadías ya finalizadas. */
  history: StayFacts[];
  keys: Array<KeyFacts & { assignedAt: Date | null; assignedBy: string | null }>;
  /** Reservas internas de las estadías activas, si están vinculadas. */
  reservations: RoomReservationContext[];
};

export async function getRoomDetail(number: string): Promise<RoomDetail> {
  const room = await prisma.room.findUnique({
    where: { number },
    select: {
      id: true,
      number: true,
      floor: true,
      notes: true,
      stays: {
        where: { deletedAt: null },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          ...stayFactsSelect,
          // El contexto de la cuenta viaja con la estadía: no hay consulta
          // adicional. Nulo cuando la reserva no existe en el sistema.
          reservationRef: {
            select: {
              code: true,
              status: true,
              guaranteeStatus: true,
              balanceDue: true,
              guest: { select: { fullName: true, vip: true } },
              guarantees: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  state: true,
                  kind: true,
                  amount: true,
                  currency: true,
                  appliedAmount: true,
                  penaltyAmount: true,
                },
              },
            },
          },
        },
      },
      keys: {
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        select: {
          ...keyFactsSelect,
          assignedAt: true,
          assignedBy: { select: { name: true } },
        },
      },
      _count: {
        select: {
          entries: { where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } } },
        },
      },
    },
  });
  if (!room) throw new NotFoundError('Esa habitación no existe en el inventario.');

  const active = room.stays.filter((stay) => ACTIVE_STAGES.includes(stay.stage));
  const keys = room.keys.map((key) => ({
    ...toKeyFacts(key),
    assignedAt: key.assignedAt,
    assignedBy: key.assignedBy?.name ?? null,
  }));

  return {
    id: room.id,
    number: room.number,
    floor: room.floor,
    notes: room.notes,
    snapshot: buildRoomSnapshot(active.map(toStayFacts), keys),
    openIncidents: room._count.entries,
    history: room.stays.map(toStayFacts),
    keys,
    reservations: active
      .filter((stay) => stay.reservationRef !== null)
      .map((stay) => {
        const reserva = stay.reservationRef!;
        return {
          stayId: stay.id,
          code: reserva.code,
          guestName: reserva.guest?.fullName ?? null,
          vip: reserva.guest?.vip ?? false,
          status: reserva.status,
          guaranteeSummary: reserva.guaranteeStatus,
          balanceDue: reserva.balanceDue ? reserva.balanceDue.toNumber() : null,
          guarantees: reserva.guarantees.map((guarantee) => ({
            id: guarantee.id,
            state: guarantee.state,
            kind: guarantee.kind,
            amount: guarantee.amount.toString(),
            currency: guarantee.currency,
            appliedAmount: guarantee.appliedAmount?.toString() ?? null,
            penaltyAmount: guarantee.penaltyAmount?.toString() ?? null,
          })),
        };
      }),
  };
}

/**
 * Confirma la salida de un huésped.
 *
 * Es el gesto que libera la habitación: la estadía queda finalizada y las
 * llaves que tenía vuelven al inventario. Mientras esto no ocurra, la reserva
 * entrante sigue en cola, sin llave y sin habitación.
 */
export async function confirmCheckOut(
  user: CurrentUser,
  input: { stayId: string; note?: string | null },
): Promise<{ roomNumber: string | null }> {
  const result = await prisma.$transaction(async (tx) => {
    const stay = await tx.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      include: { room: { select: { id: true, number: true } } },
    });
    if (!stay) throw new NotFoundError('Esa estadía no existe o fue eliminada.');
    if (stay.status !== RoomStayStatus.CHECK_OUT) {
      throw new RuleError('Sólo se puede confirmar la salida de una estadía en check-out.');
    }
    if (stay.stage === RoomStayStage.FINALIZADO) {
      throw new RuleError('Esa salida ya fue confirmada.');
    }

    const updated = await tx.roomStay.updateMany({
      where: { id: stay.id, stage: { not: RoomStayStage.FINALIZADO } },
      data: {
        stage: RoomStayStage.FINALIZADO,
        confirmedAt: new Date(),
        confirmedById: user.id,
        touchedManually: true,
        note: input.note ?? stay.note,
      },
    });
    // Guarda de concurrencia: si dos personas confirman a la vez, sólo una
    // encuentra la estadía sin finalizar.
    if (updated.count === 0) throw new RuleError('Esa salida ya fue confirmada.');

    /*
      La estadía in house de la misma reserva se cierra junto con la salida. Si
      no se cerrara, la habitación seguiría mostrando a alguien dentro después
      de haberse ido, y la reserva entrante no podría pasar nunca.
    */
    let closedInHouse = 0;
    if (stay.roomId) {
      const siblings = await tx.roomStay.updateMany({
        where: {
          roomId: stay.roomId,
          reservationId: stay.reservationId,
          deletedAt: null,
          status: RoomStayStatus.IN_HOUSE,
          stage: { not: RoomStayStage.FINALIZADO },
        },
        data: {
          stage: RoomStayStage.FINALIZADO,
          confirmedAt: new Date(),
          confirmedById: user.id,
        },
      });
      closedInHouse = siblings.count;

      // Las llaves pueden estar asociadas a la estadía in house y no a la de
      // salida: se liberan todas las de la habitación que siga con esa reserva.
      const inHouseStays = await tx.roomStay.findMany({
        where: {
          roomId: stay.roomId,
          reservationId: stay.reservationId,
          status: RoomStayStatus.IN_HOUSE,
        },
        select: { id: true },
      });
      for (const sibling of inHouseStays) {
        await releaseStayKeys(tx, user, sibling.id, 'Salida confirmada');
      }
    }

    await releaseStayKeys(tx, user, stay.id, 'Salida confirmada');

    return { stay, roomNumber: stay.room?.number ?? null, closedInHouse };
  });

  await recordAudit({
    entity: 'RoomStay',
    entityId: result.stay.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `Salida confirmada en habitación ${result.roomNumber ?? 'sin número'}: ` +
      `${result.stay.guestNames[0] ?? 'sin nombre'} (reserva ${result.stay.reservationId})`,
    after: { stage: RoomStayStage.FINALIZADO },
  });

  return { roomNumber: result.roomNumber };
}

/**
 * Confirma el check-in de una reserva entrante.
 *
 * Recién aquí la reserva pasa a IN_HOUSE y recibe llave. Si la habitación
 * todavía tiene una salida sin confirmar, la operación se rechaza: es la regla
 * de cola, y vive en el servidor para que ninguna pantalla pueda saltarla.
 */
export async function confirmCheckIn(
  user: CurrentUser,
  input: { stayId: string; keyId?: string | null; note?: string | null },
): Promise<{ roomNumber: string; keyCode: string | null }> {
  const result = await prisma.$transaction(async (tx) => {
    const stay = await tx.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      include: { room: { select: { id: true, number: true } } },
    });
    if (!stay) throw new NotFoundError('Esa estadía no existe o fue eliminada.');
    if (stay.status !== RoomStayStatus.CHECK_IN) {
      throw new RuleError('Sólo se puede confirmar el check-in de una reserva entrante.');
    }
    if (stay.stage !== RoomStayStage.PENDIENTE) {
      throw new RuleError('Ese check-in ya fue confirmado.');
    }
    if (!stay.room) {
      throw new RuleError(
        'La reserva no tiene habitación asignada: corrige el informe antes de confirmar.',
      );
    }

    const blockers = await tx.roomStay.findMany({
      where: {
        roomId: stay.room.id,
        deletedAt: null,
        id: { not: stay.id },
        reservationId: { not: stay.reservationId },
        stage: { in: ACTIVE_STAGES },
        status: { in: [RoomStayStatus.CHECK_OUT, RoomStayStatus.IN_HOUSE] },
      },
      select: { status: true, guestNames: true, reservationId: true },
    });

    const blocker = blockers[0];
    if (blocker) {
      throw new RuleError(
        blocker.status === RoomStayStatus.CHECK_OUT
          ? `La habitación ${stay.room.number} tiene una salida sin confirmar ` +
            `(${blocker.guestNames[0] ?? 'sin nombre'}, reserva ${blocker.reservationId}). ` +
            'Confirma esa salida antes del check-in.'
          : `La habitación ${stay.room.number} sigue ocupada por ` +
            `${blocker.guestNames[0] ?? 'sin nombre'} (reserva ${blocker.reservationId}).`,
      );
    }

    const updated = await tx.roomStay.updateMany({
      where: { id: stay.id, stage: RoomStayStage.PENDIENTE },
      data: {
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        confirmedAt: new Date(),
        confirmedById: user.id,
        touchedManually: true,
        note: input.note ?? stay.note,
      },
    });
    if (updated.count === 0) throw new RuleError('Ese check-in ya fue confirmado.');

    const key = await assignMainKey(tx, user, {
      roomId: stay.room.id,
      stayId: stay.id,
      keyId: input.keyId ?? null,
    });

    return { stay, roomNumber: stay.room.number, keyCode: key?.code ?? null };
  });

  await recordAudit({
    entity: 'RoomStay',
    entityId: result.stay.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `Check-in confirmado en habitación ${result.roomNumber}: ` +
      `${result.stay.guestNames[0] ?? 'sin nombre'} (reserva ${result.stay.reservationId})` +
      (result.keyCode ? `, llave ${result.keyCode}` : ', sin llave disponible'),
    after: { status: RoomStayStatus.IN_HOUSE, stage: RoomStayStage.CONFIRMADO },
  });

  return { roomNumber: result.roomNumber, keyCode: result.keyCode };
}

/**
 * Marca las llaves de una habitación como pendientes de devolución.
 *
 * Se ejecuta al importar una salida: el huésped sigue teniendo la llave, pero
 * recepción ya sabe que tiene que recuperarla.
 */
export async function flagDepartureKeys(
  user: CurrentUser,
  stayId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await markKeysPendingReturn(tx, user, stayId);
  });
}

/** Recuento por estado para las fichas resumen del tablero. */
export async function countRoomStates(): Promise<Record<string, number>> {
  const rooms = await listRoomsWithState();
  const counts: Record<string, number> = {};
  for (const room of rooms) {
    counts[room.snapshot.state] = (counts[room.snapshot.state] ?? 0) + 1;
  }
  return counts;
}

/**
 * Elimina lógicamente una estadía, para desatascar un conflicto.
 *
 * Existe porque un estado histórico incoherente —una estadía duplicada, una
 * cargada antes de que una regla existiera— puede dejar una habitación
 * bloqueada, y la operación necesita una salida que no sea tocar la base a
 * mano. La reserva el **Administrador de sistema**: es la única acción sobre
 * estadías que le corresponde, porque no es operar el mesón sino reparar el
 * sistema, y no lo deja como responsable de ninguna llegada ni salida.
 *
 * Nada se borra de verdad: `deletedAt`, `deletedById` y un **motivo
 * obligatorio**, como el resto del sistema.
 *
 * La llave que tuviera asignada se libera en la misma transacción. Dejarla
 * apuntando a una estadía eliminada es exactamente el conflicto que esta
 * acción viene a resolver.
 */
export async function softDeleteStay(
  user: CurrentUser,
  input: { stayId: string; reason: string },
) {
  const result = await prisma.$transaction(async (tx) => {
    const stay = await tx.roomStay.findFirst({
      where: { id: input.stayId, deletedAt: null },
      select: {
        id: true,
        reservationId: true,
        status: true,
        stage: true,
        guestNames: true,
        room: { select: { id: true, number: true } },
      },
    });
    if (!stay) throw new NotFoundError('Esa estadía no existe o ya fue eliminada.');

    await tx.roomStay.update({
      where: { id: stay.id },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletionReason: input.reason,
      },
    });

    // La llave vuelve al inventario: una llave asignada a una estadía
    // eliminada es el conflicto que esto viene a resolver.
    const released = await tx.roomKey.updateMany({
      where: { stayId: stay.id },
      data: { stayId: null, status: KeyStatus.DISPONIBLE },
    });

    return { stay, releasedKeys: released.count };
  });

  await recordAudit({
    entity: 'RoomStay',
    entityId: result.stay.id,
    action: AuditAction.ELIMINAR,
    user,
    summary:
      `Estadía ${result.stay.reservationId} de la habitación ${result.stay.room?.number ?? 's/n'} ` +
      `eliminada (${result.releasedKeys} llave(s) liberada(s)): ${input.reason}`,
    before: { status: result.stay.status, stage: result.stay.stage },
  });

  return result;
}
