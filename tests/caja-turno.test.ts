import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  ensureShift,
  prepareHandover,
  receiveHandover,
  sendHandover,
  startShift,
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
    [find('CLP', 20_000)]: 5, // 100.000
    [find('USD', 100)]: 1,
    [find('USD', 50)]: 1, // 150
  };
}

async function openShift(user: CurrentUser, type: ShiftType) {
  const shift = await ensureShift(new Date(), type);
  await startShift(user, shift);
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
    /*
      La migración siembra el fondo fijo para producción. Si `resetOperationalData`
      no lo limpiara, este conjunto daría resultados distintos según el orden en
      que Vitest ejecutara los archivos: las pruebas del ciclo de turno fallarían
      cuando corrieran después de la migración y antes que este archivo.
    */
    expect(await prisma.cashFund.count()).toBe(0);
    expect(await prisma.handoverElementType.count()).toBe(0);
    // Las denominaciones SÍ son catálogo y se conservan.
    expect(await prisma.cashDenomination.count()).toBeGreaterThan(0);
  });

  it('sin fondo configurado la caja no existe y no bloquea nada', async () => {
    expect(await isCashEnabled()).toBe(false);

    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    expect(await cashBlockersForReceiving(handover.id)).toEqual([]);

    // Y la entrega se envía sin haber contado un peso.
    const sent = await sendHandover(saliente, { shiftId: shift.id });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
  });

  it('con fondo configurado no se puede entregar sin arquear', async () => {
    await seedFunds();
    expect(await isCashEnabled()).toBe(true);

    const shift = await openShift(saliente, ShiftType.MANANA);
    await prepareHandover(saliente, shift.id);

    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /Falta el arqueo de caja/,
    );
  });

  it('un arqueo que cuadra con el fondo permite entregar', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.MANANA);
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
    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);
    const denominations = await prisma.cashDenomination.findMany();
    const clp20 = denominations.find(
      (d) => d.currency === 'CLP' && Number(d.value) === 20_000,
    )!;

    // Falta un billete de 20.000 y todo el USD.
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: { [clp20.id]: 4 },
    });
    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /no coincide con el fondo fijo/,
    );

    /*
      Un faltante existe y hay que poder declararlo: lo que no se admite es
      que nadie diga nada. Con una explicación, la entrega sale y la
      diferencia queda escrita.
    */
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
    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);
    const quantities = await exactFundQuantities();

    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });
    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });

    const counts = await prisma.cashCount.findMany({ where: { handoverId: handover.id } });
    expect(counts).toHaveLength(1);
  });

  it('quien recibe tiene que contar la caja antes de confirmar la recepción', async () => {
    await seedFunds();
    const manana = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, manana.id);
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });
    await sendHandover(saliente, { shiftId: manana.id });

    const tarde = await ensureShift(new Date(), ShiftType.TARDE);
    await startShift(entrante, tarde);

    await expect(receiveHandover(entrante, { shiftId: tarde.id })).rejects.toThrow(
      /Cuenta la caja y confirma el fondo fijo/,
    );

    await saveCashCount(entrante, {
      handoverId: handover.id,
      kind: 'CONFIRMADO',
      quantities: await exactFundQuantities(),
    });

    const received = await receiveHandover(entrante, { shiftId: tarde.id });
    expect(received.status).toBe('ACTIVO');
  });

  it('la diferencia entre los dos conteos se calcula y no se almacena', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.MANANA);
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
    await saveCashCount(entrante, {
      handoverId: handover.id,
      kind: 'CONFIRMADO',
      quantities: { [clp20.id]: 4 },
      notes: 'Conté un billete menos.',
    });

    const state = await getHandoverCashState(handover.id);

    expect(state.discrepancies).toHaveLength(1);
    expect(state.discrepancies[0]?.currency).toBe('CLP');
    expect(state.discrepancies[0]?.differenceMinor).toBe(-20_000);

    // No hay columna que la guarde: sale de comparar los dos conteos.
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'CashCount'
    `;
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('difference');
    expect(names).not.toContain('differenceMinor');
  });

  it('el excedente sobre el fondo se registra como egreso a tesorería', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.MANANA);
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

  it('un egreso sin monto o con divisa inválida se rechaza', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);

    await expect(
      recordCashTransfer(saliente, { handoverId: handover.id, currency: 'CLP', amount: 0 }),
    ).rejects.toThrow(RuleError);
    await expect(
      recordCashTransfer(saliente, { handoverId: handover.id, currency: 'PESOS', amount: 100 }),
    ).rejects.toThrow(/tres letras/);
  });

  it('un arqueo con una denominación inventada se rechaza', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.MANANA);
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

    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);

    let state = await getHandoverCashState(handover.id);
    expect(state.elements.map((element) => element.name).sort()).toEqual([
      'Llaves maestras',
      'Radio de turno',
    ]);

    // Regenerar el borrador no duplica ni borra marcas.
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

    const shift = await openShift(saliente, ShiftType.MANANA);
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

    const shift = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, shift.id);
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
  });

  it('quien recibe confirma los elementos, y sin eso no recibe', async () => {
    await seedFunds();
    await seedElement('Radio de turno');

    const manana = await openShift(saliente, ShiftType.MANANA);
    const handover = await prepareHandover(saliente, manana.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, { handoverId: handover.id, kind: 'DECLARADO', quantities });

    let state = await getHandoverCashState(handover.id);
    await markHandoverElements(saliente, {
      handoverId: handover.id,
      field: 'declared',
      marks: { [state.elements[0]!.id]: true },
    });
    await sendHandover(saliente, { shiftId: manana.id });

    const tarde = await ensureShift(new Date(), ShiftType.TARDE);
    await startShift(entrante, tarde);
    await saveCashCount(entrante, { handoverId: handover.id, kind: 'CONFIRMADO', quantities });

    await expect(receiveHandover(entrante, { shiftId: tarde.id })).rejects.toThrow(
      /Confirma que recibes: Radio de turno/,
    );

    state = await getHandoverCashState(handover.id);
    await markHandoverElements(entrante, {
      handoverId: handover.id,
      field: 'confirmed',
      marks: { [state.elements[0]!.id]: true },
    });

    const received = await receiveHandover(entrante, { shiftId: tarde.id });
    expect(received.status).toBe('ACTIVO');
  });

  it('marcar un elemento de otra entrega no hace nada', async () => {
    await seedElement('Llaves maestras');
    const shift = await openShift(saliente, ShiftType.MANANA);
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
