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
  closeShift,
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
import { closeShiftCash } from '@/server/services/cash-closure';
import { insertCashMovement } from '@/server/services/live-cash';
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
      /no coincide con el efectivo esperado/,
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

  it('el receptor recuenta Caja después del cierre, recibe la entrega y recién entonces abre su turno', async () => {
    await seedFunds();
    const manana = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, manana.id);
    const quantities = await exactFundQuantities();

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });
    await closeShiftCash(saliente, { shiftId: manana.id });
    await sendHandover(saliente, { shiftId: manana.id });
    await closeShift(saliente, { shiftId: manana.id });

    await expect(
      openShiftAs(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/entrega.*pendiente de recepción/i);

    const result = await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities,
    });
    expect(result.discrepancies).toEqual([]);

    const sent = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
    expect(sent.receivedAt).toBeNull();
    expect(sent.toShiftId).toBeNull();

    const outgoing = await prisma.shift.findUniqueOrThrow({ where: { id: manana.id } });
    expect(outgoing.status).toBe('CERRADO');

    await receiveHandover(entrante, { handoverId: handover.id });
    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBeNull();

    const tarde = await openShiftAs(entrante, { type: ShiftType.NOCHE });
    expect(tarde.status).toBe('ACTIVO');

    const linked = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(linked.toShiftId).toBe(tarde.id);
  });

  it('la diferencia se calcula, genera alerta y la entrega sigue sin preasignar un turno', async () => {
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
    await closeShiftCash(saliente, {
      shiftId: shift.id,
      notes: 'Diferencia declarada y documentada.',
    });
    await sendHandover(saliente, { shiftId: shift.id });
    await closeShift(saliente, { shiftId: shift.id });

    const result = await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities: { [clp20.id]: 4 },
      notes: 'Conté un billete menos.',
    });

    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.differenceMinor).toBe(-20_000);

    const state = await getHandoverCashState(handover.id);
    expect(state.discrepancies[0]?.currency).toBe('CLP');

    const alert = await prisma.alert.findUnique({
      where: { dedupeKey: `cash-difference:${handover.id}` },
    });
    expect(alert?.status).toBe('NUEVA');

    await receiveHandover(entrante, {
      handoverId: handover.id,
      observations: 'Diferencia recibida y escalada.',
    });
    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBeNull();

    const tarde = await openShiftAs(entrante, { type: ShiftType.NOCHE });
    expect(tarde.status).toBe('ACTIVO');

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'CashCount'
    `;
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('difference');
    expect(names).not.toContain('differenceMinor');
  });

  it('Tesorería recibe sólo saldo operacional y la salida queda como transferencia interna', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await insertCashMovement(prisma, {
      userId: saliente.id,
      kind: 'AJUSTE_ENTRADA',
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 260_000,
      shiftId: shift.id,
      reference: 'Recaudación del turno',
    });

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

    const movement = await prisma.cashMovement.findUniqueOrThrow({
      where: { cashTransferId: state.transfers[0]!.id },
    });
    expect(movement.kind).toBe('TESORERIA');
    expect(movement.direction).toBe('SALIDA');
    expect(movement.amount.toNumber()).toBe(260_000);
    expect(movement.shiftId).toBe(shift.id);

    const after = await getHandoverCashState(handover.id);
    const clp = after.currentExpectations.find((row) => row.currency === 'CLP');
    expect(clp?.operationalMinor).toBe(0);
    expect(clp?.expectedMinor).toBe(100_000);
  });

  it('Tesorería no puede retirar fondo fijo si no hay saldo operacional', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await expect(
      recordCashTransfer(saliente, {
        handoverId: handover.id,
        currency: 'CLP',
        amount: 10_000,
        reference: 'NO-DEBE-SALIR',
      }),
    ).rejects.toThrow(/saldo operacional disponible/i);
  });

  it('una transferencia revisable por Supervisión no bloquea el envío si el arqueo es posterior', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await insertCashMovement(prisma, {
      userId: saliente.id,
      kind: 'AJUSTE_ENTRADA',
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 10_000,
      shiftId: shift.id,
      reference: 'Recaudación disponible',
    });
    await recordCashTransfer(saliente, {
      handoverId: handover.id,
      currency: 'CLP',
      amount: 10_000,
      reference: 'SOBRE-PENDIENTE',
    });

    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('una transferencia sin monto o con divisa inválida se rechaza', async () => {
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

  it('los elementos físicos pendientes quedan documentados sin saltarse el relevo secuencial', async () => {
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

    await closeShiftCash(saliente, { shiftId: manana.id });
    const sent = await sendHandover(saliente, { shiftId: manana.id });
    await closeShift(saliente, { shiftId: manana.id });

    await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities,
    });

    expect(await cashBlockersForReceiving(handover.id)).toEqual([]);

    await receiveHandover(entrante, {
      handoverId: sent.id,
    });
    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBeNull();

    const tarde = await openShiftAs(entrante, { type: ShiftType.NOCHE });
    expect(tarde.status).toBe('ACTIVO');

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
