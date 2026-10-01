import { describe, expect, it } from 'vitest';
import { slotSchema } from '@/domain/schedule';
import { scheduleImportOmittedRows, scheduleImportRowStarted } from '@/domain/schedule-import-timing';

const templates = [{ id: 'cday0000000000000000000001', startTime: '08:00', endTime: '19:00', crossesMidnight: false }, { id: 'cnight00000000000000000001', startTime: '21:00', endTime: '08:00', crossesMidnight: true }];
const turn = (date: string, templateId = templates[0]!.id) => slotSchema.parse({ collaboratorId: 'cperson000000000000000001', date, kind: 'TURNO', templateId });
describe('filas de horario que ya comenzaron, en hora del hotel', () => {
  it('omite al comenzar exactamente, pero permite la noche de hoy que aún no inicia', () => {
    const now = new Date('2026-10-01T11:00:00Z'); // 08:00 Santiago
    expect(scheduleImportRowStarted(turn('2026-10-01'), templates, now)).toBe(true);
    expect(scheduleImportRowStarted(turn('2026-10-01'), templates, new Date(now.getTime() - 1))).toBe(false);
    expect(scheduleImportRowStarted(turn('2026-10-01', templates[1]!.id), templates, now)).toBe(false);
  });
  it('conserva la fecha local cerca de medianoche y omite noches iniciadas', () => {
    const now = new Date('2026-10-02T01:00:00Z'); // 22:00 del 1 de octubre
    expect(scheduleImportRowStarted(turn('2026-10-01', templates[1]!.id), templates, now)).toBe(true);
    expect(scheduleImportRowStarted(slotSchema.parse({ ...turn('2026-10-01'), kind: 'LIBRE' }), templates, now)).toBe(false);
    expect(scheduleImportRowStarted(turn('2026-10-02'), templates, now)).toBe(false);
  });
  it('omite descansos pasados y expone los índices de un archivo mixto', () => {
    const rows = [turn('2026-09-30'), turn('2026-10-01'), turn('2026-10-01', templates[1]!.id), slotSchema.parse({ ...turn('2026-09-30'), kind: 'LIBRE' })].map(input => ({ input }));
    expect(scheduleImportOmittedRows(rows, templates, new Date('2026-10-01T18:00:00Z'))).toEqual([0, 1, 3]);
  });
  it('no disfraza personas o plantillas inválidas como filas omitidas', () => {
    expect(scheduleImportOmittedRows([{ input: null }, { input: turn('2026-10-01', 'cmissing0000000000000001') }], templates, new Date('2026-10-01T18:00:00Z'))).toEqual([]);
  });
});
