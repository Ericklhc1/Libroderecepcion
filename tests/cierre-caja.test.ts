import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { prepareHandover, receiveHandover } from '@/server/services/shifts';
import { saveCashCount } from '@/server/services/cash';
import {
  closeShiftCash,
  getShiftCashClosure,
  reopenShiftCash,
} from '@/server/services/cash-closure';
import type { CurrentUser } from '@/server/auth/current-user';

async function activeShift(user: CurrentUser) {
  const shift = await openShiftAs(user, { type: ShiftType.DIA });
  await receiveHandover(user, { shiftId: shift.id });
  return prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
}

describe('cierre de Caja previo al cierre del turno', () => {
  let recepcionista: CurrentUser;
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    recepcionista = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción' });
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisión' });
  });

  it('impide cerrar un turno con fondo activo si Caja aún no fue cerrada', async () => {
    const shift = await activeShift(recepcionista);
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });

    await expect(
      prisma.shift.update({ where: { id: shift.id }, data: { status: ShiftStatus.CERRADO } }),
    ).rejects.toThrow(/cerrar Caja/i);
  });

  it('usa el arqueo formal por denominación de la entrega y congela su fotografía', async () => {
    const shift = await activeShift(recepcionista);
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const denomination = await prisma.cashDenomination.upsert({
      where: { currency_value: { currency: 'CLP', value: 100_000 } },
      create: { currency: 'CLP', value: 100_000, medium: 'BILLETE', order: 0 },
      update: { active: true },
    });
    const handover = await prepareHandover(recepcionista, shift.id);

    await expect(closeShiftCash(recepcionista, { shiftId: shift.id })).rejects.toThrow(
      /Falta el arqueo formal por denominación/i,
    );

    await saveCashCount(recepcionista, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [denomination.id]: 1 },
      notes: 'Conteo final conforme.',
    });

    const closure = await closeShiftCash(recepcionista, {
      shiftId: shift.id,
      notes: 'Caja conforme.',
    });
    expect(closure.snapshot.currencies).toHaveLength(1);
    expect(closure.snapshot.currencies[0]?.difference).toBe(0);
    expect(closure.snapshot.currencies[0]?.counted).toBe(100_000);
    expect((await getShiftCashClosure(shift.id))?.reopenedAt).toBeNull();

    const closed = await prisma.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.CERRADO },
    });
    expect(closed.status).toBe(ShiftStatus.CERRADO);
  });

  it('una reapertura invalida el cierre anterior hasta volver a cuadrar y cerrar Caja', async () => {
    const shift = await activeShift(recepcionista);
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const denomination = await prisma.cashDenomination.upsert({
      where: { currency_value: { currency: 'CLP', value: 100_000 } },
      create: { currency: 'CLP', value: 100_000, medium: 'BILLETE', order: 0 },
      update: { active: true },
    });
    const handover = await prepareHandover(recepcionista, shift.id);
    await saveCashCount(recepcionista, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [denomination.id]: 1 },
    });
    await closeShiftCash(recepcionista, { shiftId: shift.id });

    await reopenShiftCash(supervisor, {
      shiftId: shift.id,
      reason: 'Se requiere revisar nuevamente el efectivo físico.',
    });

    expect((await getShiftCashClosure(shift.id))?.reopenedAt).toBeInstanceOf(Date);
    await expect(
      prisma.shift.update({ where: { id: shift.id }, data: { status: ShiftStatus.CERRADO } }),
    ).rejects.toThrow(/cerrar Caja/i);
  });
});