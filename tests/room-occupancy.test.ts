import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GuaranteeKind,
  GuaranteeState,
  PmsReportKind,
  ReservationStatus,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  attachReservationToRoom,
  moveStayToRoom,
} from '@/server/services/room-occupancy';
import { confirmCheckOut, getRoomDetail } from '@/server/services/rooms';

async function createReservation(code: string, guestName: string) {
  const guest = await prisma.guestReference.create({
    data: { fullName: guestName },
  });
  return prisma.reservationReference.create({
    data: {
      code,
      guestId: guest.id,
      status: ReservationStatus.CONFIRMADA,
      guaranteeStatus: 'PENDIENTE',
      checkIn: new Date('2026-09-17T00:00:00.000Z'),
      checkOut: new Date('2026-09-18T00:00:00.000Z'),
      channel: 'Booking',
      externalId: code,
      notes: 'Fixture manual',
    },
    include: { guest: true },
  });
}

describe('asignación manual y room move', () => {
  let receptionist: CurrentUser & { passwordPlain: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('añade una reserva a una habitación como ocupada sin inventar otra identidad', async () => {
    const reservation = await createReservation('9001001', 'Huésped Manual');
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '421' } });

    await attachReservationToRoom(receptionist, {
      roomId: room.id,
      reservationRefId: reservation.id,
      status: RoomStayStatus.IN_HOUSE,
    });

    const detail = await getRoomDetail('421');
    expect(detail.snapshot.state).toBe('OCUPADA');
    expect(detail.snapshot.current?.reservationId).toBe('9001001');
    expect(detail.snapshot.current?.guestNames[0]).toBe('Huésped Manual');

    const ref = await prisma.reservationReference.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(ref.roomNumber).toBe('421');
    expect(ref.status).toBe(ReservationStatus.EN_CASA);
  });

  it('room move cierra el segmento anterior, abre el nuevo y conserva la garantía', async () => {
    const reservation = await createReservation('9001002', 'Huésped Move');
    const source = await prisma.room.findUniqueOrThrow({ where: { number: '421' } });
    const target = await prisma.room.findUniqueOrThrow({ where: { number: '422' } });

    await prisma.guarantee.create({
      data: {
        reservationReferenceId: reservation.id,
        kind: GuaranteeKind.TARJETA,
        state: GuaranteeState.VIGENTE,
        amount: 100000,
        currency: 'CLP',
        createdById: receptionist.id,
      },
    });

    const attached = await attachReservationToRoom(receptionist, {
      roomId: source.id,
      reservationRefId: reservation.id,
      status: RoomStayStatus.IN_HOUSE,
    });

    const moved = await moveStayToRoom(receptionist, {
      stayId: attached.stayId,
      targetRoomId: target.id,
      note: 'Cambio operacional',
    });

    expect(moved.sourceRoom).toBe('421');
    expect(moved.targetRoom).toBe('422');

    const oldStay = await prisma.roomStay.findUniqueOrThrow({ where: { id: attached.stayId } });
    const newStay = await prisma.roomStay.findUniqueOrThrow({ where: { id: moved.newStayId } });
    expect(oldStay.stage).toBe(RoomStayStage.FINALIZADO);
    expect(newStay.stage).toBe(RoomStayStage.CONFIRMADO);
    expect(newStay.status).toBe(RoomStayStatus.IN_HOUSE);
    expect(newStay.roomId).toBe(target.id);
    expect(newStay.reservationRefId).toBe(reservation.id);

    const guarantee = await prisma.guarantee.findFirstOrThrow({
      where: { reservationReferenceId: reservation.id },
    });
    expect(guarantee.state).toBe(GuaranteeState.VIGENTE);

    const history = await prisma.operationalEntry.findMany({
      where: { category: 'CAMBIO_HABITACION', reservationId: reservation.id },
    });
    expect(history).toHaveLength(2);
    expect(new Set(history.map((entry) => entry.roomId))).toEqual(new Set([source.id, target.id]));

    const sourceKey = await prisma.roomKey.findFirstOrThrow({
      where: { roomId: source.id, type: 'PRINCIPAL' },
    });
    const targetKey = await prisma.roomKey.findFirstOrThrow({
      where: { roomId: target.id, type: 'PRINCIPAL' },
    });
    expect(sourceKey.status).toBe('DISPONIBLE');
    expect(sourceKey.stayId).toBeNull();
    expect(targetKey.status).toBe('ASIGNADA');
    expect(targetKey.stayId).toBe(newStay.id);
  });

  it('confirmar una salida anterior no finaliza una reentrada del mismo ID', async () => {
    const reservation = await createReservation('9001003', 'Huésped Reentrada');
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '421' } });
    const businessDate = new Date('2026-09-17T00:00:00.000Z');

    const oldDeparture = await prisma.roomStay.create({
      data: {
        reservationId: reservation.code,
        reservationRefId: reservation.id,
        roomId: room.id,
        guestNames: ['Huésped Reentrada'],
        sourceReport: PmsReportKind.SALIDAS,
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        businessDate,
        arrivalDate: new Date('2026-09-15T00:00:00.000Z'),
        departureDate: new Date('2026-09-17T00:00:00.000Z'),
      },
    });

    const reentry = await prisma.roomStay.create({
      data: {
        reservationId: reservation.code,
        reservationRefId: reservation.id,
        roomId: room.id,
        guestNames: ['Huésped Reentrada'],
        sourceReport: PmsReportKind.IN_HOUSE,
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        businessDate,
        arrivalDate: new Date('2026-09-17T00:00:00.000Z'),
        departureDate: new Date('2026-09-18T00:00:00.000Z'),
      },
    });

    await confirmCheckOut(receptionist, { stayId: oldDeparture.id });

    const after = await prisma.roomStay.findUniqueOrThrow({ where: { id: reentry.id } });
    expect(after.stage).toBe(RoomStayStage.CONFIRMADO);

    const detail = await getRoomDetail('421');
    expect(detail.snapshot.current?.id).toBe(reentry.id);
    expect(detail.snapshot.state).toBe('OCUPADA');
  });
});
