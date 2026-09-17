import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AlertLevel, AlertStatus, AlertType, RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { buildHandoverSnapshot } from '@/server/services/handover-snapshot';

describe('deduplicación de salidas en la entrega', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  it('una salida pendiente aparece una vez aunque tenga su alerta automática', async () => {
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

    await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Check-out sin confirmar: hab. 408',
        message: 'La salida sigue pendiente después de la hora límite.',
        auto: true,
        dedupeKey: `checkout-unconfirmed:${stay.id}`,
      },
    });

    const snapshot = await buildHandoverSnapshot(
      new Date('2026-09-17T15:00:00.000Z'),
      { shiftId: null, includeMetrics: false },
    );

    expect(snapshot.filter((item) => item.section === 'Salidas por confirmar')).toHaveLength(1);
    expect(
      snapshot.filter(
        (item) => item.section === 'Alertas activas' && item.title.includes('Check-out sin confirmar'),
      ),
    ).toHaveLength(0);
  });
});
