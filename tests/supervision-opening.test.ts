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

  async function addEvidence(input: {
    shiftId: string;
    businessDate: Date;
    kinds: string[];
    uploadedById?: string;
    metrics?: Record<string, unknown>;
    checks?: unknown[];
    findings?: unknown[];
    reviewState?: Record<string, unknown>;
  }) {
    return prisma.supervisionAuditImport.create({
      data: {
        supervisionShiftId: input.shiftId,
        businessDate: input.businessDate,
        uploadedById: input.uploadedById ?? supervisor.id,
        reportKinds: input.kinds,
        metrics: input.metrics ?? {},
        checks: input.checks ?? [],
        findings: input.findings ?? [],
        warnings: [],
        reviewState: input.reviewState ?? {},
        sourceFiles: [],
      },
    });
  }

  it('crea una preparación sin considerar el turno iniciado', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    expect(shift.status).toBe('PREPARACION');
    expect(shift.openingCompletedAt).toBeNull();

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.shift.id).toBe(shift.id);
    expect(readiness.reports.occupancyReady).toBe(false);
    expect(readiness.reports.auditReady).toBe(false);

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
        reportContingencyReason: 'PMS temporalmente sin servicio.',
      }),
    ).rejects.toThrow(/arquear personalmente la Caja/);

    const persisted = await prisma.supervisionShift.findUniqueOrThrow({
      where: { id: shift.id },
    });
    expect(persisted.status).toBe('PREPARACION');
  });

  it('acepta Actividad como fotografía operacional sin exigir el trío histórico', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();
    const yesterday = addCalendarDateDays(today, -1);

    await addEvidence({ shiftId: shift.id, businessDate: today, kinds: ['ACTIVIDAD'] });
    await addEvidence({
      shiftId: shift.id,
      businessDate: yesterday,
      kinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.occupancyReady).toBe(true);
    expect(readiness.reports.auditReady).toBe(true);
    expect(readiness.reports.reportsReady).toBe(true);
    expect(readiness.reports.todayKinds).toContain('ACTIVIDAD');
  });

  it('acepta Entradas + In House + Salidas como respaldo si Actividad no está disponible', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();
    const yesterday = addCalendarDateDays(today, -1);

    await addEvidence({
      shiftId: shift.id,
      businessDate: today,
      kinds: [...SUPERVISION_OPERATIONAL_FALLBACK_REPORTS],
    });
    await addEvidence({
      shiftId: shift.id,
      businessDate: yesterday,
      kinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.occupancyReady).toBe(true);
    expect(readiness.reports.reportsReady).toBe(true);
  });

  it('exige contingencia documentada cuando la evidencia PMS está incompleta', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: true,
        reviewedGuarantees: true,
        reviewedKeys: true,
      }),
    ).rejects.toThrow(/Falta evidencia PMS de apertura/);

    const updated = await completeSupervisionOpening(supervisor, {
      shiftId: shift.id,
      reviewedPending: true,
      reviewedGuarantees: true,
      reviewedKeys: true,
      reportContingencyReason: 'PMS sin disponibilidad desde el inicio del turno.',
    });

    expect(updated.status).toBe('ACTIVO');
    const snapshot = updated.openingState as Record<string, unknown>;
    expect(JSON.stringify(snapshot)).toContain('PMS sin disponibilidad');
  });

  it('activa el turno con Caja conforme, evidencia completa y confirmaciones', async () => {
    const shift = await beginSupervisionOpening(supervisor);
    const today = hotelCalendarDate();
    const yesterday = addCalendarDateDays(today, -1);

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
    await addEvidence({ shiftId: shift.id, businessDate: today, kinds: ['ACTIVIDAD'] });
    await addEvidence({
      shiftId: shift.id,
      businessDate: yesterday,
      kinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
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
  });

  it('invalida el arqueo si cambia el fondo fijo después del conteo', async () => {
    await beginSupervisionOpening(supervisor);
    const fund = await prisma.cashFund.create({
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
    await prisma.cashFund.update({
      where: { id: fund.id },
      data: { amount: 120_000 },
    });

    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.cash.currencies[0]?.fundCurrent).toBe(false);
    expect(readiness.cash.missingCurrencies).toContain('CLP');
  });

  it('materializa en el turno nuevo la evidencia reutilizada de otro turno', async () => {
    const today = hotelCalendarDate();
    const yesterday = addCalendarDateDays(today, -1);
    const oldShift = await prisma.supervisionShift.create({
      data: {
        supervisorId: supervisor.id,
        status: 'CERRADO',
        priorities: [],
        finishedAt: new Date(),
      },
    });
    await addEvidence({
      shiftId: oldShift.id,
      businessDate: today,
      kinds: ['ACTIVIDAD'],
      metrics: { roomActivity: { recognized: true } },
    });
    await addEvidence({
      shiftId: oldShift.id,
      businessDate: yesterday,
      kinds: [...REQUIRED_SUPERVISION_AUDIT_REPORTS],
      checks: [{ key: 'x', label: 'Control heredado', done: false, observation: null }],
    });

    const shift = await beginSupervisionOpening(supervisor);
    const readiness = await getSupervisionOpeningReadiness(supervisor);
    expect(readiness.reports.reportsReady).toBe(true);
    expect(readiness.reports.sources.some((source) => source.id)).toBe(true);

    await completeSupervisionOpening(supervisor, {
      shiftId: shift.id,
      reviewedPending: true,
      reviewedGuarantees: true,
      reviewedKeys: true,
    });

    const inherited = await prisma.supervisionAuditImport.findMany({
      where: { supervisionShiftId: shift.id },
      orderBy: { businessDate: 'asc' },
    });
    expect(inherited).toHaveLength(2);
    expect(inherited.flatMap((row) => row.reportKinds)).toEqual(
      expect.arrayContaining(['ACTIVIDAD', ...REQUIRED_SUPERVISION_AUDIT_REPORTS]),
    );
    expect(JSON.stringify(inherited)).toContain('Control heredado');
  });

  it('exige las confirmaciones humanas aunque los controles técnicos estén completos', async () => {
    const shift = await beginSupervisionOpening(supervisor);

    await expect(
      completeSupervisionOpening(supervisor, {
        shiftId: shift.id,
        reviewedPending: false,
        reviewedGuarantees: true,
        reviewedKeys: true,
        reportContingencyReason: 'PMS temporalmente sin disponibilidad.',
      }),
    ).rejects.toThrow(/confirmar la revisión operacional completa/);
  });
});
