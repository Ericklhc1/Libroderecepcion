import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  beginSupervisionOpening,
  completeSupervisionOpening,
  getSupervisionOpeningReadiness,
} from '@/server/services/supervision-center';
import { REQUIRED_SUPERVISION_OPENING_REPORTS } from '@/domain/supervision-opening';
import { hotelCalendarDate } from '@/domain/time';

describe('Apertura operacional de Supervisión', () => {
  let supervisor: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisora Apertura',
    });
  });

  it('crea una preparación sin considerar el turno iniciado', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    expect(shift.status).toBe('PREPARACION');
    expect(shift.openingCompletedAt).toBeNull();

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.shift.id).toBe(shift.id);
    expect(readiness.reports.missingRequired).toEqual(
      expect.arrayContaining([...REQUIRED_SUPERVISION_OPENING_REPORTS]),
    );

    await expect(beginSupervisionOpening(supervisor)).rejects.toThrow(
      /apertura de Supervisión en curso/,
    );
  });

  it('bloquea el inicio si falta el arqueo personal del Supervisor', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    await prisma.cashFund.create({
      data: { currency: 'CLP', amount: 100_000, active: true },
    });

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: true,
        reviewedGuarantees: true,
        reviewedKeys: true,
      }),
    ).rejects.toThrow(/arquear personalmente la Caja/);
  });

  it('exige los siete informes acordados y no admite sustituciones', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const incomplete = REQUIRED_SUPERVISION_OPENING_REPORTS.filter(
      (kind) => kind !== 'ENTRADAS',
    );
    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: shift.id,
        businessDate: hotelCalendarDate(),
        uploadedById: supervisor.id,
        reportKinds: [...incomplete],
        metrics: {},
        checks: [],
        findings: [],
        warnings: [],
        reviewState: {},
        sourceFiles: [],
      },
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.reportsReady).toBe(false);
    expect(readiness.reports.missingRequired).toContain('ENTRADAS');
  });

  it('activa el turno sólo después de Caja, siete informes y confirmaciones', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    await prisma.cashFund.create({
      data: { currency: 'CLP', amount: 100_000, active: true },
    });
    await prisma.cashAudit.create({
      data: {
        id: randomUUID(),
        currency: 'CLP',
        expectedAmount: 100_000,
        countedAmount: 100_000,
        difference: 0,
        countedById: supervisor.id,
        guaranteeSnapshot: [],
        denominationSnapshot: [],
      },
    });
    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: shift.id,
        businessDate: hotelCalendarDate(),
        uploadedById: supervisor.id,
        reportKinds: [...REQUIRED_SUPERVISION_OPENING_REPORTS],
        metrics: {},
        checks: [],
        findings: [],
        warnings: [],
        reviewState: {},
        sourceFiles: [],
      },
    });

    const updated = await completeSupervisionOpening(supervisor, {
      shiftId: shift.id,
      reviewedPending: true,
      reviewedGuarantees: true,
      reviewedKeys: true,
    });

    expect(updated.status).toBe('ACTIVO');
    expect(updated.openingCompletedAt).not.toBeNull();
    expect(updated.priorities).toEqual(
      expect.arrayContaining([
        'Completar Ventas por canal',
        'Completar Producción por habitación',
        'Completar Revenue',
      ]),
    );

    const snapshot = updated.openingState as Record<string, unknown>;
    expect(snapshot.version).toBe(1);
    expect(snapshot).toHaveProperty('cash');
    expect(snapshot).toHaveProperty('reports');
    expect(snapshot).toHaveProperty('pending');
  });

  it('bloquea el inicio si falta cualquiera de los informes obligatorios', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: shift.id,
        businessDate: hotelCalendarDate(),
        uploadedById: supervisor.id,
        reportKinds: ['ACTIVIDAD'],
        metrics: {},
        checks: [],
        findings: [],
        warnings: [],
        reviewState: {},
        sourceFiles: [],
      },
    });

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: true,
        reviewedGuarantees: true,
        reviewedKeys: true,
      }),
    ).rejects.toThrow(/informes operativos obligatorios/);
  });

  it('exige las confirmaciones humanas', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: false,
        reviewedGuarantees: true,
        reviewedKeys: true,
      }),
    ).rejects.toThrow(/confirmar la revisión operacional completa/);
  });
});
