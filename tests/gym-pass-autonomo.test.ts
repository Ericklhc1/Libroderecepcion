import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  createGymPass,
  createParkingPass,
  listGymPasses,
  listParkingPasses,
  voidGymPass,
} from '@/server/services/gym-pass';

describe('folios de gimnasio autónomos en Caja', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('emite con fecha, habitación, huésped y recepcionista automático sin PMS', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepcionista Gimnasio',
    });
    const shift = await openShiftAs(receptionist);

    const result = await createGymPass(receptionist, {
      serviceDate: '2026-09-22',
      roomNumber: '512',
      guestName: 'María Pérez',
    });

    const pass = await prisma.gymPass.findUniqueOrThrow({ where: { id: result.id } });

    expect(pass.roomNumber).toBe('512');
    expect(pass.guestName).toBe('María Pérez');
    expect(pass.receptionistId).toBe(receptionist.id);
    expect(pass.shiftId).toBe(shift.id);
    expect(pass.serviceDate.toISOString()).toBe('2026-09-22T00:00:00.000Z');

    expect(pass.reservationReferenceId).toBeNull();
    expect(pass.roomId).not.toBeNull();
    expect(pass.operationalEntryId).toBeNull();
    expect(pass.currency).toBeNull();
    expect(pass.amount).toBeNull();
    expect(pass.paymentMethod).toBeNull();

    expect(
      await prisma.cashMovement.count({ where: { gymPassId: pass.id } }),
    ).toBe(0);
    expect(
      await prisma.operationalEntry.count({ where: { category: 'PASE_GIMNASIO' } }),
    ).toBe(0);
  });

  it('resume folios por la fecha del servicio y conserva anulaciones', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepcionista Rango',
    });
    await openShiftAs(receptionist);

    const first = await createGymPass(receptionist, {
      serviceDate: '2026-09-20',
      roomNumber: '501',
      guestName: 'Huésped Uno',
    });
    await createGymPass(receptionist, {
      serviceDate: '2026-09-22',
      roomNumber: '502',
      guestName: 'Huésped Dos',
    });
    await createGymPass(receptionist, {
      serviceDate: '2026-09-25',
      roomNumber: '503',
      guestName: 'Huésped Tres',
    });

    await voidGymPass(receptionist, {
      id: first.id,
      reason: 'Folio emitido por error.',
    });

    const summary = await listGymPasses({
      from: '2026-09-20',
      to: '2026-09-22',
    });

    expect(summary.total).toBe(2);
    expect(summary.emitted).toBe(1);
    expect(summary.voided).toBe(1);
    expect(summary.rows.map((row) => row.roomNumber).sort()).toEqual(['501', '502']);
    expect(summary.rows.every((row) => row.receptionistName === 'Recepcionista Rango')).toBe(true);
  });

  it('emite estacionamiento con ID Reserva usando el mismo folio operativo sin contaminar gimnasio', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepcionista Estacionamiento',
    });
    await openShiftAs(receptionist);

    const parking = await createParkingPass(receptionist, {
      serviceDate: '2026-09-28',
      roomNumber: '601',
      guestName: 'Huésped Vehículo',
      reservationCode: '7486899',
    });
    await createGymPass(receptionist, {
      serviceDate: '2026-09-28',
      roomNumber: '602',
      guestName: 'Huésped Gimnasio',
    });

    const persisted = await prisma.gymPass.findUniqueOrThrow({ where: { id: parking.id } });
    expect(persisted.serviceType).toBe('ESTACIONAMIENTO');
    expect(persisted.reservationCode).toBe('7486899');
    expect(persisted.vehiclePlate).toBeNull();
    expect(persisted.roomId).not.toBeNull();

    const parkingSummary = await listParkingPasses({ from: '2026-09-28', to: '2026-09-28' });
    const gymSummary = await listGymPasses({ from: '2026-09-28', to: '2026-09-28' });

    expect(parkingSummary.rows).toHaveLength(1);
    expect(parkingSummary.rows[0]).toMatchObject({
      roomNumber: '601',
      reservationCode: '7486899',
      serviceType: 'ESTACIONAMIENTO',
    });
    expect(gymSummary.rows).toHaveLength(1);
    expect(gymSummary.rows[0]?.serviceType).toBe('GIMNASIO');
  });

  it('rechaza una habitación fuera del catálogo operativo', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await openShiftAs(receptionist);

    await expect(
      createGymPass(receptionist, {
        serviceDate: '2026-09-22',
        roomNumber: '999',
        guestName: 'Habitación inexistente',
      }),
    ).rejects.toThrow(/habitación válida/i);
  });

  it('rechaza emitir un folio sin turno operativo', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    await expect(
      createGymPass(receptionist, {
        serviceDate: '2026-09-22',
        roomNumber: '512',
        guestName: 'Sin turno',
      }),
    ).rejects.toThrow(/turno operativo/);
  });
});
