import { describe, expect, it } from 'vitest';
import { evaluateReportFreshness, parseFnsGeneratedAt, validateClosureReportSet } from '@/domain/pms/freshness';

describe('frescura de informes FNS', () => {
  it('interpreta la hora impresa en America/Santiago', () => {
    expect(parseFnsGeneratedAt('17/09/2026 19:21:37')?.toISOString()).toBe('2026-09-17T22:21:37.000Z');
  });

  it('acepta exactamente 8 horas y rechaza al superar el límite', () => {
    const generated = '17/09/2026 19:21:37';
    expect(evaluateReportFreshness(generated, new Date('2026-09-18T06:21:37.000Z')).status).toBe('VALIDO');
    expect(evaluateReportFreshness(generated, new Date('2026-09-18T06:21:38.000Z')).status).toBe('VENCIDO');
  });

  it('rechaza timestamp ausente y una hora futura', () => {
    expect(evaluateReportFreshness(null).status).toBe('INVALIDO');
    expect(evaluateReportFreshness('17/09/2026 20:00:00', new Date('2026-09-17T22:30:00.000Z')).status).toBe('INVALIDO');
  });

  it('el cierre exige Actividad, Salidas e In-house: Entradas no sustituye ninguno', () => {
    const now = new Date('2026-09-17T22:30:00.000Z');
    const fresh = '17/09/2026 19:25:00';
    const result = validateClosureReportSet([
      { kind: 'ACTIVIDAD', reportGeneratedAt: fresh },
      { kind: 'SALIDAS', reportGeneratedAt: fresh },
      { kind: 'ENTRADAS', reportGeneratedAt: fresh },
    ], now);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['IN_HOUSE']);
  });

  it('rechaza el conjunto si uno de los tres está vencido', () => {
    const now = new Date('2026-09-17T22:30:00.000Z');
    const result = validateClosureReportSet([
      { kind: 'ACTIVIDAD', reportGeneratedAt: '17/09/2026 19:25:00' },
      { kind: 'SALIDAS', reportGeneratedAt: '17/09/2026 19:20:00' },
      { kind: 'IN_HOUSE', reportGeneratedAt: '17/09/2026 18:00:00' },
    ], now);
    expect(result.valid).toBe(false);
    expect(result.invalid.map((x) => x.kind)).toEqual(['IN_HOUSE']);
  });
});
