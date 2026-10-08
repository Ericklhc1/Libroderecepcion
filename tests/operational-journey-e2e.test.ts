import { beforeEach, describe, expect, it } from 'vitest';
import { EntryStatus, EntryType, Priority, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import {
  closeShift,
  confirmHandoverReviewStep,
  confirmReceptionReviewStep,
  prepareHandover,
  receiveHandover,
  receiveShiftCash,
  sendHandover,
  startReceptionShift,
} from '@/server/services/shifts';
import { saveCashCount } from '@/server/services/cash';
import { closeShiftCash } from '@/server/services/cash-closure';
import { createEntry, changeEntryStatus } from '@/server/services/entries';
import {
  getPhysicalKeyInventory,
  savePhysicalKeyInventoryCount,
} from '@/server/services/key-inventory';
import {
  getSupervisionCenterSummary,
  startSupervisionShift,
} from '@/server/services/supervision-center';
import { getReceptionOperationGate } from '@/server/services/reception-operation-gate';

async function confirmReview(
  user: Awaited<ReturnType<typeof createUser>>,
  handoverId: string,
) {
  await confirmHandoverReviewStep(user, { handoverId, step: 'PENDINGS' });
  await confirmHandoverReviewStep(user, { handoverId, step: 'FINAL' });
}

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

describe('jornada operativa transversal de punta a punta', () => {
  beforeEach(async () => {
    await resetOperationalData();
    await resetRoomsAndKeys();
    await seedCatalog();
    await seedFunds();
  });

  it('encadena Recepción, Libro, Llaves, Caja, relevo y Supervisión sin calle sin salida', async () => {
    const outgoing = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción saliente E2E',
    });
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión E2E',
    });
    await createUser({
      roleKey: ROLE_KEYS.SYSTEM_ADMIN,
      name: 'Administrador E2E',
      username: 'EHerrera',
    });

    // 1. El saliente inicia y queda operativo.
    const dayShift = await openShiftAs(outgoing, { type: ShiftType.DIA });
    await receiveHandover(outgoing, { shiftId: dayShift.id });
    expect((await getReceptionOperationGate(outgoing)).mode).toBe('ACTIVE');

    // 2. El Libro conserva el contexto del turno y permite resolver trabajo real.
    const entry = await createEntry(outgoing, {
      type: EntryType.NOVEDAD,
      title: 'Prueba transversal de continuidad',
      ownerId: outgoing.id,
      description: 'Registro creado durante una jornada E2E de regresión.',
      priority: Priority.MEDIA,
      tags: ['e2e'],
      requiresFollowUp: false,
    });
    expect(entry.shiftId).toBe(dayShift.id);

    await changeEntryStatus(outgoing, {
      id: entry.id,
      status: EntryStatus.EN_CURSO,
    });
    const resolved = await changeEntryStatus(outgoing, {
      id: entry.id,
      status: EntryStatus.RESUELTO,
      resolution: 'Resuelto antes de la entrega.',
    });
    expect(resolved.status).toBe(EntryStatus.RESUELTO);

    // 3. El inventario físico puede cerrarse completo sin depender del PMS.
    const inventory = await getPhysicalKeyInventory({ floor: 4 });
    const keyCount = await savePhysicalKeyInventoryCount(outgoing, {
      floor: 4,
      items: inventory.rooms.map((room) => ({
        roomId: room.roomId,
        found: room.expected,
        outOfService: room.outOfService,
        notes: null,
      })),
    });
    expect(keyCount.totals.expected).toBe(29);
    expect(keyCount.totals.missing).toBe(0);
    expect(keyCount.totals.surplus).toBe(0);

    // 4. El saliente cuenta y cierra Caja, entrega y recién después cierra turno.
    const handover = await prepareHandover(outgoing, dayShift.id);
    const quantities = await exactFundQuantities();
    await saveCashCount(outgoing, {
      handoverId: handover.id,
      kind: 'DECLARADO',
      quantities,
    });
    await closeShiftCash(outgoing, { shiftId: dayShift.id });
    await confirmReview(outgoing, handover.id);
    await sendHandover(outgoing, { shiftId: dayShift.id });
    await closeShift(outgoing, { shiftId: dayShift.id });

    // El turno anterior ya terminó. La misma persona puede continuar, pero la
    // entrega pendiente bloquea toda operación hasta abrir el NUEVO turno,
    // recontar Caja y completar los cinco pasos de recepción.
    expect((await getReceptionOperationGate(outgoing)).mode).toBe('HANDOVER_PENDING');

    // 5. El continuador no puede saltarse el recuento/recepción.
    await expect(
      openShiftAs(outgoing, { type: ShiftType.NOCHE }),
    ).rejects.toThrow(/pendiente de recepción/i);

    const nightShiftStarted = await startReceptionShift(outgoing, {
      handoverId: handover.id,
      type: ShiftType.NOCHE,
    });
    expect(nightShiftStarted.status).toBe('INICIADO');
    expect((await getReceptionOperationGate(outgoing)).mode).toBe('RECEIVING');

    await confirmReceptionReviewStep(outgoing, {
      handoverId: handover.id,
      step: 'BRIEFING',
    });

    const receivedCash = await receiveShiftCash(outgoing, {
      handoverId: handover.id,
      quantities,
    });
    expect(receivedCash.discrepancies).toEqual([]);
    expect(receivedCash.shiftId).toBe(nightShiftStarted.id);

    await confirmReceptionReviewStep(outgoing, {
      handoverId: handover.id,
      step: 'CUSTODY',
    });
    await confirmReceptionReviewStep(outgoing, {
      handoverId: handover.id,
      step: 'FINAL',
    });
    await receiveHandover(outgoing, { handoverId: handover.id });

    const nightShift = await prisma.shift.findUniqueOrThrow({
      where: { id: nightShiftStarted.id },
    });
    expect(nightShift.status).toBe('ACTIVO');
    expect((await getReceptionOperationGate(outgoing)).mode).toBe('ACTIVE');

    const linked = await prisma.shiftHandover.findUniqueOrThrow({
      where: { id: handover.id },
    });
    expect(linked.toShiftId).toBe(nightShift.id);
    expect(linked.status).toBe('RECIBIDA');

    // 6. Sólo queda una participación operativa viva: la del nuevo turno.
    const liveAssignments = await prisma.shiftAssignment.findMany({
      where: { activatedAt: { not: null }, leftAt: null },
      select: { userId: true, shiftId: true },
    });
    expect(liveAssignments).toEqual([
      expect.objectContaining({ userId: outgoing.id, shiftId: nightShift.id }),
    ]);

    // 7. El cierre saliente deja validación posterior sin bloquear continuidad.
    const validationTask = await prisma.task.findFirst({
      where: { shiftId: dayShift.id, title: 'Validar cierre de turno' },
      orderBy: { createdAt: 'desc' },
    });
    expect(validationTask).toBeNull();
    expect((await prisma.shift.findUniqueOrThrow({where:{id:dayShift.id}})).closureReviewRequestedAt).not.toBeNull();

    // 8. Supervisión puede entrar a su centro después del relevo sin afectar Recepción.
    const supervisionShift = await startSupervisionShift(supervisor, {
      priorities: ['Revisar cierre y continuidad E2E'],
    });
    const summary = await getSupervisionCenterSummary(supervisor);
    expect(summary.currentShift?.id).toBe(supervisionShift.id);
    expect((await getReceptionOperationGate(outgoing)).mode).toBe('ACTIVE');
  });
});
