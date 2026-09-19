import 'server-only';

import { RoomStayStage, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';

type Db = Prisma.TransactionClient | typeof prisma;
const ACTIVE_STAGES = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

export type OperationalContextInput = {
  stayId?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  reservationReferenceId?: string | null;
  reservationCode?: string | null;
  guestId?: string | null;
};

export type OperationalContext = {
  stayId: string | null;
  roomId: string | null;
  roomNumber: string | null;
  reservationReferenceId: string | null;
  reservationCode: string | null;
  guestId: string | null;
  guestName: string | null;
  ambiguousStayIds: string[];
  issues: string[];
};

const stayInclude = {
  room: { select: { id: true, number: true } },
  reservationRef: {
    select: {
      id: true,
      code: true,
      guestId: true,
      guest: { select: { id: true, fullName: true } },
    },
  },
} satisfies Prisma.RoomStayInclude;

type StayContext = Prisma.RoomStayGetPayload<{ include: typeof stayInclude }>;

function fromStay(stay: StayContext): OperationalContext {
  return {
    stayId: stay.id,
    roomId: stay.room?.id ?? null,
    roomNumber: stay.room?.number ?? null,
    reservationReferenceId: stay.reservationRef?.id ?? null,
    reservationCode: stay.reservationRef?.code ?? stay.reservationId,
    guestId: stay.reservationRef?.guestId ?? null,
    guestName: stay.reservationRef?.guest?.fullName ?? stay.guestNames[0] ?? null,
    ambiguousStayIds: [],
    issues: [],
  };
}

function mismatch(label: string): never {
  throw new RuleError(`El contexto seleccionado no coincide con ${label}. Revisa la estadía antes de continuar.`);
}

export async function resolveOperationalContext(
  client: Db,
  input: OperationalContextInput,
): Promise<OperationalContext> {
  const stayId = input.stayId?.trim() || null;
  const roomId = input.roomId?.trim() || null;
  const roomNumber = input.roomNumber?.trim() || null;
  const reservationReferenceId = input.reservationReferenceId?.trim() || null;
  const reservationCode = input.reservationCode?.trim() || null;
  const guestId = input.guestId?.trim() || null;

  if (stayId) {
    const stay = await client.roomStay.findFirst({
      where: { id: stayId, deletedAt: null },
      include: stayInclude,
    });
    if (!stay) throw new NotFoundError('La estadía seleccionada no existe.');
    const context = fromStay(stay);
    if (roomId && context.roomId !== roomId) mismatch('la habitación indicada');
    if (roomNumber && context.roomNumber !== roomNumber) mismatch('la habitación indicada');
    if (reservationReferenceId && context.reservationReferenceId !== reservationReferenceId) mismatch('la reserva indicada');
    if (reservationCode && context.reservationCode !== reservationCode) mismatch('la reserva indicada');
    if (guestId && context.guestId && context.guestId !== guestId) mismatch('el huésped indicado');
    return { ...context, guestId: context.guestId ?? guestId };
  }

  const [room, reservation, guest] = await Promise.all([
    roomId || roomNumber
      ? client.room.findFirst({
          where: {
            ...(roomId ? { id: roomId } : {}),
            ...(roomNumber ? { number: roomNumber } : {}),
            active: true,
          },
          select: { id: true, number: true },
        })
      : Promise.resolve(null),
    reservationReferenceId || reservationCode
      ? client.reservationReference.findFirst({
          where: {
            ...(reservationReferenceId ? { id: reservationReferenceId } : {}),
            ...(reservationCode ? { code: reservationCode } : {}),
            deletedAt: null,
          },
          select: {
            id: true,
            code: true,
            guestId: true,
            guest: { select: { id: true, fullName: true } },
          },
        })
      : Promise.resolve(null),
    guestId
      ? client.guestReference.findFirst({
          where: { id: guestId, deletedAt: null },
          select: { id: true, fullName: true },
        })
      : Promise.resolve(null),
  ]);

  if ((roomId || roomNumber) && !room) throw new NotFoundError('La habitación seleccionada no existe.');
  if ((reservationReferenceId || reservationCode) && !reservation) throw new NotFoundError('La reserva seleccionada no existe.');
  if (guestId && !guest) throw new NotFoundError('El huésped seleccionado no existe.');
  if (reservation?.guestId && guestId && reservation.guestId !== guestId) mismatch('el huésped de la reserva');

  const base: OperationalContext = {
    stayId: null,
    roomId: room?.id ?? null,
    roomNumber: room?.number ?? null,
    reservationReferenceId: reservation?.id ?? null,
    reservationCode: reservation?.code ?? null,
    guestId: reservation?.guestId ?? guest?.id ?? null,
    guestName: reservation?.guest?.fullName ?? guest?.fullName ?? null,
    ambiguousStayIds: [],
    issues: [],
  };

  if (!room && !reservation) return base;

  const candidates = await client.roomStay.findMany({
    where: {
      deletedAt: null,
      stage: { in: ACTIVE_STAGES },
      ...(room ? { roomId: room.id } : {}),
      ...(reservation ? { reservationRefId: reservation.id } : {}),
    },
    include: stayInclude,
    orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
  });

  if (candidates.length === 0) return base;
  if (candidates.length === 1) {
    const resolved = fromStay(candidates[0]!);
    if (guestId && resolved.guestId && resolved.guestId !== guestId) mismatch('el huésped indicado');
    return {
      ...resolved,
      guestId: resolved.guestId ?? base.guestId,
      guestName: resolved.guestName ?? base.guestName,
    };
  }

  return {
    ...base,
    ambiguousStayIds: candidates.map((candidate) => candidate.id),
    issues: [
      'El contexto corresponde a varias estadías activas. Selecciona la estadía exacta; el sistema no mezclará huéspedes salientes y entrantes.',
    ],
  };
}

export function assertUnambiguousStay(
  context: OperationalContext,
  message = 'Selecciona la estadía exacta antes de continuar.',
): asserts context is OperationalContext & { stayId: string } {
  if (context.ambiguousStayIds.length > 0) throw new RuleError(message);
}
