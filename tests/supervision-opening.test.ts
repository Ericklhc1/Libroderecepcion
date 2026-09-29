import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog } from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  beginSupervisionOpening,
  completeSupervisionOpening,
  getSupervisionOpeningReadiness,
} from '@/server/services/supervision-center';
import {
  REQUIRED_SUPERVISION_AUDIT_REPORTS,
  SUPERVISION_OPERATIONAL_FALLBACK_REPORTS,
} from '@/domain/supervision-opening';
import { addCalendarDateDays, hotelCalendarDate } from '@/domain/time';

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
    expect(readiness.reports.occupancyReady).toBe(false);
    expect(readiness.reports.missingAudit).toEqual(
      expect.arrayContaining([...REQUIRED_SUPERVISION_AUDIT_REPORTS]),
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
        reportContingencyReason: 'PMS sin informes disponibles durante la apertura.',
      }),
    ).rejects.toThrow(/arquear personalmente la Caja/);

    const persisted = await prisma.supervisionShift.findUniqueOrThrow({
      where: { id: shift.id },
    });
    expect(persisted.status).toBe('PREPARACION');
  });

  it('Habitaciones con actividad sustituye al trío Entradas + In House + Salidas', async () => {
    await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();
    const auditDate = addCalendarDateDays(today, -1);

    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: (await prisma.supervisionShift.findFirstOrThrow({
          where: { supervisorId: supervisor.id, status: 'PREPARACION' },
        })).id,
        businessDate: today,
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
    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: (await prisma.supervisionShift.findFirstOrThrow({
          where: { supervisorId: supervisor.id, status: 'PREPARACION' },
        })).id,
        businessDate: auditDate,
        uploadedById: supervisor.id,
        reportKinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
        metrics: {},
        checks: [],
        findings: [],
        warnings: [],
        reviewState: {},
        sourceFiles: [],
      },
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.occupancyReady).toBe(true);
    expect(readiness.reports.missingOperationalFallback).toEqual([]);
    expect(readiness.reports.auditReady).toBe(true);
    expect(readiness.reports.reportsReady).toBe(true);
  });

  it('acepta el trío histórico cuando no existe Habitaciones con actividad', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();

    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: shift.id,
        businessDate: today,
        uploadedById: supervisor.id,
        reportKinds: [...SUPERVISION_OPERATIONAL_FALLBACK_REPORTS],
        metrics: {},
        checks: [],
        findings: [],
        warnings: [],
        reviewState: {},
        sourceFiles: [],
      },
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.occupancyReady).toBe(true);
  });

  it('activa el turno después de Caja, fotografía de hoy, cierre de ayer y confirmaciones', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();
    const auditDate = addCalendarDateDays(today, -1);

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
        businessDate: today,
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
    await prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: shift.id,
        businessDate: auditDate,
        uploadedById: supervisor.id,
        reportKinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
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

  it('permite contingencia PMS documentada sin saltarse Caja ni confirmaciones', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    const updated = await completeSupervisionOpening(supervisor, {
      shiftId: shift.id,
      reviewedPending: true,
      reviewedGuarantees: true,
      reviewedKeys: true,
      reportContingencyReason: 'FNS no está emitiendo informes; se actualizará al recuperarse.',
    });

    expect(updated.status).toBe('ACTIVO');
    const snapshot = updated.openingState as {
      reports?: { contingencyReason?: string | null };
    };
    expect(snapshot.reports?.contingencyReason).toMatch(/FNS no está emitiendo/);
  });

  it('exige las confirmaciones humanas aunque exista contingencia técnica', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: false,
        reviewedGuarantees: true,
        reviewedKeys: true,
        reportContingencyReason: 'PMS temporalmente fuera de servicio.',
      }),
    ).rejects.toThrow(/confirmar la revisión operacional completa/);
  });
});
