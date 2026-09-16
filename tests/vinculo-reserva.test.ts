import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { linkStaysToReservations } from '@/server/services/pms-import';
import { getRoomDetail } from '@/server/services/rooms';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Vínculo entre la estadía del PMS y la reserva interna.
 *
 * Son dos mundos: `RoomStay.reservationId` y `guestNames` son la fotografía de
 * lo que entregó el PMS, y no se tocan. El vínculo es **opcional** y se
 * resuelve por CÓDIGO, nunca por nombre.
 */
describe('vínculo estadía ↔ reserva', () => {
  let user: CurrentUser;

  const estadia = async (options: {
    reservationId: string;
    room: string;
    guestNames?: string[];
    businessDate?: Date;
  }) => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: options.room } });
    return prisma.roomStay.create({
      data: {
        businessDate: options.businessDate ?? new Date(2026, 8, 15),
        roomId: room.id,
        reservationId: options.reservationId,
        guestNames: options.guestNames ?? ['Huésped del PMS'],
        status: RoomStayStatus.IN_HOUSE,
        sourceReport: 'IN_HOUSE',
      },
      select: { id: true },
    });
  };

  const vincular = (options: { businessDate?: Date } = {}) =>
    prisma.$transaction((tx) => linkStaysToReservations(tx, options));

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    void user;
  });

  it('vincula por código de reserva', async () => {
    const stay = await estadia({ reservationId: '7484708', room: '404' });
    const reserva = await prisma.reservationReference.create({
      data: { code: '7484708', roomNumber: '404' },
      select: { id: true },
    });

    expect(await vincular()).toBe(1);
    const despues = await prisma.roomStay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(despues.reservationRefId).toBe(reserva.id);
  });

  it('conserva intactos el código y los nombres del PMS', async () => {
    const stay = await estadia({
      reservationId: '7484708',
      room: '404',
      guestNames: ['EMILIANO DANNIBALE', 'LAUREANO DANNIBALE'],
    });
    await prisma.reservationReference.create({
      data: { code: '7484708', guest: { create: { fullName: 'Otro Nombre Distinto' } } },
    });

    await vincular();
    const despues = await prisma.roomStay.findUniqueOrThrow({ where: { id: stay.id } });
    // La fotografía del PMS no se reescribe con los datos internos.
    expect(despues.reservationId).toBe('7484708');
    expect(despues.guestNames).toEqual(['EMILIANO DANNIBALE', 'LAUREANO DANNIBALE']);
  });

  it('NUNCA vincula por nombre', async () => {
    /*
      El caso real de la 515: el mismo huésped con dos reservas distintas.
      Emparejar por nombre asociaría la estadía a la reserva equivocada.
    */
    await estadia({ reservationId: '7529517', room: '515', guestNames: ['Fresnel Joseph'] });
    await prisma.reservationReference.create({
      data: { code: '7530596', guest: { create: { fullName: 'Fresnel Joseph' } } },
    });

    // El nombre coincide, el código no: no se vincula.
    expect(await vincular()).toBe(0);
  });

  it('deja el vínculo nulo cuando la reserva no existe', async () => {
    const stay = await estadia({ reservationId: 'NO-EXISTE', room: '404' });
    expect(await vincular()).toBe(0);
    const despues = await prisma.roomStay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(despues.reservationRefId).toBeNull();
  });

  it('agrupa las tres estadías de una misma reserva', async () => {
    const room = await prisma.room.findFirstOrThrow({ where: { number: '408' } });
    for (const status of [
      RoomStayStatus.CHECK_IN,
      RoomStayStatus.IN_HOUSE,
      RoomStayStatus.CHECK_OUT,
    ]) {
      await prisma.roomStay.create({
        data: {
          businessDate: new Date(2026, 8, 15),
          roomId: room.id,
          reservationId: 'R-TRIPLE',
          guestNames: ['Huésped'],
          status,
          sourceReport: 'IN_HOUSE',
        },
      });
    }
    await prisma.reservationReference.create({ data: { code: 'R-TRIPLE' } });

    expect(await vincular()).toBe(3);
  });

  it('es idempotente: repetirlo no vuelve a vincular', async () => {
    await estadia({ reservationId: 'R-IDEM', room: '404' });
    await prisma.reservationReference.create({ data: { code: 'R-IDEM' } });

    expect(await vincular()).toBe(1);
    expect(await vincular()).toBe(0);
  });

  it('sin acotar el día alcanza estadías anteriores', async () => {
    const ayer = new Date(2026, 8, 14);
    await estadia({ reservationId: 'R-AYER', room: '404', businessDate: ayer });
    await prisma.reservationReference.create({ data: { code: 'R-AYER' } });

    expect(await vincular({ businessDate: new Date(2026, 8, 15) })).toBe(0);
    expect(await vincular()).toBe(1);
  });

  it('la ficha de habitación muestra el contexto de la cuenta', async () => {
    await estadia({ reservationId: 'R-FICHA', room: '404' });
    const reserva = await prisma.reservationReference.create({
      data: {
        code: 'R-FICHA',
        balanceDue: 45000,
        guest: { create: { fullName: 'Ana Pérez', vip: true } },
      },
      select: { id: true },
    });
    await prisma.guarantee.create({
      data: {
        reservationReferenceId: reserva.id,
        amount: 100000,
        currency: 'CLP',
        state: 'VIGENTE',
        createdById: user.id,
      },
    });
    await vincular();

    const room = await getRoomDetail('404');
    expect(room.reservations).toHaveLength(1);
    expect(room.reservations[0]!.code).toBe('R-FICHA');
    expect(room.reservations[0]!.guestName).toBe('Ana Pérez');
    expect(room.reservations[0]!.vip).toBe(true);
    expect(room.reservations[0]!.balanceDue).toBe(45000);
    expect(room.reservations[0]!.guarantees).toHaveLength(1);
    expect(room.reservations[0]!.guarantees[0]!.amount).toBe('100000');
  });

  it('la ficha no inventa contexto cuando no hay reserva vinculada', async () => {
    await estadia({ reservationId: 'SOLO-PMS', room: '412' });
    const room = await getRoomDetail('412');
    expect(room.reservations).toEqual([]);
    // Pero la estadía del PMS sí está: el vínculo es opcional.
    expect(room.snapshot.current?.reservationId).toBe('SOLO-PMS');
  });
});
