import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleCsvTemplate, scheduleCsvText, scheduleImportIdentifier } from '@/domain/schedule-csv';
import { extractScheduleRoster } from '@/domain/schedule-import';
import { readReportFile } from '@/server/pms/read-report-file';
import { GET } from '@/app/api/equipo/plantilla/route';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), assertScheduleArea: vi.fn(), getScheduleBoard: vi.fn() }));
vi.mock('@/server/auth/guard', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/server/api/maintenance', () => ({ withMaintenance: (handler: unknown) => handler }));
vi.mock('@/server/services/schedule-access', () => ({ assertScheduleArea: mocks.assertScheduleArea }));
vi.mock('@/server/services/schedules', () => ({ getScheduleBoard: mocks.getScheduleBoard }));

const people = [{ employeeCode: 'USR_A', name: 'Nombre compartido', username: 'persona.uno' }, { employeeCode: 'USR_B', name: 'Nombre compartido', username: 'persona.dos' }];

describe('F13 · plantilla CSV legible, literal y acotada al área', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: 'actor' }); mocks.getScheduleBoard.mockResolvedValue({ collaborators: people }); });

  it('incluye una identidad visible por persona incluso cuando los nombres coinciden', () => {
    const csv = scheduleCsvTemplate(people);
    expect(csv).toContain('ID_COLABORADOR;NOMBRE;FECHA;CODIGO;INICIO;TERMINO');
    expect(csv).toContain('@persona.uno'); expect(csv).toContain('@persona.dos');
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(scheduleImportIdentifier({ employeeCode: 'COL001', name: 'Histórico' })).toBe('COL001');
  });

  it('escapa separadores, comillas y fórmulas sin modificar la identidad de importación', async () => {
    const csv = scheduleCsvTemplate([{ employeeCode: 'COL001', username: 'persona.uno', name: '=1+1;"dato"' }]);
    expect(csv).toContain('"\'@persona.uno"'); expect(csv).toContain('"\'=1+1;""dato"""');
    const completed = csv.replace(/;"";"";"";""\r\n$/, ';"2090-10-03";"LIBRE";"";""\r\n');
    const files = await readReportFile('horario.csv', new TextEncoder().encode(completed), { preserveClockCells: true });
    const result = extractScheduleRoster(files[0]!.fragments, '2090-10-01', '2090-10-08');
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({ employeeCode: '@persona.uno', name: '=1+1;"dato"', code: 'LIBRE', date: '2090-10-03' });
    expect(scheduleCsvText("'Nombre")).toBe("'Nombre");
  });

  it('reconoce el identificador literal descargado también en una malla con fechas en columnas', async () => {
    const exportedIdentity = scheduleCsvTemplate([people[0]!]).split('\r\n')[1]!.split(';')[0]!;
    const csv = `ID_COLABORADOR;2090-10-03;2090-10-04\r\n${exportedIdentity};LIBRE;LIBRE\r\n`;
    const files = await readReportFile('malla.csv', new TextEncoder().encode(csv), { preserveClockCells: true });
    const result = extractScheduleRoster(files[0]!.fragments, '2090-10-01', '2090-10-08');
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row.employeeCode)).toEqual(['@persona.uno', '@persona.uno']);
    expect(result.rows.map(row => row.name)).toEqual(['@persona.uno', '@persona.uno']);
  });

  it('requiere un área explícita antes de entregar personas', async () => {
    const response = await GET(new Request('https://example.invalid/api/equipo/plantilla'));
    expect(response.status).toBe(400); expect(mocks.getScheduleBoard).not.toHaveBeenCalled();
  });

  it('comprueba permiso/alcance y usa la malla elegida para descargar', async () => {
    const response = await GET(new Request('https://example.invalid/api/equipo/plantilla?area=hk&malla=octubre'));
    expect(mocks.assertScheduleArea).toHaveBeenCalledWith({ id: 'actor' }, 'hk', 'schedule.manage');
    expect(mocks.getScheduleBoard).toHaveBeenCalledWith({ id: 'actor' }, 'hk', 'octubre');
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain('@persona.uno');
  });

  it('no entrega contenido ante un área no autorizada o una malla ajena', async () => {
    mocks.assertScheduleArea.mockRejectedValueOnce(new Error('Fuera de alcance'));
    expect((await GET(new Request('https://example.invalid/api/equipo/plantilla?area=ajena'))).status).toBe(403);
    expect(mocks.getScheduleBoard).not.toHaveBeenCalled();
    mocks.getScheduleBoard.mockRejectedValueOnce(new Error('Malla de otra área'));
    const response = await GET(new Request('https://example.invalid/api/equipo/plantilla?area=hk&malla=otra'));
    expect(response.status).toBe(403); expect(await response.text()).not.toContain('@persona');
  });
});
