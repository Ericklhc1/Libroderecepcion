import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PmsReportKind, ReservationStatus, RoomStayStatus } from '@prisma/client';
import {
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { syncReservationCoreFromPms } from '@/server/services/reservation-core';

const businessDate = new Date('2026-09-17T00:00:00.000Z');

async function createPmsStay(input: {
  reservationId: string;
  roomNumber: string;
  guestName: string;
  status?: RoomStayStatus;
  channel?: string;
  arrivalDate?: Date;
  departureDate?: Date;
}) {
  const room = await prisma.room.findUniqueOrThrow({ where: { number: input.roomNumber } });
  return prisma.roomStay.create({
    data: {
      reservationId: input.reservationId,
      roomId: room.id,
      guestNames: [input.guestName],
      channel: input.channel ?? 'Directo',
      arrivalDate: input.arrivalDate ?? new Date('2026-09-17T00:00:00.000Z'),
      departureDate: input.departureDate ?? new Date('2026-09-19T00:00:00.000Z'),
      sourceReport: PmsReportKind.ENTRADAS,
      status: input.status ?? RoomStayStatus.CHECK_IN,
      businessDate,
    },
  });
}

describe('núcleo PMS de huéspedes y reservas', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('crea huésped y reserva desde la estadía del PMS y la enlaza por código', async () => {
    const stay = await createPmsStay({
      reservationId: '7519039',
      roomNumber: '401',
      guestName: 'Huésped Importado',
    });

    const result = await prisma.$transaction((tx) =>
      syncReservationCoreFromPms(tx, { businessDate }),
    );

    expect(result).toEqual({
      reservationsCreated: 1,
      reservationsUpdated: 0,
      guestsCreated: 1,
      staysLinked: 1,
    });

    const reservation = await prisma.reservationReference.findUniqueOrThrow({
      where: { code: '7519039' },
      include: { guest: true },
    });
    expect(reservation.guest?.fullName).toBe('Huésped Importado');
    expect(reservation.roomNumber).toBe('401');
    expect(reservation.status).toBe(ReservationStatus.CONFIRMADA);

    const linked = await prisma.roomStay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(linked.reservationRefId).toBe(reservation.id);
  });

  it('es idempotente: repetir la sincronización no duplica huésped ni reserva', async () => {
    await createPmsStay({
      reservationId: 'IDEMP-001',
      roomNumber: '402',
      guestName: 'Huésped Único',
    });

    await prisma.$transaction((tx) => syncReservationCoreFromPms(tx, { businessDate }));
    const second = await prisma.$transaction((tx) =>
      syncReservationCoreFromPms(tx, { businessDate }),
    );

    expect(second.reservationsCreated).toBe(0);
    expect(second.guestsCreated).toBe(0);
    expect(second.staysLinked).toBe(0);
    expect(await prisma.reservationReference.count({ where: { code: 'IDEMP-001' } })).toBe(1);
    expect(await prisma.guestReference.count({ where: { fullName: 'Huésped Único' } })).toBe(1);
  });

  it('conserva datos personales validados, pero PMS manda en la operación de la reserva', async () => {
    const guest = await prisma.guestReference.create({
      data: { fullName: 'Nombre Validado en Recepción', phone: '+56 9 1234 5678' },
    });
    const manualCheckIn = new Date('2026-09-16T15:00:00.000Z');
    await prisma.reservationReference.create({
      data: {
        code: 'MANUAL-001',
        guestId: guest.id,
        roomNumber: '429',
        checkIn: manualCheckIn,
        channel: 'Empresa convenio',
        status: ReservationStatus.EN_CASA,
      },
    });
    await createPmsStay({
      reservationId: 'MANUAL-001',
      roomNumber: '403',
      guestName: 'Nombre Distinto del Informe',
      channel: 'OTA',
    });

    await prisma.$transaction((tx) => syncReservationCoreFromPms(tx, { businessDate }));

    const reservation = await prisma.reservationReference.findUniqueOrThrow({
      where: { code: 'MANUAL-001' },
      include: { guest: true },
    });

    // Identidad y datos personales enriquecidos en Recepción no se degradan.
    expect(reservation.guest?.fullName).toBe('Nombre Validado en Recepción');
    expect(reservation.guest?.phone).toBe('+56 9 1234 5678');

    // Estado físico/operativo y fechas vienen del PMS para evitar fichas obsoletas.
    expect(reservation.roomNumber).toBe('403');
    expect(reservation.checkIn?.getTime()).toBe(new Date('2026-09-17T00:00:00.000Z').getTime());
    expect(reservation.checkOut?.getTime()).toBe(new Date('2026-09-19T00:00:00.000Z').getTime());
    expect(reservation.channel).toBe('OTA');
    expect(reservation.status).toBe(ReservationStatus.CONFIRMADA);
  });

  it('una reserva con varias habitaciones sigue siendo una sola reserva', async () => {
    await createPmsStay({
      reservationId: 'GRUPO-001',
      roomNumber: '404',
      guestName: 'Titular Grupo',
    });
    await createPmsStay({
      reservationId: 'GRUPO-001',
      roomNumber: '405',
      guestName: 'Titular Grupo',
    });

    const result = await prisma.$transaction((tx) =>
      syncReservationCoreFromPms(tx, { businessDate }),
    );

    expect(result.reservationsCreated).toBe(1);
    expect(result.guestsCreated).toBe(1);
    expect(result.staysLinked).toBe(2);
    expect(await prisma.reservationReference.count({ where: { code: 'GRUPO-001' } })).toBe(1);

    const reservation = await prisma.reservationReference.findUniqueOrThrow({
      where: { code: 'GRUPO-001' },
    });
    expect(reservation.roomNumber).toBeNull();
  });
});
