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
import { changeFineStatus, createFine, listFinesForRoom } from '@/server/services/fines';

describe('multa abierta después del check-out', () => {
  beforeAll(async () => {
    await resetRoomsAndKeys();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('el check-out no oculta una multa todavía pendiente de decisión', async () => {
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const room = await prisma.room.findUniqueOrThrow({ where: { number: '527' } });
    const stay = await prisma.roomStay.create({
      data: {
        roomId: room.id,
        reservationId: 'RES-MULTA-527',
        guestNames: ['Huésped con multa'],
        sourceReport: 'SALIDAS',
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        businessDate: new Date(2026, 8, 17),
      },
    });

    const fine = await createFine(supervisor, {
      roomNumber: '527',
      stayId: stay.id,
      reservationCode: stay.reservationId,
      guestName: stay.guestNames[0]!,
      kind: 'BLANCO',
      linenKind: 'TOALLA_MANO',
      stainType: 'Maquillaje',
      reason: 'La mancha no se recuperó con el lavado habitual.',
    });

    await prisma.roomStay.update({
      where: { id: stay.id },
      data: { stage: RoomStayStage.FINALIZADO },
    });

    const abiertas = await listFinesForRoom('527');
    expect(abiertas.map((item) => item.id)).toContain(fine.id);

    await changeFineStatus(supervisor, { fineId: fine.id, status: 'COBRADA' });

    const resueltas = await listFinesForRoom('527');
    expect(resueltas.map((item) => item.id)).not.toContain(fine.id);
  });
});
