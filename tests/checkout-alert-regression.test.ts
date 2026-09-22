import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { collectAlertCandidates } from '@/server/services/alert-engine';

describe('PMS retirado del motor de alertas', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  it('un check-out PMS pendiente no genera candidata automática', async () => {
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });
    const stay = await prisma.roomStay.create({
      data: {
        reservationId: 'REG-CO-408',
        roomId: room.id,
        guestNames: ['Huésped salida'],
        sourceReport: 'SALIDAS',
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        businessDate: new Date('2026-09-17T00:00:00.000Z'),
        departureDate: new Date('2026-09-17T00:00:00.000Z'),
      },
    });

    const candidates = await collectAlertCandidates(new Date('2026-09-17T15:00:00.000Z'));

    expect(
      candidates.some((candidate) => candidate.dedupeKey === `checkout-unconfirmed:${stay.id}`),
    ).toBe(false);
    expect(candidates.some((candidate) => candidate.title.includes('Check-out'))).toBe(false);
  });
});
