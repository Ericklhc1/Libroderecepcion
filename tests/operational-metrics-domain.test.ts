import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TASK_COMPLETED_STATUSES, ENTRY_RESOLVED_STATUSES, metricPeriod, normalizeMetricDays, incidentResolutionAt, signedMoney } from '@/domain/operational-metrics';
import { hotelDateKey, hotelDayStart, hotelDayEnd } from '@/domain/time';
import { getManagementDecisionAdvice } from '@/server/services/management';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';

const now = new Date('2026-10-05T17:00:00Z');
describe('métricas canónicas de Gerencia e Indicadores', () => {
  it.each([[7, '2026-09-29'], [30, '2026-09-06'], [90, '2026-07-08']])('usa %i fechas hoteleras incluyendo hoy parcial', (days, start) => {
    const period = metricPeriod(Number(days), now);
    expect(hotelDateKey(period.current.from)).toBe(start);
    expect(period.current.to).toBe(now);
    expect(period.previous.to.getTime()).toBe(period.current.from.getTime() - 1);
    expect(period.current.from).toEqual(hotelDayStart(period.current.from));
  });
  it.each([NaN, 0, -7, 21, Infinity, 365])('normaliza rango no soportado %s sin ampliar universo', input => {
    expect(normalizeMetricDays(input)).toBe(30);
  });
  it('mantiene días locales incluso al cruzar el cambio de hora', () => {
    const period = metricPeriod(7, new Date('2026-09-08T14:00:00Z'));
    expect(hotelDateKey(period.current.from)).toBe('2026-09-02');
    expect(hotelDateKey(period.previous.from)).toBe('2026-08-26');
    expect(period.current.from.toISOString()).toBe('2026-09-02T04:00:00.000Z');
  });
  it('día sin medianoche comienza a la 01:00 y termina antes de la siguiente fecha', () => {
    const day = new Date('2026-09-06T15:00:00Z');
    expect(hotelDayStart(day).toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(hotelDayEnd(day).toISOString()).toBe('2026-09-07T02:59:59.999Z');
    expect(hotelDayEnd(new Date('2026-09-05T15:00:00Z')).toISOString()).toBe('2026-09-06T03:59:59.999Z');
  });
  it('el día del retroceso de reloj conserva sus 25 horas', () => {
    const day = new Date('2026-04-04T15:00:00Z');
    expect(hotelDayStart(day).toISOString()).toBe('2026-04-04T03:00:00.000Z');
    expect(hotelDayEnd(day).toISOString()).toBe('2026-04-05T03:59:59.999Z');
  });
  it('rango iniciado a medianoche no retrocede al día previo por DST', () => {
    expect(hotelDateKey(metricPeriod(30, new Date('2026-10-05T03:30:00Z')).current.from)).toBe('2026-09-06');
  });
  it('cuenta completadas y validadas como éxito; cancelar y esperar validación no', () => {
    expect(TASK_COMPLETED_STATUSES).toEqual(['COMPLETADA', 'VALIDADA']);
    expect(ENTRY_RESOLVED_STATUSES).toEqual(['RESUELTO', 'CERRADO']);
  });
  it('resolución prevalece al cierre y nunca inventa una fecha faltante', () => {
    const closedAt = new Date(now.getTime() + 3600000);
    expect(incidentResolutionAt({ resolvedAt: now, closedAt })).toBe(now);
    expect(incidentResolutionAt({ resolvedAt: null, closedAt })).toBe(closedAt);
    expect(incidentResolutionAt({ resolvedAt: null, closedAt: null })).toBeNull();
  });
  it.each([[-50, 'CLP -50'], [50, 'CLP +50'], [0, 'CLP 0'], [-0.75, 'CLP -0,75']])('conserva moneda y signo de %s', (amount, expected) => {
    expect(signedMoney('CLP', Number(amount))).toBe(expected);
  });
  it('recomendación es la regla conocida, sin proveedor ni nuevos hechos', async () => {
    const decision = { id: 'cash', title: 'Diferencia', fact: 'CLP -50', why: 'Causa no acreditada', action: 'Revisar el arqueo', href: '/caja', severity: 'critica' as const, evidence: [] };
    expect(await getManagementDecisionAdvice([decision])).toEqual({ cash: 'Revisar el arqueo' });
    expect(await getManagementDecisionAdvice([])).toEqual({});
  });
  it('mantiene período al saltar a Indicadores y muestra límites de las muestras', () => {
    const page = readFileSync('src/app/(app)/gerencia/page.tsx', 'utf8');
    expect(page).toContain('href={`/indicadores?dias=${cockpit.period.days}`}');
    expect(page).toContain('Muestra: {decision.evidence.length} de {decision.evidenceTotal}');
    expect(page).toContain('Ver todo');
    const service = readFileSync('src/server/services/management.ts', 'utf8');
    expect(service).not.toContain('sortDecisions(decisions).slice');
    expect(service).not.toContain('const overdueTasks = overdueTaskRows.length');
  });
  it('Fronti reconoce evidencia con filtro de piso, conteo y período', () => {
    const page = resolveFrontiPageContext({ pathname: '/gerencia/evidencia', search: '?tipo=keys-risk&piso=4&conteo=abc&dias=7' });
    expect(page).toMatchObject({ moduleKey: 'gerencia', sectionKey: 'evidencia', filters: { piso: '4', conteo: 'abc', dias: '7' } });
  });
});
