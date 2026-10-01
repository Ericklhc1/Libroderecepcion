import { describe, expect, it } from 'vitest';
import { scheduleLabel, collaboratorReference } from '@/domain/schedule-display';
import { isScheduleReview } from '@/server/ai/fronti-v2/schedule-context';

describe('horarios comprensibles y uniformes', () => {
  it('conserva código y reloj de 24 horas e identifica la noche', () => {
    expect(scheduleLabel({ kind: 'TURNO', code: 'RN01', startTime: '21:00', endTime: '08:00', crossesMidnight: true })).toBe('RN01 · 21:00–08:00 (día siguiente)');
    expect(scheduleLabel({ kind: 'LIBRE', code: 'LIBRE' })).toBe('Libre');
    expect(scheduleLabel({ code: 'RD01', startTime: '08:00', endTime: '19:00' })).toBe('RD01 · 08:00–19:00');
  });
  it('identifica por usuario sin exponer códigos internos generados', () => {
    expect(collaboratorReference({ employeeCode: 'USR_123', username: 'javier' })).toBe('@javier');
    expect(collaboratorReference({ employeeCode: 'USR_123' })).toBe('');
    expect(collaboratorReference({ employeeCode: 'COL001' })).toBe('COL001');
  });
  it('la revisión verificada no sustituye escrituras ni preguntas de otro módulo', () => {
    expect(isScheduleReview('Revisa este horario y el archivo', 'equipo')).toBe(true);
    expect(isScheduleReview('Revisa esto y publica el horario', 'equipo')).toBe(false);
    expect(isScheduleReview('Revisa la caja', 'equipo')).toBe(false);
    expect(isScheduleReview('Revisa el horario', 'caja')).toBe(false);
  });
});
