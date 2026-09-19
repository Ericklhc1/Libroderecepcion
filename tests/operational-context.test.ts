import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { resolveOperationalContext } from '@/server/services/operational-context';
import { insertCashMovement } from '@/server/services/live-cash';
import { getRoomDetail } from '@/server/services/rooms';

async function reservation(code: string, guestName: string) {
  return prisma.reservationReference.create({
    data: { code, guest: { create: { fullName: guestName } } },
    include: { guest: true },
  });
}

async function stay(input: {
  code: string;
  reservationRefId: string;
  roomNumber: string;
  status?: RoomStayStatus;
  stage?: RoomStayStage;
  businessDate?: Date;
}) {
  const room = await prisma.room.findUniqueOrThrow({ where: { number: input.roomNumber } });
  return prisma.roomStay.create({
    data: {
      reservationId: input.code,
      reservationRefId: input.reservationRefId,
      roomId: room.id,
      guestNames: ['Snapshot PMS'],
      sourceReport: 'ACTIVIDAD',
      status: input.status ?? RoomStayStatus.IN_HOUSE,
      stage: input.stage ?? RoomStayStage.CONFIRMADO,
      businessDate: input.businessDate ?? new Date('2026-09-19T00:00:00.000Z'),
    },
  });
}

describe('resolución operacional de contexto', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('una habitación con una sola estadía completa reserva y huésped', async () => {
    const ref = await reservation('CTX-1', 'Ana Contexto');
    const s = await stay({ code: ref.code, reservationRefId: ref.id, roomNumber: '404' });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '404' } });

    const context = await resolveOperationalContext(prisma, { roomId: room.id });

    expect(context.stayId).toBe(s.id);
    expect(context.roomNumber).toBe('404');
    expect(context.reservationReferenceId).toBe(ref.id);
    expect(context.guestId).toBe(ref.guestId);
    expect(context.guestName).toBe('Ana Contexto');
    expect(context.issues).toEqual([]);
  });

  it('una reserva multihabitación no inventa una estadía', async () => {
    const ref = await reservation('CTX-MULTI', 'Grupo Contexto');
    await stay({ code: ref.code, reservationRefId: ref.id, roomNumber: '404' });
    await stay({ code: ref.code, reservationRefId: ref.id, roomNumber: '405' });

    const context = await resolveOperationalContext(prisma, { reservationReferenceId: ref.id });

    expect(context.reservationReferenceId).toBe(ref.id);
    expect(context.guestId).toBe(ref.guestId);
    expect(context.stayId).toBeNull();
    expect(context.roomId).toBeNull();
    expect(context.ambiguousStayIds).toHaveLength(2);
  });

  it('no mezcla huésped saliente y entrante de la misma habitación', async () => {
    const out = await reservation('CTX-OUT', 'Huésped saliente');
    const incoming = await reservation('CTX-IN', 'Huésped entrante');
    await stay({ code: out.code, reservationRefId: out.id, roomNumber: '406', status: RoomStayStatus.CHECK_OUT, stage: RoomStayStage.PENDIENTE });
    await stay({ code: incoming.code, reservationRefId: incoming.id, roomNumber: '406', status: RoomStayStatus.CHECK_IN, stage: RoomStayStage.PENDIENTE });

    const context = await resolveOperationalContext(prisma, { roomNumber: '406' });

    expect(context.stayId).toBeNull();
    expect(context.reservationReferenceId).toBeNull();
    expect(context.ambiguousStayIds).toHaveLength(2);
    expect(context.issues.join(' ')).toMatch(/no mezclará/i);
  });

  it('el historial finalizado no compite con el estado actual', async () => {
    const oldRef = await reservation('CTX-OLD', 'Huésped anterior');
    const currentRef = await reservation('CTX-NOW', 'Huésped actual');
    await stay({ code: oldRef.code, reservationRefId: oldRef.id, roomNumber: '407', stage: RoomStayStage.FINALIZADO, businessDate: new Date('2026-09-18T00:00:00.000Z') });
    const current = await stay({ code: currentRef.code, reservationRefId: currentRef.id, roomNumber: '407' });

    const context = await resolveOperationalContext(prisma, { roomNumber: '407' });

    expect(context.stayId).toBe(current.id);
    expect(context.reservationReferenceId).toBe(currentRef.id);
  });

  it('un movimiento creado en Caja central se refleja en el dossier de la habitación', async () => {
    const ref = await reservation('CTX-CAJA', 'Huésped Caja');
    const current = await stay({
      code: ref.code,
      reservationRefId: ref.id,
      roomNumber: '408',
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Caja Contexto' });

    const movementId = await insertCashMovement(prisma, {
      userId: user.id,
      kind: 'AJUSTE_ENTRADA',
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 25_000,
      roomId: room.id,
      stayId: current.id,
      guestId: ref.guestId,
      reservationReferenceId: ref.id,
      reference: 'Abono contextual',
    });

    const detail = await getRoomDetail('408');
    const reflected = detail.cashMovements.find((movement) => movement.id === movementId);

    expect(reflected).toMatchObject({
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 25_000,
      reservationCode: 'CTX-CAJA',
      guestName: 'Huésped Caja',
      createdByName: 'Caja Contexto',
    });
  });
});
