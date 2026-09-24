import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  getExpectedCash,
  getLiveCashState,
  insertCashMovement,
  markCashMovementAsRegularization,
} from '@/server/services/live-cash';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('regularización de diferencias de Caja', () => {
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisión',
    });
    await prisma.cashFund.create({
      data: { currency: 'CLP', amount: 100_000 },
    });
  });

  it('una regularización física queda trazada pero no aumenta el efectivo esperado', async () => {
    const movementId = await insertCashMovement(prisma, {
      userId: supervisor.id,
      kind: 'AJUSTE_ENTRADA',
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 2_000,
      reference: 'Devolución de faltante anterior',
      affectsExpected: false,
    });

    expect((await getExpectedCash()).get('CLP')).toBe(100_000);

    const state = await getLiveCashState();
    const movement = state.movements.find((row) => row.id === movementId);
    expect(movement?.affectsExpected).toBe(false);
    expect(movement?.amount).toBe(2_000);
  });

  it('reclasificar un ingreso manual elimina su efecto sobre el esperado sin borrar el movimiento', async () => {
    const movementId = await insertCashMovement(prisma, {
      userId: supervisor.id,
      kind: 'AJUSTE_ENTRADA',
      direction: 'ENTRADA',
      currency: 'CLP',
      amount: 2_000,
      reference: 'Dinero devuelto',
    });

    expect((await getExpectedCash()).get('CLP')).toBe(102_000);

    await markCashMovementAsRegularization(supervisor, {
      movementId,
      reason: 'Corresponde a CLP 2.000 que regresaron tras un faltante previo.',
    });

    expect((await getExpectedCash()).get('CLP')).toBe(100_000);

    const persisted = await prisma.cashMovement.findUniqueOrThrow({
      where: { id: movementId },
    });
    expect(persisted.affectsExpected).toBe(false);
    expect(persisted.amount.toNumber()).toBe(2_000);
    expect(persisted.voidedAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'CashMovement', entityId: movementId, action: 'EDITAR' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.summary).toContain('regularización de diferencia');
    expect(audit?.reason).toContain('2.000');
  });
});
