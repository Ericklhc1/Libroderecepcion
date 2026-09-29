import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeSupervisionAuditReport,
  parseSupervisionReportText,
  reviewSupervisionAuditItem,
  updateSupervisionAuditDeparturesPending,
} from '@/server/services/supervision-audit-import';
import {
  deliverSupervisionShift,
  finishSupervisionShift,
  startSupervisionShift,
} from '@/server/services/supervision-center';
import {
  auditOperationalPendingCount,
  effectiveDeparturePending,
  parseSupervisionAuditReviewState,
} from '@/domain/supervision-audit-review';
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

  it('reconoce Ventas por período como informe mensual y conserva cortesías como hallazgo', () => {
    const parsed = parseSupervisionReportText(
      'Ventas por período - Sept.pdf',
      [
        'Informe detalle ventas periodo: Hotel HW LIBERTAD (01/09/2026 - 30/09/2026)',
        'Alojamiento de coste 01/09/2026 02/09/2026',
        'Hotel HW CL$ CL
    const inHouse = parseSupervisionReportText(
      'In house 27-9-26.pdf',
      'In house - Hotel HW LIBERTAD - 27/09/2026 In-house 51 0 48 Habitaciones in￾house 26 Informe generado',
    );
    expect(inHouse.kind).toBe('IN_HOUSE');
    expect(inHouse.metrics).toEqual({ inHouse: { rooms: 26 } });

    const charges = parseSupervisionReportText(
      'Cargos diarios 26-9-26.pdf',
      'Informe de cargos diarios Hotel HW LIBERTAD Ningún dato disponible en esta tabla Informe de cargos diarios Eventos Ningún dato disponible en esta tabla',
    );
    expect(charges.kind).toBe('CARGOS_DIARIOS');
    expect(charges.metrics).toEqual({ dailyCharges: { noData: true } });
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
        'Revisar en Informes Producción Salones, que las tarifas y valores estén correctas Si No hay datos disponibles.',
        'Revisar en Informes Financieros Cobros, la correcta relación entre forma de pago, moneda y tipo de documento asociado Si Todo OK.',
        'Revisar en Informes Financieros Cargos Diarios que todos los cargos están bien asociados al centro de costo correspondiente y que tengan la moneda bien cargada Si No hay cargos diarios.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar en Informes Financieros Auditoría Nocturna que estén bien todos los check in, cargos, cobros, etc Si Todo OK.',
        'Revisar en Informes Producción Centro de Coste que cuadre con producción de habitaciones, cargos diarios y tiquets Si Todo cuadra.',
        'Revisar que todas las habitaciones tienen la garantía correcta tarjeta de crédito orden de compra mail de empresa Si Todas correctas.',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar e imprimir los informes de Previsión de Servicios y Servicios por habitación, Revisar en Informes Actividad Si Ent 1, Sal 15, Des 52, Occ 13.48%',
        'Revisar y sacar el Informe de Reservas Grupales en Informes Actividad Inf. Rvas Grupales Si No hay datos.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
        'Revisar que todas las habitaciones ocupadas y pendientes de check-out están marcadas como sucias Si Todo marcado.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos iniciados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos finalizados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que todos los eventos finalizados del día estén marcados como cobrados Si',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 20,
        completed: 18,
        notCompleted: 2,
        withoutAnswer: 0,
      },
      auditActivity: {
        entries: 1,
        departures: 15,
        breakfasts: 52,
        occupancyPct: 13.48,
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

  it('no acredita Actividad o Entradas sólo por el nombre de un PDF ilegible', () => {
    const emptyActivity = parseSupervisionReportText('Habitaciones con actividad 29-09-26.pdf', '');
    expect(emptyActivity.kind).toBe('DESCONOCIDO');
    expect(emptyActivity.warnings.join(' ')).toMatch(/no contiene texto legible/i);

    const unrelatedEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Documento administrativo sin reservas, habitaciones ni llegadas.',
    );
    expect(unrelatedEntries.kind).toBe('DESCONOCIDO');

    const validActivity = parseSupervisionReportText(
      'Habitaciones con actividad 29-09-26.pdf',
      'Habitaciones con actividad ID Reserva Habitación Tipo 7526721 509 Check-out 7527640 606 Ocupada',
    );
    expect(validActivity.kind).toBe('ACTIVIDAD');

    const validEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Informe operativo ID Reserva Habitación Llegada 7529001 501 Check-in',
    );
    expect(validEntries.kind).toBe('ENTRADAS');
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


  it('reconcilia Ventas por período con el inventario del Libro y no duplica el mes al recargar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor ventas período',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const activeRooms = await prisma.room.count({ where: { active: true } });
    const businessDate = new Date('2026-09-01T00:00:00.000Z');

    const parsed = {
      kind: 'VENTAS_PERIODO' as const,
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

  it('reemplaza el formulario recargado y no deja Gastro obsoleto de forma persistente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor recarga',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });

    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toEqual(
      expect.arrayContaining(['check:tickets-restaurante', 'check:mesas-restaurante']),
    );

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos Si Todo OK.',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes Si Todo OK.',
        ].join(' '),
      ),
    });

    stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    const checks = stored.checks as Array<{ key: string; done: boolean | null }>;
    const findings = stored.findings as Array<{ key: string }>;
    expect(checks.find((item) => item.key === 'tickets-restaurante')?.done).toBe(true);
    expect(checks.find((item) => item.key === 'mesas-restaurante')?.done).toBe(true);
    expect(findings.map((item) => item.key)).not.toContain('check:tickets-restaurante');
    expect(findings.map((item) => item.key)).not.toContain('check:mesas-restaurante');
  });

  it('permite retirar o reabrir un control sin alterar la evidencia importada', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: 'NO_APLICA',
      note: 'Restaurante cerrado por mantenimiento; control no corresponde hoy.',
    });

    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = parseSupervisionAuditReviewState(stored.reviewState);
    expect(review.checks['tickets-restaurante']?.status).toBe('NO_APLICA');
    expect(stored.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tickets-restaurante', done: false }),
    ]));
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(1);

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: null,
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(2);
  });

  it('actualiza check-outs durante el turno y una nueva carga SALIDAS vuelve a ser la fuente vigente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor salidas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 18 3',
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await updateSupervisionAuditDeparturesPending(supervisor, {
      auditImportId: stored.id,
      value: 1,
      note: 'Se completaron dos salidas; queda una pendiente de cobro.',
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(1);

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(parseSupervisionAuditReviewState(stored.reviewState).metrics.departuresPending).toBeUndefined();
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(0);
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

  it('finalizar Supervisión también crea el snapshot aunque no se haya usado Entregar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Snapshot',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    await finishSupervisionShift(supervisor, shift.id);
    const handover = await prisma.supervisionShiftHandover.findUniqueOrThrow({
      where: { supervisionShiftId: shift.id },
    });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('COBROS');
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
    ).rejects.toThrow(/apertura de Supervisión/i);
  });
});
,
        'LIBERTAD 100.000 120.000',
        'Alojamiento CL$ CL
    const inHouse = parseSupervisionReportText(
      'In house 27-9-26.pdf',
      'In house - Hotel HW LIBERTAD - 27/09/2026 In-house 51 0 48 Habitaciones in￾house 26 Informe generado',
    );
    expect(inHouse.kind).toBe('IN_HOUSE');
    expect(inHouse.metrics).toEqual({ inHouse: { rooms: 26 } });

    const charges = parseSupervisionReportText(
      'Cargos diarios 26-9-26.pdf',
      'Informe de cargos diarios Hotel HW LIBERTAD Ningún dato disponible en esta tabla Informe de cargos diarios Eventos Ningún dato disponible en esta tabla',
    );
    expect(charges.kind).toBe('CARGOS_DIARIOS');
    expect(charges.metrics).toEqual({ dailyCharges: { noData: true } });
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
        'Revisar en Informes Producción Salones, que las tarifas y valores estén correctas Si No hay datos disponibles.',
        'Revisar en Informes Financieros Cobros, la correcta relación entre forma de pago, moneda y tipo de documento asociado Si Todo OK.',
        'Revisar en Informes Financieros Cargos Diarios que todos los cargos están bien asociados al centro de costo correspondiente y que tengan la moneda bien cargada Si No hay cargos diarios.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar en Informes Financieros Auditoría Nocturna que estén bien todos los check in, cargos, cobros, etc Si Todo OK.',
        'Revisar en Informes Producción Centro de Coste que cuadre con producción de habitaciones, cargos diarios y tiquets Si Todo cuadra.',
        'Revisar que todas las habitaciones tienen la garantía correcta tarjeta de crédito orden de compra mail de empresa Si Todas correctas.',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar e imprimir los informes de Previsión de Servicios y Servicios por habitación, Revisar en Informes Actividad Si Ent 1, Sal 15, Des 52, Occ 13.48%',
        'Revisar y sacar el Informe de Reservas Grupales en Informes Actividad Inf. Rvas Grupales Si No hay datos.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
        'Revisar que todas las habitaciones ocupadas y pendientes de check-out están marcadas como sucias Si Todo marcado.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos iniciados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos finalizados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que todos los eventos finalizados del día estén marcados como cobrados Si',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 20,
        completed: 18,
        notCompleted: 2,
        withoutAnswer: 0,
      },
      auditActivity: {
        entries: 1,
        departures: 15,
        breakfasts: 52,
        occupancyPct: 13.48,
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

  it('no acredita Actividad o Entradas sólo por el nombre de un PDF ilegible', () => {
    const emptyActivity = parseSupervisionReportText('Habitaciones con actividad 29-09-26.pdf', '');
    expect(emptyActivity.kind).toBe('DESCONOCIDO');
    expect(emptyActivity.warnings.join(' ')).toMatch(/no contiene texto legible/i);

    const unrelatedEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Documento administrativo sin reservas, habitaciones ni llegadas.',
    );
    expect(unrelatedEntries.kind).toBe('DESCONOCIDO');

    const validActivity = parseSupervisionReportText(
      'Habitaciones con actividad 29-09-26.pdf',
      'Habitaciones con actividad ID Reserva Habitación Tipo 7526721 509 Check-out 7527640 606 Ocupada',
    );
    expect(validActivity.kind).toBe('ACTIVIDAD');

    const validEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Informe operativo ID Reserva Habitación Llegada 7529001 501 Check-in',
    );
    expect(validEntries.kind).toBe('ENTRADAS');
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


  it('reemplaza el formulario recargado y no deja Gastro obsoleto de forma persistente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor recarga',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });

    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toEqual(
      expect.arrayContaining(['check:tickets-restaurante', 'check:mesas-restaurante']),
    );

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos Si Todo OK.',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes Si Todo OK.',
        ].join(' '),
      ),
    });

    stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    const checks = stored.checks as Array<{ key: string; done: boolean | null }>;
    const findings = stored.findings as Array<{ key: string }>;
    expect(checks.find((item) => item.key === 'tickets-restaurante')?.done).toBe(true);
    expect(checks.find((item) => item.key === 'mesas-restaurante')?.done).toBe(true);
    expect(findings.map((item) => item.key)).not.toContain('check:tickets-restaurante');
    expect(findings.map((item) => item.key)).not.toContain('check:mesas-restaurante');
  });

  it('permite retirar o reabrir un control sin alterar la evidencia importada', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: 'NO_APLICA',
      note: 'Restaurante cerrado por mantenimiento; control no corresponde hoy.',
    });

    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = parseSupervisionAuditReviewState(stored.reviewState);
    expect(review.checks['tickets-restaurante']?.status).toBe('NO_APLICA');
    expect(stored.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tickets-restaurante', done: false }),
    ]));
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(1);

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: null,
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(2);
  });

  it('actualiza check-outs durante el turno y una nueva carga SALIDAS vuelve a ser la fuente vigente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor salidas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 18 3',
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await updateSupervisionAuditDeparturesPending(supervisor, {
      auditImportId: stored.id,
      value: 1,
      note: 'Se completaron dos salidas; queda una pendiente de cobro.',
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(1);

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(parseSupervisionAuditReviewState(stored.reviewState).metrics.departuresPending).toBeUndefined();
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(0);
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

  it('finalizar Supervisión también crea el snapshot aunque no se haya usado Entregar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Snapshot',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    await finishSupervisionShift(supervisor, shift.id);
    const handover = await prisma.supervisionShiftHandover.findUniqueOrThrow({
      where: { supervisionShiftId: shift.id },
    });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('COBROS');
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
    ).rejects.toThrow(/apertura de Supervisión/i);
  });
});
,
        '90.000 100.000',
        'Eventos CL$ 0 CL$ 0',
        'Spa CL$ 10.000 CL$ 10.000',
        'Multas CL$ 0 CL$ 0',
        'Multas por CL$ 0 CL$ 0',
        'Fumar',
        'Multas por CL$ 0 CL$ 5.000',
        'Blancos',
        'Varios CL$ 0 CL$ 0',
        'Tasas CL$ 0 CL$ 0',
        'Totales 89 88',
        'Libres 40 39',
        'Ocupadas 49 49',
        'Con coste 49 48',
        'Cortesia 0 1',
        'Day use 0 0',
        'Bloqueadas 0 1',
        'Grupales 0 0',
        'Pasajeros 80 81',
        'Huéspedes 70 71',
        'ADR CL$ 1.837 CL$ 2.083',
        'OCC Gen 55.06% 55.68%',
        'OCC Coste 55.06% 54.55%',
        'RREV CL$ CL
    const inHouse = parseSupervisionReportText(
      'In house 27-9-26.pdf',
      'In house - Hotel HW LIBERTAD - 27/09/2026 In-house 51 0 48 Habitaciones in￾house 26 Informe generado',
    );
    expect(inHouse.kind).toBe('IN_HOUSE');
    expect(inHouse.metrics).toEqual({ inHouse: { rooms: 26 } });

    const charges = parseSupervisionReportText(
      'Cargos diarios 26-9-26.pdf',
      'Informe de cargos diarios Hotel HW LIBERTAD Ningún dato disponible en esta tabla Informe de cargos diarios Eventos Ningún dato disponible en esta tabla',
    );
    expect(charges.kind).toBe('CARGOS_DIARIOS');
    expect(charges.metrics).toEqual({ dailyCharges: { noData: true } });
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
        'Revisar en Informes Producción Salones, que las tarifas y valores estén correctas Si No hay datos disponibles.',
        'Revisar en Informes Financieros Cobros, la correcta relación entre forma de pago, moneda y tipo de documento asociado Si Todo OK.',
        'Revisar en Informes Financieros Cargos Diarios que todos los cargos están bien asociados al centro de costo correspondiente y que tengan la moneda bien cargada Si No hay cargos diarios.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar en Informes Financieros Auditoría Nocturna que estén bien todos los check in, cargos, cobros, etc Si Todo OK.',
        'Revisar en Informes Producción Centro de Coste que cuadre con producción de habitaciones, cargos diarios y tiquets Si Todo cuadra.',
        'Revisar que todas las habitaciones tienen la garantía correcta tarjeta de crédito orden de compra mail de empresa Si Todas correctas.',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar e imprimir los informes de Previsión de Servicios y Servicios por habitación, Revisar en Informes Actividad Si Ent 1, Sal 15, Des 52, Occ 13.48%',
        'Revisar y sacar el Informe de Reservas Grupales en Informes Actividad Inf. Rvas Grupales Si No hay datos.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
        'Revisar que todas las habitaciones ocupadas y pendientes de check-out están marcadas como sucias Si Todo marcado.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos iniciados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos finalizados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que todos los eventos finalizados del día estén marcados como cobrados Si',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 20,
        completed: 18,
        notCompleted: 2,
        withoutAnswer: 0,
      },
      auditActivity: {
        entries: 1,
        departures: 15,
        breakfasts: 52,
        occupancyPct: 13.48,
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

  it('no acredita Actividad o Entradas sólo por el nombre de un PDF ilegible', () => {
    const emptyActivity = parseSupervisionReportText('Habitaciones con actividad 29-09-26.pdf', '');
    expect(emptyActivity.kind).toBe('DESCONOCIDO');
    expect(emptyActivity.warnings.join(' ')).toMatch(/no contiene texto legible/i);

    const unrelatedEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Documento administrativo sin reservas, habitaciones ni llegadas.',
    );
    expect(unrelatedEntries.kind).toBe('DESCONOCIDO');

    const validActivity = parseSupervisionReportText(
      'Habitaciones con actividad 29-09-26.pdf',
      'Habitaciones con actividad ID Reserva Habitación Tipo 7526721 509 Check-out 7527640 606 Ocupada',
    );
    expect(validActivity.kind).toBe('ACTIVIDAD');

    const validEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Informe operativo ID Reserva Habitación Llegada 7529001 501 Check-in',
    );
    expect(validEntries.kind).toBe('ENTRADAS');
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


  it('reemplaza el formulario recargado y no deja Gastro obsoleto de forma persistente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor recarga',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });

    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toEqual(
      expect.arrayContaining(['check:tickets-restaurante', 'check:mesas-restaurante']),
    );

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos Si Todo OK.',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes Si Todo OK.',
        ].join(' '),
      ),
    });

    stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    const checks = stored.checks as Array<{ key: string; done: boolean | null }>;
    const findings = stored.findings as Array<{ key: string }>;
    expect(checks.find((item) => item.key === 'tickets-restaurante')?.done).toBe(true);
    expect(checks.find((item) => item.key === 'mesas-restaurante')?.done).toBe(true);
    expect(findings.map((item) => item.key)).not.toContain('check:tickets-restaurante');
    expect(findings.map((item) => item.key)).not.toContain('check:mesas-restaurante');
  });

  it('permite retirar o reabrir un control sin alterar la evidencia importada', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: 'NO_APLICA',
      note: 'Restaurante cerrado por mantenimiento; control no corresponde hoy.',
    });

    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = parseSupervisionAuditReviewState(stored.reviewState);
    expect(review.checks['tickets-restaurante']?.status).toBe('NO_APLICA');
    expect(stored.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tickets-restaurante', done: false }),
    ]));
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(1);

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: null,
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(2);
  });

  it('actualiza check-outs durante el turno y una nueva carga SALIDAS vuelve a ser la fuente vigente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor salidas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 18 3',
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await updateSupervisionAuditDeparturesPending(supervisor, {
      auditImportId: stored.id,
      value: 1,
      note: 'Se completaron dos salidas; queda una pendiente de cobro.',
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(1);

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(parseSupervisionAuditReviewState(stored.reviewState).metrics.departuresPending).toBeUndefined();
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(0);
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

  it('finalizar Supervisión también crea el snapshot aunque no se haya usado Entregar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Snapshot',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    await finishSupervisionShift(supervisor, shift.id);
    const handover = await prisma.supervisionShiftHandover.findUniqueOrThrow({
      where: { supervisionShiftId: shift.id },
    });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('COBROS');
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
    ).rejects.toThrow(/apertura de Supervisión/i);
  });
});
,
        '90.000 100.000',
        'Check-in 10 11',
        'Check-out 8 9',
        'No Show 0 0',
        'Canceladas 1 2',
        'Desayuno 70 71',
        'TOTAL CL$ CL
    const inHouse = parseSupervisionReportText(
      'In house 27-9-26.pdf',
      'In house - Hotel HW LIBERTAD - 27/09/2026 In-house 51 0 48 Habitaciones in￾house 26 Informe generado',
    );
    expect(inHouse.kind).toBe('IN_HOUSE');
    expect(inHouse.metrics).toEqual({ inHouse: { rooms: 26 } });

    const charges = parseSupervisionReportText(
      'Cargos diarios 26-9-26.pdf',
      'Informe de cargos diarios Hotel HW LIBERTAD Ningún dato disponible en esta tabla Informe de cargos diarios Eventos Ningún dato disponible en esta tabla',
    );
    expect(charges.kind).toBe('CARGOS_DIARIOS');
    expect(charges.metrics).toEqual({ dailyCharges: { noData: true } });
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
        'Revisar en Informes Producción Salones, que las tarifas y valores estén correctas Si No hay datos disponibles.',
        'Revisar en Informes Financieros Cobros, la correcta relación entre forma de pago, moneda y tipo de documento asociado Si Todo OK.',
        'Revisar en Informes Financieros Cargos Diarios que todos los cargos están bien asociados al centro de costo correspondiente y que tengan la moneda bien cargada Si No hay cargos diarios.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar en Informes Financieros Auditoría Nocturna que estén bien todos los check in, cargos, cobros, etc Si Todo OK.',
        'Revisar en Informes Producción Centro de Coste que cuadre con producción de habitaciones, cargos diarios y tiquets Si Todo cuadra.',
        'Revisar que todas las habitaciones tienen la garantía correcta tarjeta de crédito orden de compra mail de empresa Si Todas correctas.',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar e imprimir los informes de Previsión de Servicios y Servicios por habitación, Revisar en Informes Actividad Si Ent 1, Sal 15, Des 52, Occ 13.48%',
        'Revisar y sacar el Informe de Reservas Grupales en Informes Actividad Inf. Rvas Grupales Si No hay datos.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
        'Revisar que todas las habitaciones ocupadas y pendientes de check-out están marcadas como sucias Si Todo marcado.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos iniciados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos finalizados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que todos los eventos finalizados del día estén marcados como cobrados Si',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 20,
        completed: 18,
        notCompleted: 2,
        withoutAnswer: 0,
      },
      auditActivity: {
        entries: 1,
        departures: 15,
        breakfasts: 52,
        occupancyPct: 13.48,
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

  it('no acredita Actividad o Entradas sólo por el nombre de un PDF ilegible', () => {
    const emptyActivity = parseSupervisionReportText('Habitaciones con actividad 29-09-26.pdf', '');
    expect(emptyActivity.kind).toBe('DESCONOCIDO');
    expect(emptyActivity.warnings.join(' ')).toMatch(/no contiene texto legible/i);

    const unrelatedEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Documento administrativo sin reservas, habitaciones ni llegadas.',
    );
    expect(unrelatedEntries.kind).toBe('DESCONOCIDO');

    const validActivity = parseSupervisionReportText(
      'Habitaciones con actividad 29-09-26.pdf',
      'Habitaciones con actividad ID Reserva Habitación Tipo 7526721 509 Check-out 7527640 606 Ocupada',
    );
    expect(validActivity.kind).toBe('ACTIVIDAD');

    const validEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Informe operativo ID Reserva Habitación Llegada 7529001 501 Check-in',
    );
    expect(validEntries.kind).toBe('ENTRADAS');
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


  it('reemplaza el formulario recargado y no deja Gastro obsoleto de forma persistente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor recarga',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });

    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toEqual(
      expect.arrayContaining(['check:tickets-restaurante', 'check:mesas-restaurante']),
    );

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos Si Todo OK.',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes Si Todo OK.',
        ].join(' '),
      ),
    });

    stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    const checks = stored.checks as Array<{ key: string; done: boolean | null }>;
    const findings = stored.findings as Array<{ key: string }>;
    expect(checks.find((item) => item.key === 'tickets-restaurante')?.done).toBe(true);
    expect(checks.find((item) => item.key === 'mesas-restaurante')?.done).toBe(true);
    expect(findings.map((item) => item.key)).not.toContain('check:tickets-restaurante');
    expect(findings.map((item) => item.key)).not.toContain('check:mesas-restaurante');
  });

  it('permite retirar o reabrir un control sin alterar la evidencia importada', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: 'NO_APLICA',
      note: 'Restaurante cerrado por mantenimiento; control no corresponde hoy.',
    });

    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = parseSupervisionAuditReviewState(stored.reviewState);
    expect(review.checks['tickets-restaurante']?.status).toBe('NO_APLICA');
    expect(stored.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tickets-restaurante', done: false }),
    ]));
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(1);

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: null,
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(2);
  });

  it('actualiza check-outs durante el turno y una nueva carga SALIDAS vuelve a ser la fuente vigente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor salidas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 18 3',
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await updateSupervisionAuditDeparturesPending(supervisor, {
      auditImportId: stored.id,
      value: 1,
      note: 'Se completaron dos salidas; queda una pendiente de cobro.',
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(1);

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(parseSupervisionAuditReviewState(stored.reviewState).metrics.departuresPending).toBeUndefined();
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(0);
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

  it('finalizar Supervisión también crea el snapshot aunque no se haya usado Entregar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Snapshot',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    await finishSupervisionShift(supervisor, shift.id);
    const handover = await prisma.supervisionShiftHandover.findUniqueOrThrow({
      where: { supervisionShiftId: shift.id },
    });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('COBROS');
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
    ).rejects.toThrow(/apertura de Supervisión/i);
  });
});
,
        '100.000 120.000',
        'Informe generado el 02/09/2026 09:57:43',
      ].join('\n'),
    );

    expect(parsed.kind).toBe('VENTAS_PERIODO');
    expect(parsed.reportedBusinessDate).toBe('2026-09-01');
    expect(parsed.metrics).toMatchObject({
      salesPeriod: {
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        visibleDays: 2,
        truncated: false,
        totals: { courtesyRooms: 1 },
      },
    });
    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'sales-period:courtesy', severity: 'ALTA' }),
      ]),
    );
  });

  it('normaliza In house y detecta un informe de cargos sin actividad', () => {
    const inHouse = parseSupervisionReportText(
      'In house 27-9-26.pdf',
      'In house - Hotel HW LIBERTAD - 27/09/2026 In-house 51 0 48 Habitaciones in￾house 26 Informe generado',
    );
    expect(inHouse.kind).toBe('IN_HOUSE');
    expect(inHouse.metrics).toEqual({ inHouse: { rooms: 26 } });

    const charges = parseSupervisionReportText(
      'Cargos diarios 26-9-26.pdf',
      'Informe de cargos diarios Hotel HW LIBERTAD Ningún dato disponible en esta tabla Informe de cargos diarios Eventos Ningún dato disponible en esta tabla',
    );
    expect(charges.kind).toBe('CARGOS_DIARIOS');
    expect(charges.metrics).toEqual({ dailyCharges: { noData: true } });
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
        'Revisar en Informes Producción Salones, que las tarifas y valores estén correctas Si No hay datos disponibles.',
        'Revisar en Informes Financieros Cobros, la correcta relación entre forma de pago, moneda y tipo de documento asociado Si Todo OK.',
        'Revisar en Informes Financieros Cargos Diarios que todos los cargos están bien asociados al centro de costo correspondiente y que tengan la moneda bien cargada Si No hay cargos diarios.',
        'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
        'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        'Revisar en Informes Financieros Auditoría Nocturna que estén bien todos los check in, cargos, cobros, etc Si Todo OK.',
        'Revisar en Informes Producción Centro de Coste que cuadre con producción de habitaciones, cargos diarios y tiquets Si Todo cuadra.',
        'Revisar que todas las habitaciones tienen la garantía correcta tarjeta de crédito orden de compra mail de empresa Si Todas correctas.',
        'Revisar si hay cuentas que exceden los 7 días y que la garantía podría haber expirado. Informes Financieros Cuentas sobre días Si Se observa que la Reserva con ID 7484708 tiene un pendiente de 20 CLP (probablemente por error de facturación o tipo de cambio), No se puede cambiar el elemento porque el día está cerrado.',
        'Revisar e imprimir los informes de Previsión de Servicios y Servicios por habitación, Revisar en Informes Actividad Si Ent 1, Sal 15, Des 52, Occ 13.48%',
        'Revisar y sacar el Informe de Reservas Grupales en Informes Actividad Inf. Rvas Grupales Si No hay datos.',
        'Revisar si hay facturas rechazadas Si No existen facturas rechazadas.',
        'Revisar que todas las habitaciones ocupadas y pendientes de check-out están marcadas como sucias Si Todo marcado.',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos iniciados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que estén todos los eventos finalizados del día realizados Si',
        'Revisar en Inicio Auditoría Nocturna que todos los eventos finalizados del día estén marcados como cobrados Si',
      ].join(' '),
    );

    expect(parsed.kind).toBe('AUDITORIA_FORMULARIO');
    expect(parsed.metrics).toMatchObject({
      audit: {
        controls: 20,
        completed: 18,
        notCompleted: 2,
        withoutAnswer: 0,
      },
      auditActivity: {
        entries: 1,
        departures: 15,
        breakfasts: 52,
        occupancyPct: 13.48,
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

  it('no acredita Actividad o Entradas sólo por el nombre de un PDF ilegible', () => {
    const emptyActivity = parseSupervisionReportText('Habitaciones con actividad 29-09-26.pdf', '');
    expect(emptyActivity.kind).toBe('DESCONOCIDO');
    expect(emptyActivity.warnings.join(' ')).toMatch(/no contiene texto legible/i);

    const unrelatedEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Documento administrativo sin reservas, habitaciones ni llegadas.',
    );
    expect(unrelatedEntries.kind).toBe('DESCONOCIDO');

    const validActivity = parseSupervisionReportText(
      'Habitaciones con actividad 29-09-26.pdf',
      'Habitaciones con actividad ID Reserva Habitación Tipo 7526721 509 Check-out 7527640 606 Ocupada',
    );
    expect(validActivity.kind).toBe('ACTIVIDAD');

    const validEntries = parseSupervisionReportText(
      'Entradas 29-09-26.pdf',
      'Informe operativo ID Reserva Habitación Llegada 7529001 501 Check-in',
    );
    expect(validEntries.kind).toBe('ENTRADAS');
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


  it('reemplaza el formulario recargado y no deja Gastro obsoleto de forma persistente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor recarga',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });

    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    expect((stored.findings as Array<{ key: string }>).map((item) => item.key)).toEqual(
      expect.arrayContaining(['check:tickets-restaurante', 'check:mesas-restaurante']),
    );

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos Si Todo OK.',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes Si Todo OK.',
        ].join(' '),
      ),
    });

    stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });
    const checks = stored.checks as Array<{ key: string; done: boolean | null }>;
    const findings = stored.findings as Array<{ key: string }>;
    expect(checks.find((item) => item.key === 'tickets-restaurante')?.done).toBe(true);
    expect(checks.find((item) => item.key === 'mesas-restaurante')?.done).toBe(true);
    expect(findings.map((item) => item.key)).not.toContain('check:tickets-restaurante');
    expect(findings.map((item) => item.key)).not.toContain('check:mesas-restaurante');
  });

  it('permite retirar o reabrir un control sin alterar la evidencia importada', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor revisión',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Formulario Auditoria 27-09-26.pdf',
        [
          'Formulario auditoría 27/09/2026',
          'En Gastro Informes Tiquets, cotejamos todos los tiquet de restaurante pagados con los tíquets físicos No',
          'Revisar si hay mesas sin cerrar en Restaurante. Gastro Informes Cuentas Pendientes No',
        ].join(' '),
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: 'NO_APLICA',
      note: 'Restaurante cerrado por mantenimiento; control no corresponde hoy.',
    });

    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    const review = parseSupervisionAuditReviewState(stored.reviewState);
    expect(review.checks['tickets-restaurante']?.status).toBe('NO_APLICA');
    expect(stored.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'tickets-restaurante', done: false }),
    ]));
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(1);

    await reviewSupervisionAuditItem(supervisor, {
      auditImportId: stored.id,
      target: 'CHECK',
      key: 'tickets-restaurante',
      status: null,
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      auditOperationalPendingCount({
        metrics: stored.metrics,
        checks: stored.checks as Array<{ key: string; done: boolean | null }>,
        findings: stored.findings as Array<{ key: string }>,
        reviewState: stored.reviewState,
      }),
    ).toBe(2);
  });

  it('actualiza check-outs durante el turno y una nueva carga SALIDAS vuelve a ser la fuente vigente', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor salidas',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-27T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 18 3',
      ),
    });
    let stored = await prisma.supervisionAuditImport.findFirstOrThrow({
      where: { supervisionShiftId: shift.id, businessDate },
    });

    await updateSupervisionAuditDeparturesPending(supervisor, {
      auditImportId: stored.id,
      value: 1,
      note: 'Se completaron dos salidas; queda una pendiente de cobro.',
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(1);

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Salidas 27-9-26.pdf',
        'Informe de salidas Total Realizado Pendiente Check-out 21 21 0',
      ),
    });
    stored = await prisma.supervisionAuditImport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(parseSupervisionAuditReviewState(stored.reviewState).metrics.departuresPending).toBeUndefined();
    expect(
      effectiveDeparturePending(
        stored.metrics,
        parseSupervisionAuditReviewState(stored.reviewState),
      ),
    ).toBe(0);
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

  it('finalizar Supervisión también crea el snapshot aunque no se haya usado Entregar', async () => {
    const supervisor = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      name: 'Supervisor Snapshot',
    });
    const shift = await startSupervisionShift(supervisor, { priorities: [] });
    const businessDate = new Date('2026-09-26T00:00:00.000Z');

    await mergeSupervisionAuditReport(supervisor, {
      businessDate,
      parsed: parseSupervisionReportText(
        'Cobros 26-9-26.pdf',
        'Operaciones de caja Reservas Totales por moneda CL$ CL$ 1.039.180 10 US$ US$ 48.26 1 Informe generado',
      ),
    });

    await finishSupervisionShift(supervisor, shift.id);
    const handover = await prisma.supervisionShiftHandover.findUniqueOrThrow({
      where: { supervisionShiftId: shift.id },
    });
    const snapshot = handover.snapshot as {
      auditImports?: Array<{ reportKinds: string[] }>;
      summary?: { dailyAuditImports?: number };
    };

    expect(snapshot.auditImports?.[0]?.reportKinds).toContain('COBROS');
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
    ).rejects.toThrow(/apertura de Supervisión/i);
  });
});
