import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatAuditValue } from '@/domain/audit-display';
import { formatDateTime } from '@/lib/format';
import { parseHotelDateTimeLocal } from '@/domain/time';

describe('F16 evidencia y fechas coherentes', () => {
  it('muestra objetos, listas, falsos y ceros sin [object Object]', () => {
    expect(formatAuditValue({ estado: 'ACTIVO', fondo: { CLP: 0 }, validaciones: [{ validada: false }, { validada: true }], nota: null }))
      .toBe('estado: ACTIVO · fondo: CLP: 0 · validaciones: validada: No; validada: Sí · nota: —');
  });
  it('conserva texto y valores escalares de evidencia', () => {
    expect(formatAuditValue('motivo original')).toBe('motivo original');
    expect(formatAuditValue(-50)).toBe('-50');
    expect(formatAuditValue([])).toBe('Sin elementos');
  });
  it.each(['2026-07-05T13:50', '2026-10-05T13:50'])('conserva hora hotel en invierno/verano: %s', value => {
    expect(formatDateTime(parseHotelDateTimeLocal(value))).toContain('13:50');
  });
  it('Caja del relevo reutiliza el mismo formateador de Caja e historial', () => {
    const source = readFileSync('src/components/operational/cash-box.tsx','utf8');
    for (const name of ['state.declared.countedAt','state.confirmed.countedAt','guarantee.dueAt','formalClosure.closedAt']) expect(source).toContain(`formatDateTime(${name})`);
    expect(source).toContain('Horas en America/Santiago');
  });
});
