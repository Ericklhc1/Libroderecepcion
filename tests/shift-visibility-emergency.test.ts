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
  confirmHandoverReviewStep,
  getMyActiveShift,
  getShiftDesk,
  openShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
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
    const relevoPosterior = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Relevo posterior' });

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

    // La entrega tardía del saliente se recibe DENTRO del turno que nació por
    // emergencia. Debe quedar enlazada a ese turno, nunca al turno posterior.
    const delayed = await prisma.shiftHandover.findUniqueOrThrow({
      where: { fromShiftId: source.shift.id },
    });
    await receiveHandover(entrante, { handoverId: delayed.id });
    const delayedReceived = await prisma.shiftHandover.findUniqueOrThrow({
      where: { id: delayed.id },
    });
    expect(delayedReceived.status).toBe('RECIBIDA');
    expect(delayedReceived.toShiftId).toBe(emergency.shift.id);

    // El "cupo" de emergencia quedó libre: si más tarde el turno vigente sufre
    // otra contingencia real, puede abrirse una nueva excepción independiente.
    const nextEmergency = await openShift(relevoPosterior, {
      type: ShiftType.DIA,
      continuity: true,
      emergencyReason: 'FALLA_TECNICA_CIERRE',
      emergencyAccepted: true,
    });
    expect(nextEmergency.shift.emergency).toBe(true);
    expect(nextEmergency.shift.emergencyReleasedAt).toBeNull();
    expect(nextEmergency.shift.emergencySourceShiftId).toBe(emergency.shift.id);
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

  it('cerrar el propio turno de emergencia libera la excepción aunque el origen siga pendiente', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Origen aún pendiente' });
    const emergenciaUser = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Emergencia que cierra' });

    const source = await openShift(saliente, { type: ShiftType.DIA });
    const emergency = await openShift(emergenciaUser, {
      type: ShiftType.NOCHE,
      continuity: true,
      emergencyReason: 'CONTINUIDAD_CRITICA',
      emergencyAccepted: true,
    });

    const draft = await prepareHandover(emergenciaUser, emergency.shift.id);
    await confirmHandoverReviewStep(emergenciaUser, {
      handoverId: draft.id,
      step: 'PENDINGS',
    });
    const urgentCount = await prisma.handoverItem.count({
      where: { handoverId: draft.id, level: 'URGENTE' },
    });
    await confirmHandoverReviewStep(emergenciaUser, {
      handoverId: draft.id,
      step: 'FINAL',
      urgentAcknowledged: urgentCount > 0,
    });
    await sendHandover(emergenciaUser, { shiftId: emergency.shift.id });
    await closeShift(emergenciaUser, { shiftId: emergency.shift.id });

    const closedEmergency = await prisma.shift.findUniqueOrThrow({
      where: { id: emergency.shift.id },
    });
    expect(closedEmergency.status).toBe('CERRADO');
    expect(closedEmergency.emergency).toBe(true);
    expect(closedEmergency.emergencyReleasedAt).toBeInstanceOf(Date);
    expect(closedEmergency.emergencyReleaseReason).toMatch(/propio turno de emergencia/i);

    const sourceStillPending = await prisma.shift.findUniqueOrThrow({
      where: { id: source.shift.id },
    });
    expect(sourceStillPending.status).toBe('ENTREGA_ENVIADA');

    const emergencyAlert = await prisma.alert.findUnique({
      where: { dedupeKey: `shift-emergency-source:${source.shift.id}` },
    });
    expect(emergencyAlert?.status).toBe('RESUELTA');
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
