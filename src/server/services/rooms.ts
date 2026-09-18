import 'server-only';
import { AuditAction, KeyStatus, RoomStayStage, RoomStayStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  buildRoomSnapshot,
  mostAdvancedStayStatus,
  stayPhase,
  type KeyFacts,
  type RoomSnapshot,
  type StayFacts,
  type StayStatus,
} from '@/domain/rooms';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import {
  assignMainKey,
  markKeysPendingReturn,
  reconcilePrincipalKeys,
} from './keys';

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
  history: StayFacts[];
  keys: Array<KeyFacts & { assignedAt: Date | null; assignedBy: string | null }>;
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

type CheckOutTransactionResult = {
  stay: {
    id: string;
    reservationId: string;
    guestNames: string[];
  };
  roomNumber: string | null;
  pendingKeys: number;
};

async function confirmCheckOutInTransaction(
  tx: Prisma.TransactionClient,
  user: CurrentUser,
  input: { stayId: string; note?: string | null },
): Promise<CheckOutTransactionResult> {
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

  const now = new Date();
  const updated = await tx.roomStay.updateMany({
    where: { id: stay.id, stage: { not: RoomStayStage.FINALIZADO } },
    data: {
      stage: RoomStayStage.FINALIZADO,
      confirmedAt: now,
      confirmedById: user.id,
      touchedManually: true,
      note: input.note ?? stay.note,
    },
  });
  if (updated.count === 0) throw new RuleError('Esa salida ya fue confirmada.');

  /*
    Salir de la habitación y devolver una llave son dos hechos distintos.
    El C/O libera la habitación; cualquier llave que siga en manos del
    huésped queda pendiente y sólo vuelve al inventario cuando recepción la
    recibe con `returnKey`.
  */
  const stayIds = new Set<string>([stay.id]);
  if (stay.roomId) {
    const inHouseStays = await tx.roomStay.findMany({
      where: {
        roomId: stay.roomId,
        reservationId: stay.reservationId,
        deletedAt: null,
        status: RoomStayStatus.IN_HOUSE,
        stage: { not: RoomStayStage.FINALIZADO },
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
      },
      select: { id: true },
    });
    for (const sibling of inHouseStays) stayIds.add(sibling.id);

    await tx.roomStay.updateMany({
      where: { id: { in: inHouseStays.map((sibling) => sibling.id) } },
      data: {
        stage: RoomStayStage.FINALIZADO,
        confirmedAt: now,
        confirmedById: user.id,
      },
    });
  }

  for (const stayId of stayIds) {
    await markKeysPendingReturn(tx, user, stayId);
  }

  const pendingKeys = await tx.roomKey.count({
    where: {
      stayId: { in: [...stayIds] },
      status: KeyStatus.PENDIENTE_DEVOLUCION,
    },
  });

  return {
    stay: {
      id: stay.id,
      reservationId: stay.reservationId,
      guestNames: stay.guestNames,
    },
    roomNumber: stay.room?.number ?? null,
    pendingKeys,
  };
}

async function auditConfirmedCheckOut(
  user: CurrentUser,
  result: CheckOutTransactionResult,
): Promise<void> {
  await recordAudit({
    entity: 'RoomStay',
    entityId: result.stay.id,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `Salida confirmada en habitación ${result.roomNumber ?? 'sin número'}: ` +
      `${result.stay.guestNames[0] ?? 'sin nombre'} (reserva ${result.stay.reservationId})` +
      (result.pendingKeys > 0 ? ` · ${result.pendingKeys} llave(s) por recibir` : ''),
    after: { stage: RoomStayStage.FINALIZADO, pendingKeys: result.pendingKeys },
  });
}

export async function confirmCheckOut(
  user: CurrentUser,
  input: { stayId: string; note?: string | null },
): Promise<{ roomNumber: string | null; pendingKeys: number }> {
  const result = await prisma.$transaction((tx) =>
    confirmCheckOutInTransaction(tx, user, input),
  );

  await auditConfirmedCheckOut(user, result);
  return { roomNumber: result.roomNumber, pendingKeys: result.pendingKeys };
}

/**
 * Confirma un lote de salidas como una sola operación.
 *
 * Es la ruta canónica para consumidores que ejecutan más de un check-out
 * (incluida la IA). Si una sola estadía deja de ser válida mientras se ejecuta
 * el lote, PostgreSQL revierte TODAS las salidas del lote.
 */
export async function confirmCheckOutBatch(
  user: CurrentUser,
  input: { items: Array<{ stayId: string; note?: string | null }> },
): Promise<Array<{ roomNumber: string | null; pendingKeys: number }>> {
  if (input.items.length === 0) throw new RuleError('El lote de check-out está vacío.');

  const ids = input.items.map((item) => item.stayId);
  if (new Set(ids).size !== ids.length) {
    throw new RuleError('El lote contiene la misma salida más de una vez.');
  }

  const results = await prisma.$transaction(async (tx) => {
    const completed: CheckOutTransactionResult[] = [];
    for (const item of input.items) {
      completed.push(await confirmCheckOutInTransaction(tx, user, item));
    }
    return completed;
  });

  for (const result of results) {
    await auditConfirmedCheckOut(user, result);
  }

  return results.map((result) => ({
    roomNumber: result.roomNumber,
    pendingKeys: result.pendingKeys,
  }));
}

/**
 * Confirma el check-in de una reserva entrante.
 *
 * Si el PMS ya dejó una fila IN_HOUSE para la misma reserva y el mismo día,
 * no intentamos convertir la fila CHECK_IN en una segunda IN_HOUSE: la
 * restricción única de la base lo rechazaría (P2002) y, más importante, serían
 * dos representaciones del mismo huésped. En ese caso se reutiliza la fila
 * IN_HOUSE como canónica y la entrada queda finalizada como evidencia histórica.
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

    const now = new Date();
    const existingInHouse = await tx.roomStay.findFirst({
      where: {
        businessDate: stay.businessDate,
        reservationId: stay.reservationId,
        roomId: stay.room.id,
        status: RoomStayStatus.IN_HOUSE,
        id: { not: stay.id },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existingInHouse) {
      /*
        `deletedAt` también cuenta para el índice único, así que una fila vieja
        eliminada puede producir P2002. La reactivamos y la dejamos como la
        única IN_HOUSE; la fila CHECK_IN no se borra, queda finalizada.
      */
      await tx.roomStay.update({
        where: { id: existingInHouse.id },
        data: {
          deletedAt: null,
          deletedById: null,
          deletionReason: null,
          stage: RoomStayStage.CONFIRMADO,
          confirmedAt: now,
          confirmedById: user.id,
          touchedManually: true,
          note: input.note ?? existingInHouse.note,
        },
      });
      await tx.roomStay.update({
        where: { id: stay.id },
        data: {
          stage: RoomStayStage.FINALIZADO,
          confirmedAt: now,
          confirmedById: user.id,
          touchedManually: true,
          note:
            input.note ??
            `Consolidado con la estadía in house ${existingInHouse.id}; no se duplicó la reserva.`,
        },
      });

      const key = await assignMainKey(tx, user, {
        roomId: stay.room.id,
        stayId: existingInHouse.id,
        keyId: input.keyId ?? null,
      });

      return {
        stay,
        roomNumber: stay.room.number,
        keyCode: key?.code ?? null,
        canonicalStayId: existingInHouse.id,
        consolidated: true,
      };
    }

    const updated = await tx.roomStay.updateMany({
      where: { id: stay.id, stage: RoomStayStage.PENDIENTE },
      data: {
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        confirmedAt: now,
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

    return {
      stay,
      roomNumber: stay.room.number,
      keyCode: key?.code ?? null,
      canonicalStayId: stay.id,
      consolidated: false,
    };
  });

  await recordAudit({
    entity: 'RoomStay',
    entityId: result.canonicalStayId,
    action: AuditAction.CAMBIO_ESTADO,
    user,
    summary:
      `${result.consolidated ? 'Check-in consolidado' : 'Check-in confirmado'} en habitación ${result.roomNumber}: ` +
      `${result.stay.guestNames[0] ?? 'sin nombre'} (reserva ${result.stay.reservationId})` +
      (result.keyCode ? `, llave ${result.keyCode}` : ', sin llave disponible'),
    after: {
      status: RoomStayStatus.IN_HOUSE,
      stage: RoomStayStage.CONFIRMADO,
      consolidated: result.consolidated,
    },
  });

  return { roomNumber: result.roomNumber, keyCode: result.keyCode };
}

export async function flagDepartureKeys(
  user: CurrentUser,
  stayId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await markKeysPendingReturn(tx, user, stayId);
  });
}

export async function countRoomStates(): Promise<Record<string, number>> {
  const rooms = await listRoomsWithState();
  const counts: Record<string, number> = {};
  for (const room of rooms) {
    counts[room.snapshot.state] = (counts[room.snapshot.state] ?? 0) + 1;
  }
  return counts;
}

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

export async function resetRoom(
  user: CurrentUser,
  input: { roomNumber: string; reason: string },
) {
  const result = await prisma.$transaction(
    async (tx) => {
      const room = await tx.room.findUnique({
        where: { number: input.roomNumber },
        select: { id: true, number: true },
      });
      if (!room) throw new NotFoundError('Esa habitación no existe en el inventario.');

      const stays = await tx.roomStay.findMany({
        where: { roomId: room.id, deletedAt: null, stage: { in: ACTIVE_STAGES } },
        select: {
          id: true,
          reservationId: true,
          status: true,
          stage: true,
          touchedManually: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const keep = new Map<string, (typeof stays)[number]>();
      for (const stay of stays) {
        const key = `${stay.reservationId}|${stayPhase(stay.status as StayStatus)}`;
        const previous = keep.get(key);
        if (!previous) {
          keep.set(key, stay);
          continue;
        }
        const winner =
          mostAdvancedStayStatus(
            previous.status as StayStatus,
            stay.status as StayStatus,
          ) === (stay.status as StayStatus) && previous.status !== stay.status
            ? stay
            : previous;
        keep.set(key, winner);
      }

      const keptIds = new Set([...keep.values()].map((stay) => stay.id));
      const redundant = stays.filter((stay) => !keptIds.has(stay.id));

      if (redundant.length > 0) {
        await tx.roomStay.updateMany({
          where: { id: { in: redundant.map((stay) => stay.id) } },
          data: {
            deletedAt: new Date(),
            deletedById: user.id,
            deletionReason: `Reseteo de la habitación ${room.number}: ${input.reason}`,
          },
        });
      }

      const orphaned = await tx.roomKey.updateMany({
        where: {
          roomId: room.id,
          stayId: { not: null },
          OR: [
            { stay: { deletedAt: { not: null } } },
            { stay: { stage: { notIn: ACTIVE_STAGES } } },
          ],
        },
        data: { stayId: null, status: KeyStatus.DISPONIBLE },
      });

      const reassigned = await reconcilePrincipalKeys(tx, user, {
        note: `reseteo de la habitación ${room.number}`,
      });

      return {
        room,
        collapsed: redundant.length,
        releasedKeys: orphaned.count,
        reassignedKeys: reassigned,
        remaining: keptIds.size,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recordAudit({
    entity: 'Room',
    entityId: result.room.id,
    action: AuditAction.CONFIGURAR,
    user,
    summary:
      `Habitación ${result.room.number} reseteada: ${result.collapsed} estadía(s) duplicada(s) ` +
      `eliminada(s), ${result.remaining} conservada(s), ${result.releasedKeys} llave(s) liberada(s), ` +
      `${result.reassignedKeys} reasignada(s). Motivo: ${input.reason}`,
  });

  return result;
}
