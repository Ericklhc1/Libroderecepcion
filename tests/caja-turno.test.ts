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
  cancelHandoverPreparation,
  closeShift,
  confirmHandoverReviewStep,
  confirmReceptionReviewStep,
  openShift as openOperationalShift,
  prepareHandover,
  receiveHandover,
  receiveShiftCash,
  sendHandover,
  startReceptionShift,
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
import { closeShiftCash, getShiftCashClosure } from '@/server/services/cash-closure';
import { insertCashMovement } from '@/server/services/live-cash';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  assertReceptionOperationPermission,
  getReceptionOperationGate,
} from '@/server/services/reception-operation-gate';

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

async function confirmReview(user: CurrentUser, handoverId: string) {
  await confirmHandoverReviewStep(user, { handoverId, step: 'PENDINGS' });
  await confirmHandoverReviewStep(user, { handoverId, step: 'FINAL' });
}

async function beginReception(
  user: CurrentUser,
  handoverId: string,
  type: ShiftType = ShiftType.NOCHE,
) {
  const shift = await startReceptionShift(user, { handoverId, type });
  await confirmReceptionReviewStep(user, { handoverId, step: 'BRIEFING' });
  return shift;
}

async function finishReceptionReview(user: CurrentUser, handoverId: string) {
  await confirmReceptionReviewStep(user, { handoverId, step: 'CUSTODY' });
  const urgentCount = await prisma.handoverItem.count({
    where: { handoverId, level: 'URGENTE' },
  });
  await confirmReceptionReviewStep(user, {
    handoverId,
    step: 'FINAL',
    urgentAcknowledged: urgentCount > 0,
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

    await confirmReview(saliente, handover.id);
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

  it('un arqueo que cuadra requiere además cierre formal de Caja antes de entregar', async () => {
    await seedFunds();
    const shift = await openShift(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, shift.id);

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });

    expect(await cashBlockersForSending(handover.id)).toEqual([]);
    await expect(sendHandover(saliente, { shiftId: shift.id })).rejects.toThrow(
      /cierre formal de Caja/i,
    );
    await closeShiftCash(saliente, { shiftId: shift.id });
    await confirmReview(saliente, handover.id);
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
    await closeShiftCash(saliente, { shiftId: shift.id });
    await confirmReview(saliente, handover.id);
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
    await confirmReview(saliente, handover.id);
    await sendHandover(saliente, { shiftId: manana.id });
    await closeShift(saliente, { shiftId: manana.id });

    await expect(
      openShiftAs(entrante, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/entrega.*pendiente de recepción/i);

    const tarde = await beginReception(entrante, handover.id);
    expect(tarde.status).toBe('INICIADO');

    const result = await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities,
    });
    expect(result.discrepancies).toEqual([]);
    expect(result.shiftId).toBe(tarde.id);

    const sent = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(sent.status).toBe(HandoverStatus.ENVIADA);
    expect(sent.receivedAt).toBeNull();
    expect(sent.toShiftId).toBe(tarde.id);

    const outgoing = await prisma.shift.findUniqueOrThrow({ where: { id: manana.id } });
    expect(outgoing.status).toBe('CERRADO');

    await finishReceptionReview(entrante, handover.id);
    await receiveHandover(entrante, { handoverId: handover.id });

    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBe(tarde.id);

    const active = await prisma.shift.findUniqueOrThrow({ where: { id: tarde.id } });
    expect(active.status).toBe('ACTIVO');
  });

  it('tras abrir emergencia, el saliente conserva acceso exclusivo a Caja y puede cerrar sin abrir otro turno', async () => {
    await seedFunds();

    const outgoing = await openShift(saliente, ShiftType.DIA);
    const quantities = await exactFundQuantities();

    const emergency = await openOperationalShift(entrante, {
      type: ShiftType.NOCHE,
      continuity: true,
      emergencyReason: 'FALLA_TECNICA',
      emergencyAccepted: true,
    });
    expect(emergency.shift.status).toBe('ACTIVO');
    expect(emergency.shift.emergency).toBe(true);
    expect(emergency.shift.emergencySourceShiftId).toBe(outgoing.id);

    const parked = await prisma.shift.findUniqueOrThrow({
      where: { id: outgoing.id },
      include: { handoverOut: true },
    });
    expect(parked.status).toBe('ENTREGA_ENVIADA');
    expect(parked.handoverOut?.toShiftId).toBe(emergency.shift.id);

    const gate = await getReceptionOperationGate(saliente);
    expect(gate.mode).toBe('CLOSING');
    expect(gate.shiftId).toBe(outgoing.id);
    await expect(
      assertReceptionOperationPermission(saliente, 'cash.count_declare'),
    ).resolves.toBeUndefined();
    await expect(
      assertReceptionOperationPermission(saliente, 'cash.close'),
    ).resolves.toBeUndefined();

    const handoverId = parked.handoverOut!.id;
    await saveCashCount(saliente, {
      handoverId,
      kind: 'DECLARADO',
      quantities,
    });

    const custody = await getHandoverCashState(handoverId);
    const declaredMarks = Object.fromEntries(
      custody.elements.map((element) => [element.id, element.required]),
    );
    if (custody.elements.length > 0) {
      await markHandoverElements(saliente, {
        handoverId,
        field: 'declared',
        marks: declaredMarks,
        notes: Object.fromEntries(
          custody.elements
            .filter((element) => !element.required)
            .map((element) => [element.id, 'Elemento opcional no entregado.']),
        ),
      });
    }

    await closeShiftCash(saliente, { shiftId: outgoing.id });
    const closed = await closeShift(saliente, { shiftId: outgoing.id });
    expect(closed.status).toBe('CERRADO');

    const normalized = await prisma.shift.findUniqueOrThrow({
      where: { id: emergency.shift.id },
    });
    expect(normalized.status).toBe('ACTIVO');
    expect(normalized.emergency).toBe(false);
    expect(normalized.emergencyResolvedAt).not.toBeNull();
    expect(normalized.emergencySourceShiftId).toBe(outgoing.id);

    await confirmReceptionReviewStep(entrante, { handoverId, step: 'BRIEFING' });
    await receiveShiftCash(entrante, { handoverId, quantities });

    const toConfirm = await getHandoverCashState(handoverId);
    if (toConfirm.elements.some((element) => element.declared)) {
      await markHandoverElements(entrante, {
        handoverId,
        field: 'confirmed',
        marks: Object.fromEntries(
          toConfirm.elements.map((element) => [element.id, element.declared]),
        ),
      });
    }

    await finishReceptionReview(entrante, handoverId);
    await receiveHandover(entrante, { handoverId });

    const received = await prisma.shiftHandover.findUniqueOrThrow({
      where: { id: handoverId },
    });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBe(emergency.shift.id);
    expect(received.receivedById).toBe(entrante.id);
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
    await confirmReview(saliente, handover.id);
    await sendHandover(saliente, { shiftId: shift.id });
    await closeShift(saliente, { shiftId: shift.id });

    const tarde = await beginReception(entrante, handover.id);

    const result = await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities: { [clp20.id]: 4 },
      notes: 'Conté un billete menos.',
    });

    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]?.differenceMinor).toBe(-20_000);
    expect(result.shiftId).toBe(tarde.id);

    const state = await getHandoverCashState(handover.id);
    expect(state.discrepancies[0]?.currency).toBe('CLP');

    const alert = await prisma.alert.findUnique({
      where: { dedupeKey: `cash-difference:${handover.id}` },
    });
    expect(alert?.status).toBe('NUEVA');

    await finishReceptionReview(entrante, handover.id);
    await receiveHandover(entrante, {
      handoverId: handover.id,
      observations: 'Diferencia recibida y escalada.',
    });
    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBe(tarde.id);

    const active = await prisma.shift.findUniqueOrThrow({ where: { id: tarde.id } });
    expect(active.status).toBe('ACTIVO');

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

  it('cancelar el cierre conserva transferencias reales y reabre la Caja formal', async () => {
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
      reference: 'Recaudación antes de cancelar cierre',
    });
    const transfer = await recordCashTransfer(saliente, {
      handoverId: handover.id,
      currency: 'CLP',
      amount: 10_000,
      reference: 'SOBRE-CANCELACION',
    });

    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities: await exactFundQuantities(),
    });
    await closeShiftCash(saliente, { shiftId: shift.id });
    expect((await getShiftCashClosure(shift.id))?.reopenedAt).toBeNull();

    await cancelHandoverPreparation(saliente, shift.id);

    expect(await prisma.cashTransfer.findUnique({ where: { id: transfer.id } })).not.toBeNull();
    expect(
      await prisma.cashMovement.findUnique({ where: { cashTransferId: transfer.id } }),
    ).not.toBeNull();
    expect(await prisma.cashCount.count({ where: { handoverId: handover.id } })).toBe(0);
    expect((await getShiftCashClosure(shift.id))?.reopenedAt).not.toBeNull();

    const preparedAgain = await prepareHandover(saliente, shift.id);
    expect(preparedAgain.id).toBe(handover.id);
    const state = await getHandoverCashState(handover.id);
    expect(state.transfers.map((row) => row.id)).toContain(transfer.id);
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
    await closeShiftCash(saliente, { shiftId: shift.id });
    await confirmReview(saliente, handover.id);
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
    await confirmReview(saliente, handover.id);
    const sent = await sendHandover(saliente, { shiftId: manana.id });
    await closeShift(saliente, { shiftId: manana.id });

    const tarde = await beginReception(entrante, handover.id);

    await receiveShiftCash(entrante, {
      handoverId: handover.id,
      quantities,
    });

    expect(await cashBlockersForReceiving(handover.id)).toEqual([
      expect.stringMatching(/Radio de turno/),
    ]);

    const beforeCustody = await getHandoverCashState(handover.id);
    await markHandoverElements(entrante, {
      handoverId: handover.id,
      field: 'confirmed',
      marks: { [beforeCustody.elements[0]!.id]: true },
    });

    expect(await cashBlockersForReceiving(handover.id)).toEqual([]);
    await finishReceptionReview(entrante, handover.id);
    await receiveHandover(entrante, {
      handoverId: sent.id,
    });

    const received = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    expect(received.status).toBe(HandoverStatus.RECIBIDA);
    expect(received.toShiftId).toBe(tarde.id);

    const active = await prisma.shift.findUniqueOrThrow({ where: { id: tarde.id } });
    expect(active.status).toBe('ACTIVO');

    const after = await getHandoverCashState(handover.id);
    expect(after.elements[0]?.declared).toBe(true);
    expect(after.elements[0]?.confirmed).toBe(true);
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
