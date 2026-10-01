import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractScheduleRoster } from '@/domain/schedule-import';
import type { TextFragment } from '@/domain/pms/layout';
function fragments(rows: string[][]): TextFragment[] { return rows.flatMap((r, i) => r.map((text, j) => ({ page: 1, x: 40 + j * 120, y: 800 - i * 20, text }))); }
describe('lectura determinística de mallas', () => {
  it('lee una fila por asignación con código estable y horas', () => {
    const input = fragments([['ID_COLABORADOR','FECHA','CODIGO','INICIO','TERMINO'],['COL001','2026-10-01','RD01','08:00','19:00'],['COL002','02/10/2026','LIBRE','','']]);
    const out = extractScheduleRoster(input, '2026-10-01', '2026-10-08'); expect(out.issues).toEqual([]); expect(out.rows[0]).toMatchObject({ employeeCode: 'COL001', code: 'RD01', startTime: '08:00', endTime: '19:00' }); expect(out.rows[1]?.code).toBe('LIBRE');
  });
  it('lee fechas en columnas sin interpretar casillas vacías como descanso', () => {
    const input = fragments([['COLABORADOR','2026-10-01','2026-10-02'],['COL001','RD01',''],['COL002','LIBRE','RN01']]);
    const out = extractScheduleRoster(input, '2026-10-01', '2026-10-08'); expect(out.rows).toHaveLength(3); expect(out.issues).toHaveLength(1); expect(out.issues[0]).toContain('no se interpreta');
  });
  it('reproduce la glosa y las cuatro páginas de ocho días del PDF aportado, con nombres anonimizados', () => {
    const input = JSON.parse(readFileSync('tests/fixtures/schedule-glosa.json', 'utf8')) as TextFragment[];
    const out = extractScheduleRoster(input, '2026-10-01', '2026-11-01'); expect(out.issues).toEqual([]); expect(out.rows).toHaveLength(192); expect(out.rows.filter((r) => r.code === 'LIBRE')).toHaveLength(96); expect(out.rows.filter((r) => r.code === 'RN01').every((r) => r.startTime === '21:00' && r.endTime === '08:00')).toBe(true); expect(new Set(out.rows.map((r) => r.date)).size).toBe(32);
  });
  it('exige cabeceras reconocibles y no inventa datos desde un PDF arbitrario', () => {
    expect(extractScheduleRoster(fragments([['Mensaje', 'sin calendario']]), '2026-10-01', '2026-10-08').rows).toEqual([]);
  });
});
