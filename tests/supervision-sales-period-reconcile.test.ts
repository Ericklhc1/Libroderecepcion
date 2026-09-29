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
});
