import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import {
  prepareHandover,
  receiveHandover,
  receiveShiftCash,
  sendHandover,
} from '@/server/services/shifts';
import {
  cashBlockersForReceiving,
  cashBlockersForSending,
  getHandoverCashState,
  isCashEnabled,
  markHandoverElements,
  recordCashTransfer,
  saveCashCount,
} from '@/server/services/cash';
import { RuleError } from '@/server/errors';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * La caja en el ciclo del turno.
 *
 * La regla que gobierna todo este archivo: **la exigencia de arqueo se activa
 * con el fondo fijo**. Sin `CashFund`, entregar y recibir funcionan igual que
 * antes de que el módulo existiera —eso es lo que deja intactas las pruebas
 * del ciclo de turno— y en cuanto el hotel configura un fondo, contar la caja
 * pasa a ser obligatorio en los dos extremos.
 */

/** CLP 100.000 y USD 150, el fondo real del hotel. */
async function seedFunds() {
  await prisma.cashFund.createMany({
    data: [
      { currency: 'CLP', amount: 100_000 },
      { currency: 'USD', amount: 150 },
    ],
    skipDuplicates: true,
  });
}

async function seedElement(name: string, required = true) {
  return prisma.handoverElementType.upsert({
    where: { name },
    update: { required, active: true },
    create: { name, required, active: true },
  });
}

/** Cantidades que suman exactamente el fondo fijo. */
async function exactFundQuantities(): Promise<Record<string, number>> {
  const denominations = await prisma.cashDenomination.findMany();
  const find = (currency: string, value: number) => {
    const row = denominations.find(
      (d) => d.currency === currency && Number(d.value) === value,
    );
    if (!row) throw new Error(`Falta la denominación ${currency} ${value}`);
    return row.id;
  };
  return {
    [find('CLP', 20_000)]: 5,
    [find('USD', 100)]: 1,
    [find('USD', 50)]: 1,
  };
}

async function openShift(user: CurrentUser, type: ShiftType) {
  const shift = await openShiftAs(user, { type });
  await receiveHandover(user, { shiftId: shift.id });
  return prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
}

describe('caja en la entrega de turno', () => {
  let saliente: CurrentUser & { username: string };
  let entrante: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('el reinicio de pruebas deja la caja apagada, sin depender del orden de los archivos', async () => {
    expect(await prisma.cashFund.count()).toBe(0);
    expect(await prisma.handoverElementType.count()).toBe(0);
    expect(await prisma.cashDenomination.count()).toBeGreaterThan(0);
  });

  it('sin fondo configurado la caja no existe y no bloquea nada', async () => {
    expect(await isCashEnabled()).toBe(false);

    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    expect(await cashBlockersForReceiving(handover.id)).toEqual([]);

    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('con fondo configurado no se puede entregar sin arquear', async () => {
    await seedFunds();
    expect(await isCashEnabled()).toBe(true);

    const shift = await openShift(saliente, ShiftType.DIA);
    await prepareHandover(saliente, shift.id);

    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /Falta el arqueo de caja/,
    );
  });

  it('un arqueo que cuadra con el fondo permite entregar', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('una caja descuadrada sin explicación no se entrega; con explicación sí', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    const denominations = await prisma.cashDenomination.findMany();
    const clp20 = denominations.find(
      (d) => d.currency === 'CLP' && Number(d.value) === 20_000,
    )!;

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [clp20.id]: 4 },
    });
    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /no coincide con el fondo fijo/,
    );

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [clp20.id]: 4 },
      notes: 'Faltan 20.000 y los dólares: se entregaron a tesorería sin comprobante.',
    });
    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('recontar reemplaza el arqueo anterior en vez de acumular dos', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    const quantities = await exactFundQuantities();

    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });
    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });

    const counts = await prisma.cashCount.findMany({ where: { handoverId: handover.id } });
    expect(counts).toHaveLength(1);
  });

  it('el entrante recibe la Caja mientras la entrega completa sigue en BORRADOR', async () => {
    await seedFunds();
    const manana = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, manana.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });

    const tarde = await openShiftAs(entrante, { type: ShiftType.DIA });
    const result = await receiveShiftCash(entrante, {
      shiftId: tarde.id,
      handoverId: handover.id,
      quantities,
    });

    expect(result.shift.status).toBe('ACTIVO');
    const stillDraft = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(stillDraft.status).toBe(HandoverStatus.BORRADOR);
    expect(stillDraft.receivedAt).toBeNull();
    expect(stillDraft.toShiftId).toBe(tarde.id);

    const outgoing = await prisma.shift.findUniqueOrThrow({ where: { id: manana.id } });
    expect(outgoing.status).toBe('PREPARANDO_ENTREGA');
  });

  it('la diferencia se calcula, genera alerta y no bloquea al entrante', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    const denominations = await prisma.cashDenomination.findMany();
    const clp20 = denominations.find(
      (d) => d.currency === 'CLP' && Number(d.value) === 20_000,
    )!;

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [clp20.id]: 5 },
      notes: 'Sin dólares en caja.',
    });

    const tarde = await openShiftAs(entrante, { type: ShiftType.NOCHE });
    const result = await receiveShiftCash(entrante, {
      shiftId: tarde.id,
      handoverId: handover.id,
      quantities: { [clp20.id]: 4 },
      notes: 'Conté un billete menos.',
    });

    expect(result.shift.status).toBe('ACTIVO');
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.differenceMinor).toBe(-20_000);

    const state = await getHandoverCashState(handover.id);
    expect(state.discrepancies[0]?.currency).toBe('CLP');

    const alert = await prisma.alert.findUnique({
      where: { dedupeKey: `cash-difference:${handover.id}` },
    });
    expect(alert?.status).toBe('NUEVA');

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'CashCount'
    `;
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('difference');
    expect(names).not.toContain('differenceMinor');
  });

  it('el excedente sobre el fondo se registra como egreso a tesorería', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await recordCashTransfer(saliente, {
      handoverId: handover.id,
      currency: 'clp',
      amount: 260_000,
      reference: 'SOBRE-0912',
    });

    const state = await getHandoverCashState(handover.id);
    expect(state.transfers).toHaveLength(1);
    expect(state.transfers[0]?.currency).toBe('CLP');
    expect(state.transfers[0]?.amount).toBe(260_000);
    expect(state.transfers[0]?.reference).toBe('SOBRE-0912');
  });

  it('un egreso pendiente de revisión de Supervisión no bloquea el envío', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    const quantities = await exactFundQuantities();

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });
    await recordCashTransfer(saliente, {
      handoverId: handover.id,
      currency: 'CLP',
      amount: 10_000,
      reference: 'SOBRE-PENDIENTE',
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('un egreso sin monto o con divisa inválida se rechaza', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await expect(
      recordCashTransfer(saliente, { handoverId: handover.id, currency: 'CLP', amount: 0 }),
    ).rejects.toThrow(RuleError);
    await expect(
      recordCashTransfer(saliente, { handoverId: handover.id, currency: 'PESOS', amount: 100 }),
    ).rejects.toThrow(/CLP o USD/);
  });

  it('un arqueo con una denominación inventada se rechaza', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await expect(
      saveCashCount(saliente, {
        handoverId: handover.id,
        kind: 'DECLARADO',
        quantities: { 'no-existe': 3 },
      }),
    ).rejects.toThrow(/no existe/);
  });
});

describe('elementos que viajan con la caja', () => {
  let saliente: CurrentUser & { username: string };
  let entrante: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('preparar la entrega materializa los elementos configurados, sin duplicarlos', async () => {
    await seedElement('Llaves maestras');
    await seedElement('Radio de turno');

    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    let state = await getHandoverCashState(handover.id);
    expect(state.elements.map((element) => element.name).sort()).toEqual([
      'Llaves maestras',
      'Radio de turno',
    ]);

    await markHandoverElements(saliente, {
      handoverId: handover.id,
      field: 'declared',
      marks: { [state.elements[0]!.id]: true },
    });
    await prepareHandover(saliente, shift.id);

    state = await getHandoverCashState(handover.id);
    expect(state.elements).toHaveLength(2);
    expect(state.elements.filter((element) => element.declared)).toHaveLength(1);
  });

  it('un elemento obligatorio sin declarar impide entregar', async () => {
    await seedFunds();
    await seedElement('Llaves maestras');

    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });

    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /Falta declarar: Llaves maestras/,
    );
  });

  it('un elemento opcional no impide entregar', async () => {
    await seedFunds();
    await seedElement('Cargador de cortesía', false);

    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
  });

  it('los elementos físicos pendientes no bloquean Caja ni recepción operativa', async () => {
    await seedFunds();
    await seedElement('Radio de turno');

    const manana = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, manana.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });

    const state = await getHandoverCashState(handover.id);
    await markHandoverElements(saliente, {
      handoverId: handover.id,
      field: 'declared',
      marks: { [state.elements[0]!.id]: true },
    });

    const tarde = await openShiftAs(entrante, { type: ShiftType.DIA });
    await receiveShiftCash(entrante, {
      shiftId: tarde.id,
      handoverId: handover.id,
      quantities,
    });

    const sent = await sendHandover(saliente, { shiftId: manana.id });
    expect(await cashBlockersForReceiving(handover.id)).toEqual([]);

    const received = await receiveHandover(entrante, {
      shiftId: tarde.id,
      handoverId: sent.id,
    });
    expect(received.status).toBe('ACTIVO');

    const after = await getHandoverCashState(handover.id);
    expect(after.elements[0]?.declared).toBe(true);
    expect(after.elements[0]?.confirmed).toBe(false);
  });

  it('marcar un elemento de otra entrega no hace nada', async () => {
    await seedElement('Llaves maestras');
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    const result = await markHandoverElements(saliente, {
      handoverId: handover.id,
      field: 'confirmed',
      marks: { 'id-de-otra-entrega': true },
    });

    expect(result.updated).toBe(0);
    const state = await getHandoverCashState(handover.id);
    expect(state.elements.every((element) => !element.confirmed)).toBe(true);
  });
});
