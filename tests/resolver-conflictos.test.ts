import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  KeyStatus,
  PmsImportStatus,
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
import { hotelWallDateTime } from '@/domain/time';
import { resolveAllOperationalConflicts } from '@/server/services/conflict-resolution';
import { getLiveConflicts, applyImport } from '@/server/services/pms-import';

describe('resolución global de conflictos', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  it('resuelve duplicados, checkout vencido e in-house sin llave y notifica a todos', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisor' });
    await createUser({ roleKey: ROLE_KEYS.MANAGEMENT, name: 'Gerencia' });
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });

    const room404 = await prisma.room.findUniqueOrThrow({ where: { number: '404' } });
    const room408 = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });

    const old = await prisma.roomStay.create({
      data: {
        roomId: room404.id,
        reservationId: 'RES-404',
        guestNames: ['Huésped antiguo'],
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        sourceReport: 'ACTIVIDAD',
        businessDate: new Date('2026-09-17T00:00:00.000Z'),
      },
    });
    const current = await prisma.roomStay.create({
      data: {
        roomId: room404.id,
        reservationId: 'RES-404',
        guestNames: ['Huésped vigente'],
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        sourceReport: 'ACTIVIDAD',
        businessDate: new Date('2026-09-18T00:00:00.000Z'),
      },
    });
    const checkout = await prisma.roomStay.create({
      data: {
        roomId: room408.id,
        reservationId: 'OUT-408',
        guestNames: ['Salida 408'],
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        sourceReport: 'ACTIVIDAD',
        businessDate: new Date('2026-09-18T00:00:00.000Z'),
        departureDate: new Date('2026-09-18T00:00:00.000Z'),
      },
    });

    const before = await getLiveConflicts();
    expect(before.some((c) => c.kind === 'RESERVA_DUPLICADA' && c.roomNumber === '404')).toBe(true);
    expect(before.some((c) => c.kind === 'IN_HOUSE_SIN_LLAVE' && c.roomNumber === '404')).toBe(true);

    const result = await resolveAllOperationalConflicts(supervisor, {
      now: hotelWallDateTime('2026-09-18', 12),
    });

    expect(result.duplicateStaysArchived).toBe(1);
    expect(result.checkoutsConfirmed).toBe(1);
    expect(result.keysReconciled).toBeGreaterThanOrEqual(1);
    expect(result.notificationsSent).toBe(3);

    const oldAfter = await prisma.roomStay.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldAfter.deletedAt).not.toBeNull();

    const currentAfter = await prisma.roomStay.findUniqueOrThrow({ where: { id: current.id } });
    expect(currentAfter.deletedAt).toBeNull();

    const checkoutAfter = await prisma.roomStay.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(checkoutAfter.stage).toBe(RoomStayStage.FINALIZADO);

    const key404 = await prisma.roomKey.findFirstOrThrow({
      where: { roomId: room404.id, type: 'PRINCIPAL' },
    });
    expect(key404.stayId).toBe(current.id);
    expect(key404.status).toBe(KeyStatus.ASIGNADA);

    const notifications = await prisma.notification.findMany({
      where: { type: 'ACTUALIZACION_OPERATIVA' },
    });
    expect(notifications).toHaveLength(3);

    const log = await prisma.operationalEntry.findFirst({
      where: { category: 'RECONCILIACION_CONFLICTOS' },
    });
    expect(log?.type).toBe('NOVEDAD');
  });

  it('antes de la hora límite no confirma automáticamente un checkout', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });
    const checkout = await prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId: 'OUT-TEMPRANO',
        guestNames: ['Salida temprana'],
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        sourceReport: 'ACTIVIDAD',
        businessDate: new Date('2026-09-18T00:00:00.000Z'),
        departureDate: new Date('2026-09-18T00:00:00.000Z'),
      },
    });

    const result = await resolveAllOperationalConflicts(supervisor, {
      now: hotelWallDateTime('2026-09-18', 10, 30),
    });
    expect(result.checkoutsConfirmed).toBe(0);

    const after = await prisma.roomStay.findUniqueOrThrow({ where: { id: checkout.id } });
    expect(after.stage).toBe(RoomStayStage.PENDIENTE);
  });

  it('no inventa cuál huésped vale cuando dos reservas distintas chocan el mismo día', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '414' } });

    for (const reservationId of ['A-414', 'B-414']) {
      await prisma.roomStay.create({
        data: {
          roomId: room.id,
          reservationId,
          guestNames: [reservationId],
          status: RoomStayStatus.IN_HOUSE,
          stage: RoomStayStage.CONFIRMADO,
          sourceReport: 'ACTIVIDAD',
          businessDate: new Date('2026-09-18T00:00:00.000Z'),
        },
      });
    }

    const result = await resolveAllOperationalConflicts(supervisor, {
      now: hotelWallDateTime('2026-09-18', 12),
    });

    expect(result.remaining).toBeGreaterThan(0);
    expect(result.remainingKinds.DOS_IN_HOUSE).toBe(1);
    expect(await prisma.roomStay.count({
      where: { roomId: room.id, deletedAt: null, status: RoomStayStatus.IN_HOUSE },
    })).toBe(2);

    const escalation = await prisma.operationalEntry.findFirst({
      where: { category: 'CONFLICTOS_REQUIEREN_DECISION' },
    });
    expect(escalation?.type).toBe('INCIDENCIA');
    expect(escalation?.severity).toBe('CRITICA');
  });
});

describe('importación PMS entre días operativos', () => {
  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  it('refresca una estadía activa del día anterior en vez de duplicarla', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '405' } });

    const previous = await prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId: 'PMS-405',
        guestNames: ['Nombre de ayer'],
        status: RoomStayStatus.IN_HOUSE,
        stage: RoomStayStage.CONFIRMADO,
        sourceReport: 'ACTIVIDAD',
        businessDate: new Date('2026-09-17T00:00:00.000Z'),
      },
    });

    const batch = await prisma.pmsImportBatch.create({
      data: {
        businessDate: new Date('2026-09-18T00:00:00.000Z'),
        status: PmsImportStatus.BORRADOR,
        reports: [],
        summary: {},
        payload: [
          {
            reservationId: 'PMS-405',
            roomNumber: '405',
            guestNames: ['Nombre de hoy'],
            channel: null,
            arrivalDate: null,
            departureDate: null,
            pmsStatus: null,
            sourceReport: 'ACTIVIDAD',
            status: 'IN_HOUSE',
            guestCount: 1,
            totalAmount: null,
            pendingAmount: null,
            currency: null,
            paymentType: null,
            paymentTypeRaw: null,
            issues: [],
          },
        ],
        createdById: supervisor.id,
      },
    });

    await applyImport(supervisor, batch.id);

    const active = await prisma.roomStay.findMany({
      where: {
        roomId: room.id,
        reservationId: 'PMS-405',
        deletedAt: null,
        stage: { not: RoomStayStage.FINALIZADO },
      },
    });

    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(previous.id);
    expect(active[0]!.businessDate.getTime()).toBe(
      new Date('2026-09-18T00:00:00.000Z').getTime(),
    );
    expect(active[0]!.guestNames).toEqual(['Nombre de hoy']);
  });
});
