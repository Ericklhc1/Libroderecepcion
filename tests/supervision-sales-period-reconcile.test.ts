import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeSupervisionAuditReport,
  type ParsedSupervisionReport,
} from '@/server/services/supervision-audit-import';
import { startSupervisionShift } from '@/server/services/supervision-center';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('conciliación de Ventas por período', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('actualiza el mismo snapshot mensual y cruza inventario sin duplicar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor ventas período',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const activeRooms = await prisma.room.count({ where: { active: true } });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');

    const parsed: ParsedSupervisionReport = {
      kind: 'VENTAS_PERIODO',
      label: 'Ventas por período',
      metrics: {
        salesPeriod: {
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          generatedAt: '2026-09-01T09:00:00',
          visibleThrough: '2026-09-01',
          visibleDays: 1,
          expectedVisibleDays: 1,
          truncated: false,
          daily: [
            {
              date: '2026-09-01',
              hotelTotalClp: 100000,
              costCenters: {
                alojamiento: 100000,
                eventos: 0,
                spa: 0,
                multas: 0,
                multasFumar: 0,
                multasBlancos: 0,
                varios: 0,
                tasas: 0,
              },
              totalRooms: Math.max(0, activeRooms - 1),
              freeRooms: Math.max(0, activeRooms - 21),
              occupiedRooms: 20,
              occupiedWithCost: 20,
              courtesyRooms: 0,
              dayUse: 0,
              blockedRooms: 0,
              groupRooms: 0,
              passengers: 30,
              guests: 25,
              adrClp: 5000,
              occupancyPct: activeRooms > 1 ? (20 / (activeRooms - 1)) * 100 : 0,
              paidOccupancyPct: activeRooms > 1 ? (20 / (activeRooms - 1)) * 100 : 0,
              roomRevenueClp: 100000,
              checkIns: 5,
              checkOuts: 4,
              noShows: 0,
              cancellations: 0,
              breakfasts: 25,
              totalAccommodationClp: 100000,
            },
          ],
          totals: {
            courtesyRooms: 0,
            dayUse: 0,
            blockedRoomDays: 0,
            costCentersClp: {
              alojamiento: 100000,
              eventos: 0,
              spa: 0,
              multas: 0,
              multasFumar: 0,
              multasBlancos: 0,
              varios: 0,
              tasas: 0,
            },
          },
        },
      },
      checks: [],
      findings: [],
      warnings: [],
      reportedBusinessDate: '2026-09-01',
      completeness: { found: 1, expected: 1 },
    };

    await mergeSupervisionAuditReport(supervisor, { businessDate, parsed });
    await mergeSupervisionAuditReport(supervisor, { businessDate, parsed });

    expect(
      await prisma.supervisionAuditImport.count({
        where: { supervisionShiftId: shift.id, businessDate },
      }),
    ).toBe(1);

    const stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect(stored.reportKinds).toContain('VENTAS_PERIODO');
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toContain(
      'cross:sales-period:room-inventory',
    );
  });

  it('conserva hallazgos mensuales al refrescar auditoría y cruza evidencia de la misma fila', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor convivencia de informes',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');
    const activeRooms = await prisma.room.count({ where: { active: true } });

    const monthly: ParsedSupervisionReport = {
      kind: 'VENTAS_PERIODO',
      label: 'Ventas por período',
      metrics: {
        salesPeriod: {
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          generatedAt: '2026-09-01T09:00:00',
          visibleThrough: '2026-09-01',
          visibleDays: 1,
          expectedVisibleDays: 1,
          truncated: false,
          daily: [{
            date: '2026-09-01',
            hotelTotalClp: 100000,
            costCenters: {
              alojamiento: 100000, eventos: 0, spa: 0, multas: 0,
              multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0,
            },
            totalRooms: activeRooms,
            freeRooms: activeRooms - 20,
            occupiedRooms: 20,
            occupiedWithCost: 19,
            courtesyRooms: 1,
            dayUse: 0,
            blockedRooms: 0,
            groupRooms: 0,
            passengers: 30,
            guests: 25,
            adrClp: 100000 / 19,
            occupancyPct: (20 / activeRooms) * 100,
            paidOccupancyPct: (19 / activeRooms) * 100,
            roomRevenueClp: 100000,
            checkIns: 5,
            checkOuts: 4,
            noShows: 0,
            cancellations: 0,
            breakfasts: 25,
            totalAccommodationClp: 100000,
          }],
          totals: {
            courtesyRooms: 1,
            dayUse: 0,
            blockedRoomDays: 0,
            costCentersClp: {
              alojamiento: 100000, eventos: 0, spa: 0, multas: 0,
              multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0,
            },
          },
        },
      },
      checks: [],
      findings: [{
        key: 'sales-period:courtesy',
        severity: 'ALTA',
        title: 'Cortesías detectadas en el período',
        detail: 'Existe una cortesía que requiere revisión.',
      }],
      warnings: [],
      reportedBusinessDate: '2026-09-01',
      completeness: { found: 1, expected: 1 },
    };

    await mergeSupervisionAuditReport(supervisor, { businessDate, parsed: monthly });
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        kind: 'AUDITORIA_FORMULARIO',
        label: 'Formulario de auditoría',
        metrics: {
          auditActivity: { entries: 6, departures: 4, breakfasts: 25, occupancyPct: (20 / activeRooms) * 100 },
        },
        checks: [],
        findings: [],
        warnings: [],
        reportedBusinessDate: '2026-09-01',
        completeness: { found: 1, expected: 1 },
      },
    });

    const stored = await prisma.supervisionAuditImport.findUniqueOrThrow({
      where: { supervisionShiftId_businessDate: { supervisionShiftId: shift.id, businessDate } },
    });
    const keys = (stored.findings as Array<{ key: string }>).map((finding) => finding.key);
    expect(keys).toContain('sales-period:courtesy');
    expect(keys).toContain('cross:sales-period:audit-activity');
  });

  it('retiene la resolución de un cruce si la evidencia que lo originó no cambió', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión estable',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');
    const activeRooms = await prisma.room.count({ where: { active: true } });

    const monthly: ParsedSupervisionReport = {
      kind: 'VENTAS_PERIODO',
      label: 'Ventas por período',
      metrics: {
        salesPeriod: {
          periodStart: '2026-09-01', periodEnd: '2026-09-30',
          generatedAt: null, visibleThrough: '2026-09-01',
          visibleDays: 1, expectedVisibleDays: 1, truncated: false,
          daily: [{
            date: '2026-09-01', hotelTotalClp: 100000,
            costCenters: { alojamiento: 100000, eventos: 0, spa: 0, multas: 0, multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0 },
            totalRooms: activeRooms, freeRooms: activeRooms - 20, occupiedRooms: 20,
            occupiedWithCost: 20, courtesyRooms: 0, dayUse: 0, blockedRooms: 0, groupRooms: 0,
            passengers: 30, guests: 25, adrClp: 5000,
            occupancyPct: (20 / activeRooms) * 100, paidOccupancyPct: (20 / activeRooms) * 100,
            roomRevenueClp: 100000, checkIns: 5, checkOuts: 4, noShows: 0, cancellations: 0,
            breakfasts: 25, totalAccommodationClp: 100000,
          }],
          totals: {
            courtesyRooms: 0, dayUse: 0, blockedRoomDays: 0,
            costCentersClp: { alojamiento: 100000, eventos: 0, spa: 0, multas: 0, multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0 },
          },
        },
      },
      checks: [], findings: [], warnings: [],
      reportedBusinessDate: '2026-09-01', completeness: { found: 1, expected: 1 },
    };

    await mergeSupervisionAuditReport(supervisor, { businessDate, parsed: monthly });
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        kind: 'AUDITORIA_FORMULARIO', label: 'Formulario de auditoría',
        metrics: { auditActivity: { entries: 6, departures: 4, breakfasts: 25, occupancyPct: (20 / activeRooms) * 100 } },
        checks: [], findings: [], warnings: [],
        reportedBusinessDate: '2026-09-01', completeness: { found: 1, expected: 1 },
      },
    });

    const stored = await prisma.supervisionAuditImport.findUniqueOrThrow({
      where: { supervisionShiftId_businessDate: { supervisionShiftId: shift.id, businessDate } },
    });
    await prisma.supervisionAuditImport.update({
      where: { id: stored.id },
      data: {
        reviewState: {
          checks: {},
          metrics: {},
          findings: {
            'cross:sales-period:audit-activity': {
              status: 'RESUELTO',
              note: 'Revisado.',
              at: new Date().toISOString(),
              byId: supervisor.id,
              byName: supervisor.name,
            },
          },
        },
      },
    });

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        kind: 'IN_HOUSE', label: 'In house',
        metrics: { inHouse: { rooms: 20 } },
        checks: [], findings: [], warnings: [],
        reportedBusinessDate: '2026-09-01', completeness: { found: 1, expected: 1 },
      },
    });

    const refreshed = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = refreshed.reviewState as { findings?: Record<string, { status?: string }> };
    expect(review.findings?.['cross:sales-period:audit-activity']?.status).toBe('RESUELTO');
  });

  it('retiene simultáneamente señales de Entradas y Salidas del mismo día', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor movimientos',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');

    const base = {
      checks: [], findings: [], warnings: [],
      reportedBusinessDate: '2026-09-01', completeness: { found: 1, expected: 1 },
    };
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        ...base,
        kind: 'ENTRADAS', label: 'Entradas',
        metrics: {
          pmsProcessing: {
            pending: 1, processedProbable: 0, unknown: 0,
            rows: [{ reservationId: '7500001', roomNumber: '501', status: 'CHECK_IN', signal: 'PENDIENTE', confidence: 'ALTA' }],
          },
        },
      },
    });
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        ...base,
        kind: 'SALIDAS', label: 'Salidas',
        metrics: {
          pmsProcessing: {
            pending: 1, processedProbable: 0, unknown: 0,
            rows: [{ reservationId: '7500002', roomNumber: '502', status: 'CHECK_OUT', signal: 'PENDIENTE', confidence: 'ALTA' }],
          },
        },
      },
    });

    const stored = await prisma.supervisionAuditImport.findUniqueOrThrow({
      where: { supervisionShiftId_businessDate: { supervisionShiftId: shift.id, businessDate } },
    });
    const metrics = stored.metrics as { pmsProcessing?: { rows?: Array<{ status: string }> } };
    expect(metrics.pmsProcessing?.rows?.map((row) => row.status).sort()).toEqual(['CHECK_IN', 'CHECK_OUT']);
  });

  it('detecta multas BLANCO cobradas en el Libro aunque PMS informe cero y usa fecha de cobro', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor multas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const room = await prisma.room.findFirstOrThrow({ where: { active: true } });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');
    const fine = await prisma.fine.create({
      data: {
        roomId: room.id,
        reservationCode: '7500999',
        guestName: 'Prueba',
        kind: 'BLANCO',
        reason: 'Prueba de conciliación',
        amount: 5000,
        currency: 'CLP',
        status: 'COBRADA',
        createdById: supervisor.id,
        createdAt: new Date('2026-08-20T12:00:00.000Z'),
      },
    });
    await prisma.auditLog.create({
      data: {
        entity: 'Fine',
        entityId: fine.id,
        action: 'CAMBIO_ESTADO',
        summary: 'Multa cobrada',
        userId: supervisor.id,
        after: { status: 'COBRADA' },
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });
    const activeRooms = await prisma.room.count({ where: { active: true } });
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: {
        kind: 'VENTAS_PERIODO',
        label: 'Ventas por período',
        metrics: {
          salesPeriod: {
            periodStart: '2026-09-01', periodEnd: '2026-09-30',
            generatedAt: null, visibleThrough: '2026-09-01',
            visibleDays: 1, expectedVisibleDays: 1, truncated: false,
            daily: [{
              date: '2026-09-01', hotelTotalClp: 100000,
              costCenters: { alojamiento: 100000, eventos: 0, spa: 0, multas: 0, multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0 },
              totalRooms: activeRooms, freeRooms: activeRooms - 20, occupiedRooms: 20,
              occupiedWithCost: 20, courtesyRooms: 0, dayUse: 0, blockedRooms: 0, groupRooms: 0,
              passengers: 30, guests: 25, adrClp: 5000,
              occupancyPct: (20 / activeRooms) * 100, paidOccupancyPct: (20 / activeRooms) * 100,
              roomRevenueClp: 100000, checkIns: 5, checkOuts: 4, noShows: 0, cancellations: 0,
              breakfasts: 25, totalAccommodationClp: 100000,
            }],
            totals: {
              courtesyRooms: 0, dayUse: 0, blockedRoomDays: 0,
              costCentersClp: { alojamiento: 100000, eventos: 0, spa: 0, multas: 0, multasFumar: 0, multasBlancos: 0, varios: 0, tasas: 0 },
            },
          },
        },
        checks: [], findings: [], warnings: [],
        reportedBusinessDate: '2026-09-01', completeness: { found: 1, expected: 1 },
      },
    });

    const stored = await prisma.supervisionAuditImport.findUniqueOrThrow({
      where: { supervisionShiftId_businessDate: { supervisionShiftId: shift.id, businessDate } },
    });
    expect((stored.findings as Array<{ key: string }>).map((finding) => finding.key)).toContain(
      'cross:sales-period:linen-fines',
    );
  });
});
