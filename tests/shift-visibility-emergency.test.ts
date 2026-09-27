import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  addShiftMember,
  closeShift,
  getMyActiveShift,
  getShiftDesk,
  openShift,
} from '@/server/services/shifts';

describe('visibilidad, incorporación y emergencia única de turnos', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('un recepcionista fuera del turno ve el turno global en curso y puede sumarse al mismo', async () => {
    const titular = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Titular visible' });
    const apoyo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Apoyo visible' });

    const { shift } = await openShift(titular, { type: ShiftType.DIA });

    const deskBefore = await getShiftDesk(apoyo);
    expect(deskBefore.current?.id).toBe(shift.id);
    expect(deskBefore.iAmIn).toBe(false);
    expect(await getMyActiveShift(apoyo.id)).toBeNull();

    await addShiftMember(apoyo, { shiftId: shift.id, userId: apoyo.id });

    const joined = await getMyActiveShift(apoyo.id);
    expect(joined?.id).toBe(shift.id);
    expect(
      joined?.assignments.some(
        (assignment) =>
          assignment.userId === apoyo.id &&
          assignment.activatedAt !== null &&
          assignment.leftAt === null,
      ),
    ).toBe(true);

    const deskAfter = await getShiftDesk(apoyo);
    expect(deskAfter.current?.id).toBe(shift.id);
    expect(deskAfter.iAmIn).toBe(true);

    expect(
      await prisma.shift.count({
        where: { status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA'] } },
      }),
    ).toBe(1);
  });

  it('impide una segunda emergencia mientras la primera siga excepcionalmente activa', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente emergencia' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante emergencia' });
    const tercero = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Tercero emergencia' });

    await openShift(saliente, { type: ShiftType.DIA });

    const first = await openShift(entrante, {
      type: ShiftType.NOCHE,
      continuity: true,
      emergencyReason: 'SALIENTE_NO_DISPONIBLE',
      emergencyAccepted: true,
    });

    expect(first.shift.emergency).toBe(true);
    expect(first.shift.emergencyReleasedAt).toBeNull();

    await expect(
      openShift(tercero, {
        type: ShiftType.NOCHE,
        continuity: true,
        emergencyReason: 'FALLA_TECNICA_CIERRE',
        emergencyAccepted: true,
      }),
    ).rejects.toThrow(/ya existe un turno de emergencia abierto/i);

    expect(
      await prisma.shift.count({
        where: {
          emergency: true,
          emergencyReleasedAt: null,
          status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA'] },
        },
      }),
    ).toBe(1);
  });

  it('al cerrarse el turno origen la emergencia se regulariza sin borrar su historia', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente regulariza' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante regulariza' });

    const source = await openShift(saliente, { type: ShiftType.DIA });
    const emergency = await openShift(entrante, {
      type: ShiftType.NOCHE,
      continuity: true,
      emergencyReason: 'SALIENTE_NO_DISPONIBLE',
      emergencyAccepted: true,
    });

    const sourceAfterEmergency = await prisma.shift.findUniqueOrThrow({
      where: { id: source.shift.id },
    });
    expect(sourceAfterEmergency.status).toBe('ENTREGA_ENVIADA');

    await closeShift(saliente, { shiftId: source.shift.id });

    const normalized = await prisma.shift.findUniqueOrThrow({
      where: { id: emergency.shift.id },
    });
    expect(normalized.emergency).toBe(true);
    expect(normalized.emergencySourceShiftId).toBe(source.shift.id);
    expect(normalized.emergencyReleasedAt).toBeInstanceOf(Date);
    expect(normalized.emergencyReleaseReason).toMatch(/cerrado formalmente/i);
    expect(normalized.status).toBe('ACTIVO');

    const alert = await prisma.alert.findUnique({
      where: { dedupeKey: `shift-emergency-source:${source.shift.id}` },
    });
    expect(alert?.status).toBe('RESUELTA');

    expect(
      await prisma.shift.count({
        where: {
          emergency: true,
          emergencyReleasedAt: null,
          status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA', 'ENTREGA_ENVIADA'] },
        },
      }),
    ).toBe(0);
  });

  it('la base impide físicamente dos emergencias activas aunque se intente saltar el servicio', async () => {
    const creator = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Creador DB emergencia' });
    const now = new Date();
    const later = new Date(now.getTime() + 13 * 60 * 60 * 1000);

    await prisma.shift.create({
      data: {
        date: new Date('2026-09-27T00:00:00.000Z'),
        type: ShiftType.DIA,
        status: 'ACTIVO',
        plannedStart: now,
        plannedEnd: later,
        actualStart: now,
        createdById: creator.id,
        startedById: creator.id,
        emergency: true,
        emergencyReason: 'Prueba uno',
        emergencyAcknowledgedAt: now,
      },
    });

    await expect(
      prisma.shift.create({
        data: {
          date: new Date('2026-09-27T00:00:00.000Z'),
          type: ShiftType.NOCHE,
          status: 'ACTIVO',
          plannedStart: now,
          plannedEnd: later,
          actualStart: now,
          createdById: creator.id,
          startedById: creator.id,
          emergency: true,
          emergencyReason: 'Prueba dos',
          emergencyAcknowledgedAt: now,
        },
      }),
    ).rejects.toThrow();
  });
});
