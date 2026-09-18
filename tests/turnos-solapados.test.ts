import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  addShiftMember,
  closeShift,
  openShift,
  prepareHandover,
  receiveHandover,
  receiveShiftCash,
  sendHandover,
} from '@/server/services/shifts';
import { saveCashCount } from '@/server/services/cash';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

async function seedFunds() {
  await prisma.cashFund.createMany({
    data: [
      { currency: 'CLP', amount: 100_000 },
      { currency: 'USD', amount: 150 },
    ],
    skipDuplicates: true,
  });
}

async function exactFundQuantities(): Promise<Record<string, number>> {
  const denominations = await prisma.cashDenomination.findMany();
  const find = (currency: string, value: number) => {
    const row = denominations.find(
      (denomination) =>
        denomination.currency === currency && Number(denomination.value) === value,
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

async function activate(user: Awaited<ReturnType<typeof createUser>>, type: ShiftType) {
  const shift = await openShiftAs(user, { type });
  await receiveHandover(user, { shiftId: shift.id });
  return prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
}

describe('turnos solapados y transferencia independiente de Caja', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('el entrante abre su turno mientras el saliente prepara la entrega', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    const turnoSaliente = await activate(saliente, ShiftType.DIA);
    await prepareHandover(saliente, turnoSaliente.id);

    const { shift: turnoEntrante } = await openShift(entrante, { type: ShiftType.NOCHE });

    expect(turnoEntrante.id).not.toBe(turnoSaliente.id);
    expect(
      await prisma.shift.count({
        where: { status: { in: ['INICIADO', 'ACTIVO', 'PREPARANDO_ENTREGA'] } },
      }),
    ).toBe(2);

    const activos = await prisma.shiftAssignment.findMany({
      where: { activatedAt: { not: null }, leftAt: null },
    });
    expect(new Set(activos.map((assignment) => assignment.userId))).toEqual(
      new Set([saliente.id, entrante.id]),
    );
  });

  it('PostgreSQL impide que la misma persona esté activa como apoyo en otro turno', async () => {
    const persona = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Persona' });
    const otro = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Otro' });

    await activate(persona, ShiftType.DIA);
    const { shift: turnoOtro } = await openShift(otro, { type: ShiftType.NOCHE });

    await expect(
      addShiftMember(otro, { shiftId: turnoOtro.id, userId: persona.id }),
    ).rejects.toThrow(/ya participa activamente/i);
  });

  it('una asignación PROGRAMADA no consume la participación activa', async () => {
    const persona = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Persona' });
    const programado = await createShift({
      userId: persona.id,
      type: ShiftType.DIA,
      status: ShiftStatus.PROGRAMADO,
    });

    const { shift: activo } = await openShift(persona, { type: ShiftType.NOCHE });

    expect(activo.id).not.toBe(programado.id);
    const assignment = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: programado.id, userId: persona.id },
    });
    expect(assignment.activatedAt).toBeNull();
    expect(assignment.leftAt).toBeNull();
  });

  it('recibe Caja con la entrega todavía en BORRADOR y no cierra al saliente', async () => {
    await seedFunds();
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente' });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrante' });

    const turnoSaliente = await activate(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, turnoSaliente.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });

    const { shift: turnoEntrante } = await openShift(entrante, { type: ShiftType.NOCHE });
    const received = await receiveShiftCash(entrante, {
      shiftId: turnoEntrante.id,
      handoverId: handover.id,
      quantities,
    });

    expect(received.shift.status).toBe(ShiftStatus.ACTIVO);
    const stored = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    expect(stored.status).toBe(HandoverStatus.BORRADOR);
    expect(stored.receivedAt).toBeNull();
    expect(stored.toShiftId).toBe(turnoEntrante.id);
    expect(
      (await prisma.shift.findUniqueOrThrow({ where: { id: turnoSaliente.id } })).status,
    ).toBe(ShiftStatus.PREPARANDO_ENTREGA);
  });

  it('dos turnos entrantes no pueden reclamar la misma Caja', async () => {
    await seedFunds();
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const primero = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const segundo = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const turnoSaliente = await activate(saliente, ShiftType.DIA);
    const handover = await prepareHandover(saliente, turnoSaliente.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(saliente, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });

    const { shift: turnoPrimero } = await openShift(primero, { type: ShiftType.NOCHE });
    const { shift: turnoSegundo } = await openShift(segundo, { type: ShiftType.NOCHE });

    await receiveShiftCash(primero, {
      shiftId: turnoPrimero.id,
      handoverId: handover.id,
      quantities,
    });

    await expect(
      receiveShiftCash(segundo, {
        shiftId: turnoSegundo.id,
        handoverId: handover.id,
        quantities,
      }),
    ).rejects.toThrow(/otro turno|recibida/i);
  });

  it('al enviar la entrega termina la participación y la persona puede abrir otro turno', async () => {
    const persona = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const primero = await activate(persona, ShiftType.DIA);
    await prepareHandover(persona, primero.id);
    await sendHandover(persona, { shiftId: primero.id });

    const participation = await prisma.shiftAssignment.findFirstOrThrow({
      where: { shiftId: primero.id, userId: persona.id },
    });
    expect(participation.leftAt).toBeInstanceOf(Date);

    const { shift: segundo } = await openShift(persona, { type: ShiftType.NOCHE });
    expect(segundo.id).not.toBe(primero.id);
    expect(segundo.status).toBe(ShiftStatus.INICIADO);
  });

  it('el saliente puede enviar y cerrar mientras el entrante ya está operando', async () => {
    const saliente = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const entrante = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const turnoSaliente = await activate(saliente, ShiftType.DIA);
    await prepareHandover(saliente, turnoSaliente.id);

    const turnoEntrante = await activate(entrante, ShiftType.NOCHE);
    expect(turnoEntrante.status).toBe(ShiftStatus.ACTIVO);

    await sendHandover(saliente, { shiftId: turnoSaliente.id });
    const closed = await closeShift(saliente, { shiftId: turnoSaliente.id });

    expect(closed.status).toBe(ShiftStatus.CERRADO);
    expect(
      (await prisma.shift.findUniqueOrThrow({ where: { id: turnoEntrante.id } })).status,
    ).toBe(ShiftStatus.ACTIVO);
  });
});
