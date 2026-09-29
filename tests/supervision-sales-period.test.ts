import { describe, expect, it } from 'vitest';
import {
  parseSalesPeriodReport,
  salesPeriodFindings,
} from '@/domain/supervision-sales-period';

const SAMPLE = `
Informe detalle ventas periodo: Hotel HW LIBERTAD (01/09/2026 - 30/09/2026)
Centro
Alojamiento de coste 01/09/2026 02/09/2026 03/09/2026 04/09/20
Hotel HW CL$ CL$ CL$ CL$
LIBERTAD 100.000 120.000 130.000 140.00
Alojamiento CL$ CL$ CL$ CL$
90.000 100.000 120.000 130.00
Eventos CL$ 0 CL$ 0 CL$ 0 CL$ 0
Spa CL$ 10.000 CL$ 10.000 CL$ 10.000 CL$ 10.00
Multas CL$ 0 CL$ 0 CL$ 0 CL$ 0
Multas por CL$ 0 CL$ 0 CL$ 0 CL$ 0
Fumar
Multas por CL$ 0 CL$ 5.000 CL$ 0 CL$ 0
Blancos
(ropa de
cama)
Varios CL$ 0 CL$ 0 CL$ 0 CL$ 0
Tasas CL$ 0 CL$ 0 CL$ 0 CL$ 0
Totales 89 88 89 89
Libres 40 39 39 40
Ocupadas 49 49 50 49
totales
Con coste 49 48 50 49
Cortesia 0 1 0 0
Day use 0 0 0 0
Bloqueadas 0 1 0 0
Grupales 0 0 0 0
Pasajeros 80 81 82 83
Huéspedes 70 71 72 73
ADR CL$ 1.837 CL$ 2.083 CL$ 2.400 CL$ 2.653
OCC Gen 55.06% 55.68% 56.18% 55.06%
OCC Coste 55.06% 54.55% 56.18% 55.06%
RREV CL$ CL$ CL$ CL$
90.000 100.000 120.000 130.00
Check-in 10 11 12 13
Check-out 8 9 10 11
No Show 0 0 1 0
Canceladas 1 2 3 4
Desayuno 70 71 72 73
TOTAL CL$ CL$ CL$ CL$
100.000 120.000 130.000 140.00
Informe generado el 04/09/2026 09:57:43
`;

describe('ventas por período de FNS', () => {
  it('extrae centros de coste, ocupación y cobertura sin inventar columnas cortadas', () => {
    const parsed = parseSalesPeriodReport(SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed?.periodStart).toBe('2026-09-01');
    expect(parsed?.periodEnd).toBe('2026-09-30');
    expect(parsed?.visibleDays).toBe(3);
    expect(parsed?.expectedVisibleDays).toBe(4);
    expect(parsed?.visibleThrough).toBe('2026-09-03');
    expect(parsed?.truncated).toBe(true);

    expect(parsed?.daily[1]).toMatchObject({
      date: '2026-09-02',
      totalRooms: 88,
      occupiedRooms: 49,
      occupiedWithCost: 48,
      courtesyRooms: 1,
      blockedRooms: 1,
      checkIns: 11,
      checkOuts: 9,
    });
    expect(parsed?.daily[1]?.costCenters).toMatchObject({
      alojamiento: 100000,
      spa: 10000,
      multasBlancos: 5000,
    });
  });

  it('preserva créditos negativos y no toma valores de la fila siguiente', () => {
    const withCredit = SAMPLE.replace(
      'Spa CL$ 10.000 CL$ 10.000 CL$ 10.000 CL$ 10.00',
      'Spa CL$ -10.000 CL$ 10.000 CL$ 10.000 CL$ 10.00',
    );
    expect(parseSalesPeriodReport(withCredit)?.daily[0]?.costCenters.spa).toBe(-10_000);

    const clippedEvents = SAMPLE.replace(
      'Eventos CL$ 0 CL$ 0 CL$ 0 CL$ 0',
      'Eventos CL$ 0 CL$ 0',
    );
    const parsed = parseSalesPeriodReport(clippedEvents);
    expect(parsed?.visibleDays).toBe(2);
    expect(parsed?.visibleThrough).toBe('2026-09-02');
    expect(parsed?.truncated).toBe(true);
    expect(parsed?.daily[1]?.costCenters.eventos).toBe(0);
  });

  it('eleva cortesías y descuadres de centros de coste sin convertirlos en hechos no demostrados', () => {
    const parsed = parseSalesPeriodReport(SAMPLE);
    expect(parsed).not.toBeNull();
    const findings = salesPeriodFindings(parsed!);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'sales-period:coverage',
          severity: 'MEDIA',
        }),
        expect.objectContaining({
          key: 'sales-period:courtesy',
          severity: 'ALTA',
        }),
        expect.objectContaining({
          key: 'sales-period:cost-center-total',
          severity: 'MEDIA',
        }),
      ]),
    );
    expect(
      findings.find((finding) => finding.key === 'sales-period:courtesy')?.detail,
    ).toContain('2026-09-02');
  });
});
