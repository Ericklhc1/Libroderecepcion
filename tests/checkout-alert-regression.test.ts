import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import {
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { collectAlertCandidates } from '@/server/services/alert-engine';

describe('alerta horaria de check-out', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetRoomsAndKeys();
    await resetOperationalData();
    await seedCatalog();
  });

  async function salidaPendiente() {
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '408' } });
    return prisma.roomStay.create({
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
  }

  it('antes de las 11:00 no crea la alerta de salida vencida', async () => {
    const stay = await salidaPendiente();
    // 13:00Z = 10:00 en Santiago para esta fecha.
    const candidates = await collectAlertCandidates(new Date('2026-09-17T13:00:00.000Z'));

    expect(candidates.some((candidate) => candidate.dedupeKey === `checkout-unconfirmed:${stay.id}`)).toBe(false);
  });

  it('desde las 11:00 crea una sola candidata crítica por estadía', async () => {
    const stay = await salidaPendiente();
    // 15:00Z = 12:00 en Santiago para esta fecha.
    const candidates = await collectAlertCandidates(new Date('2026-09-17T15:00:00.000Z'));
    const checkout = candidates.filter(
      (candidate) => candidate.dedupeKey === `checkout-unconfirmed:${stay.id}`,
    );

    expect(checkout).toHaveLength(1);
    expect(checkout[0]?.level).toBe('CRITICA');
    expect(checkout[0]?.title).toContain('408');
    expect(checkout[0]?.message).toContain('11:00');
  });

  it('una salida ya finalizada deja de generar la alerta', async () => {
    const stay = await salidaPendiente();
    await prisma.roomStay.update({
      where: { id: stay.id },
      data: { stage: RoomStayStage.FINALIZADO },
    });

    const candidates = await collectAlertCandidates(new Date('2026-09-17T15:00:00.000Z'));
    expect(candidates.some((candidate) => candidate.dedupeKey === `checkout-unconfirmed:${stay.id}`)).toBe(false);
  });
});
