import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShiftStatus, ShiftType } from '@prisma/client';
import {
  closeShift,
  getMyActiveShift,
  getPendingHandover,
  openShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

async function activate(
  user: Awaited<ReturnType<typeof createUser>>,
  type: ShiftType,
) {
  const { shift } = await openShift(user, { type });
  await receiveHandover(user, { shiftId: shift.id });
  return prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
}

describe('relevo secuencial de Recepción', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('bloquea al entrante mientras el saliente sigue activo', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    await activate(saliente, ShiftType.DIA);

    await expect(
      openShift(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/saliente todavía no está cerrado/i);
  });

  it('bloquea al entrante mientras el saliente prepara la entrega', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    const turno = await activate(saliente, ShiftType.DIA);
    await prepareHandover(saliente, turno.id);

    await expect(
      openShift(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/saliente todavía no está cerrado/i);
  });

  it('enviar la entrega no libera al saliente: debe cerrar formalmente', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    const turno = await activate(saliente, ShiftType.DIA);
    await prepareHandover(saliente, turno.id);
    await sendHandover(saliente, { shiftId: turno.id });

    const participation = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: turno.id, userId: saliente.id },
    });
    expect(participation.leftAt).toBeNull();
    expect((await getMyActiveShift(saliente.id))?.status).toBe(ShiftStatus.ENTREGA_ENVIADA);

    await expect(
      openShift(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/saliente todavía no está cerrado/i);
  });

  it('después del cierre la entrega queda libre, se recibe y recién entonces abre el siguiente turno', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    const turno = await activate(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, turno.id);
    await sendHandover(saliente, { shiftId: turno.id });
    await closeShift(saliente, { shiftId: turno.id });

    const closedParticipation = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: turno.id, userId: saliente.id },
    });
    expect(closedParticipation.leftAt).toBeInstanceOf(Date);

    await expect(
      openShift(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/entrega.*pendiente de recepción/i);

    expect((await getPendingHandover())?.id).toBe(handover.id);
    const received = await receiveHandover(entrante, { handoverId: handover.id });
    expect(received.status).toBe('RECIBIDA');
    expect(received.toShiftId).toBeNull();

    const { shift: incoming } = await openShift(entrante, { type: ShiftType.NOCHE });
    expect(incoming.status).toBe(ShiftStatus.ACTIVO);

    const linked = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(linked.toShiftId).toBe(incoming.id);
  });
});
