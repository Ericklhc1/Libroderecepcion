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
import { closeShift, prepareHandover, receiveHandover } from '@/server/services/shifts';
import { getHandoverCashState, saveCashCount } from '@/server/services/cash';
import { saveLiveCashAudit } from '@/server/services/live-cash';
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

  it('el flujo de Turno devuelve una regla legible antes de llegar al trigger de PostgreSQL', async () => {
    const shift = await activeShift(recepcionista);
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    await prisma.shiftHandover.create({
      data: {
        fromShiftId: shift.id,
        issuedById: recepcionista.id,
        status: 'ENVIADA',
        issuedAt: new Date(),
      },
    });
    await prisma.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.ENTREGA_ENVIADA },
    });

    await expect(closeShift(recepcionista, { shiftId: shift.id })).rejects.toThrow(
      /cierre formal de Caja/i,
    );

    const unchanged = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(unchanged.status).toBe(ShiftStatus.ENTREGA_ENVIADA);
    expect(unchanged.actualEnd).toBeNull();
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

  it('separa fondo fijo por denominación de garantías validadas individualmente', async () => {
    const shift = await activeShift(recepcionista);
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const denomination = await prisma.cashDenomination.upsert({
      where: { currency_value: { currency: 'CLP', value: 100_000 } },
      create: { currency: 'CLP', value: 100_000, medium: 'BILLETE', order: 0 },
      update: { active: true },
    });
    const guarantee = await prisma.guarantee.create({
      data: {
        kind: 'EFECTIVO',
        state: 'VIGENTE',
        amount: 50_000,
        currency: 'CLP',
        guestName: 'Huésped garantía',
        roomNumber: '501',
        createdById: recepcionista.id,
      },
    });
    const handover = await prepareHandover(recepcionista, shift.id);

    await expect(
      saveCashCount(recepcionista, {
        handoverId: handover.id,
        kind: 'DECLARADO',
        quantities: { [denomination.id]: 1 },
      }),
    ).rejects.toThrow(/validar físicamente todas las garantías/i);

    const result = await saveCashCount(recepcionista, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [denomination.id]: 1 },
      guaranteeIds: [guarantee.id],
    });

    expect(result.statuses[0]?.countedMinor).toBe(100_000);
    expect(result.statuses[0]?.expectedMinor).toBe(100_000);
    expect(result.statuses[0]?.differenceMinor).toBe(0);

    const state = await getHandoverCashState(handover.id);
    expect(state.declared?.validatedGuarantees).toHaveLength(1);
    expect(state.declared?.validatedGuarantees[0]?.id).toBe(guarantee.id);
    expect(state.declared?.validatedGuarantees[0]?.amountMinor).toBe(50_000);

    const closure = await closeShiftCash(recepcionista, { shiftId: shift.id });
    expect(closure.snapshot.currencies[0]?.fund).toBe(100_000);
    expect(closure.snapshot.currencies[0]?.counted).toBe(100_000);
    expect(closure.snapshot.currencies[0]?.difference).toBe(0);
    expect(closure.snapshot.guarantees).toHaveLength(1);
    expect(closure.snapshot.guarantees[0]?.amount).toBe(50_000);
  });

  it('el arqueo directo de Caja compara denominaciones sólo contra el fondo fijo', async () => {
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    const guarantee = await prisma.guarantee.create({
      data: {
        kind: 'EFECTIVO',
        state: 'VIGENTE',
        amount: 50_000,
        currency: 'CLP',
        guestName: 'Garantía directa',
        createdById: recepcionista.id,
      },
    });

    await expect(
      saveLiveCashAudit(recepcionista, {
        currency: 'CLP',
        countedAmount: 100_000,
        guaranteeIds: [],
      }),
    ).rejects.toThrow(/validar físicamente todas las garantías/i);

    const result = await saveLiveCashAudit(recepcionista, {
      currency: 'CLP',
      countedAmount: 100_000,
      guaranteeIds: [guarantee.id],
    });

    expect(result.expected).toBe(100_000);
    expect(result.difference).toBe(0);
    expect(result.guaranteeCount).toBe(1);

    const audit = await prisma.cashAudit.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.expectedAmount.toNumber()).toBe(100_000);
    expect(audit.countedAmount.toNumber()).toBe(100_000);
    expect(audit.difference.toNumber()).toBe(0);
    expect(audit.guaranteeSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: guarantee.id, amount: 50_000 }),
      ]),
    );
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