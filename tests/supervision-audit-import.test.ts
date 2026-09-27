import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeSupervisionAuditReport,
  parseSupervisionReportText,
} from '@/server/services/supervision-audit-import';
import {
  deliverSupervisionShift,
  startSupervisionShift,
} from '@/server/services/supervision-center';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('dashboard de auditoría diaria de Supervisión', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('normaliza ventas por canal, cobros, salidas, producción y revenue', () => {
    const sales = parseSupervisionReportText(
      'Ventas x canal 26-9-26.pdf',
      'Ingresos totales por canal: 26/09/2026 Total CL$ 1.656.408 CL$ 1.340.204 CL$ 63.708 CL$ 316.204 19.1 % 25 26 51 Booking',
    );
    expect(sales.kind).toBe('VENTAS_CANAL');
    expect(sales.metrics).toEqual({
      salesChannels: {
        grossClp: 1_656_408,
        netClp: 1_340_204,
        adrClp: 63_708,
        commissionsClp: 316_204,
        commissionPct: 19.1,
        reservations: 25,
        roomNights: 26,
        overnightStays: 51,
      },
    });

    const payments = parseSupervisionReportText(
      'Cobros 26-9-26.pdf',
      'Operaciones de caja Reservas Totales por moneda Moneda Importe Nº operaciones CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
    );
    expect(payments.kind).toBe('COBROS');
    expect(payments.metrics).toEqual({
      payments: {
        clpAmount: 1_039_180,
        clpOperations: 10,
        usdAmount: 48.26,
        usdOperations: 1,
      },
    });

    const departures = parseSupervisionReportText(
      'Salidas 26-9-26.pdf',
      'Informe de salidas Hotel HW LIBERTAD CL$ 1.496.977 CL$ 0 US$ 782.58 US$ 0 Total Realizado Pendiente Check-out 21 21 0 Informe generado',
    );
    expect(departures.kind).toBe('SALIDAS');
    expect(departures.metrics).toEqual({
      departures: {
        total: 21,
        completed: 21,
        pending: 0,
        totalClp: 1_496_977,
        totalUsd: 782.58,
      },
    });

    const production = parseSupervisionReportText(
      'Producción por Habitación 26-9-26.pdf',
      'Producción por habitación Hotel HW LIBERTAD Total CLP CL$ 1.257.020 Total USD US$ 408.43 Habitaciones ocupadas con coste 26',
    );
    expect(production.kind).toBe('PRODUCCION_HABITACION');
    expect(production.metrics).toEqual({
      roomProduction: {
        occupiedRoomsWithCost: 26,
        totalClp: 1_257_020,
        totalUsd: 408.43,
      },
    });

    const revenue = parseSupervisionReportText(
      'Revenue 26-9-26.pdf',
      'Informe de Revenue Hotel HW LIBERTAD Total 712 90 0 0 0 12.64% CL$ 5.340.167 CL$ 59.335 CL$ 7.500 3 30 45 187',
    );
    expect(revenue.kind).toBe('REVENUE');
    expect(revenue.metrics).toEqual({
      revenue: {
        occupancyPct: 12.64,
        revenueClp: 5_340_167,
        adrClp: 59_335,
        revparClp: 7_500,
      },
    });
  });

  it('convierte el formulario nocturno en controles y hallazgos accionables', () => {
    const parsed = parseSupervisionReportText(
      'Formulario Auditoria 27-09-26.pdf',
      [
        'Formulario auditoría 27/09/2026',
        'Revisar en Inicio Auditoría Nocturna que estén todos los check in del día realizados Si Todo OK.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los check out del día realizados Si Todo OK.',
        'Revisar en Inicio Auditoría Nocturna que todos los check out del día estén marcados como cobrados Si Todos cobrados.',
        'Revisar en Informes Producción Habitaciones, que las tarifas y valores estén correctas Si Correctas.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 8,
        completed: 6,
        notCompleted: 2,
        withoutAnswer: 0,
      },
    });
    expect(parsed.checks.filter((check) => check.done === false).map((check) => check.key)).toEqual(
      expect.arrayContaining(['tickets-restaurante', 'mesas-restaurante']),
    );
    expect(parsed.findings.map((finding) => finding.key)).toEqual(
      expect.arrayContaining([
        'check:tickets-restaurante',
        'check:mesas-restaurante',
        'pms-pending:7484708',
      ]),
    );
    expect(parsed.findings.find((finding) => finding.key === 'pms-pending:7484708')?.detail).toContain(
      '20 CLP',
    );
  });

  it('no inventa datos cuando el cierre de caja es un escaneo sin texto', () => {
    const parsed = parseSupervisionReportText('Cierre de caja 26-9-26.pdf', '');
    expect(parsed.kind).toBe('CIERRE_CAJA');
    expect(parsed.metrics).toEqual({});
    expect(parsed.checks).toEqual([]);
    expect(parsed.findings).toEqual([]);
    expect(parsed.warnings.join(' ')).toMatch(/imagen\/escaneo/i);
  });

  it('fusiona varios informes del mismo día en un único resumen del turno', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Auditoría',
    });
    const shift = await startSupervisionShift(supervisor, {
      priorities: ['Revisar auditoría del día anterior'],
    });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Ventas x canal 26-9-26.pdf',
        'Ingresos totales por canal Total CL$ 1.656.408 CL$ 1.340.204 CL$ 63.708 CL$ 316.204 19.1 % 25 26 51',
      ),
    });
    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    expect(
      await prisma.supervisionAuditImport.count({
        where: { supervisionShiftId: shift.id, businessDate },
      }),
    ).toBe(1);

    const stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect(stored.reportKinds).toEqual(
      expect.arrayContaining(['VENTAS_CANAL', 'COBROS']),
    );
    expect(stored.metrics).toMatchObject({
      salesChannels: { netClp: 1_340_204 },
      payments: { clpAmount: 1_039_180, usdAmount: 48.26 },
    });
  });

  it('incluye el resumen diario en la copia inalterable del cierre de Supervisión', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Cierre',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 26-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });

    const handover = await deliverSupervisionShift(supervisor, { shiftId: shift.id });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ businessDate: string; reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports).toHaveLength(1);
    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('SALIDAS');
    expect(snapshot.summary?.dailyAuditImports).toBe(1);
  });

  it('no permite cargar datos históricos fuera de un turno activo de Supervisión', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor sin turno',
    });

    await expect(
      mergeSupervisionAuditReport(supervisor, {
        businessDate: new Date('2026-09-26T00:00:00.000Z'),
        parsed: parseSupervisionReportText(
          'Cargos diarios 26-9-26.pdf',
          'Informe de cargos diarios Ningún dato disponible en esta tabla',
        ),
      }),
    ).rejects.toThrow(/Inicia tu turno de Supervisión/i);
  });
});
