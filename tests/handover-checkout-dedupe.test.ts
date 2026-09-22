import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { buildHandoverSnapshot } from '@/server/services/handover-snapshot';

describe('PMS retirado de la entrega', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  it('una salida PMS pendiente no aparece en el snapshot de entrega', async () => {
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });
    await prisma.roomStay.create({
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

    const snapshot = await buildHandoverSnapshot(
      new Date('2026-09-17T15:00:00.000Z'),
      { shiftId: null, includeMetrics: false },
    );

    expect(snapshot.some((item) => item.section === 'Salidas por confirmar')).toBe(false);
    expect(snapshot.some((item) => item.title.includes('Check-out'))).toBe(false);
  });
});
