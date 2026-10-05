import { scheduleCsvText } from './schedule-csv';
import { dateDays, functionKey, validDate } from './schedule';
import type { TextFragment } from './pms/layout';

export type RosterRow = { employeeCode: string | null; name: string | null; date: string; code: string; startTime: string | null; endTime: string | null };
export type RosterExtraction = { rows: RosterRow[]; issues: string[] };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dateOf(text: string, start: string, end: string): string | null {
  const s = text.trim().toLowerCase(); if (validDate(s)) return s;
  const full = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (full) { const d = `${full[3]}-${full[2]!.padStart(2, '0')}-${full[1]!.padStart(2, '0')}`; return validDate(d) ? d : null; }
  const short = /^(\d{1,2})[- /](\d{1,2}|[a-záéíóú]{3,})$/.exec(s); if (!short) return null;
  const month = /^\d+$/.test(short[2]!) ? Number(short[2]) : MONTHS.indexOf(short[2]!.slice(0, 3)) + 1;
  if (month < 1 || month > 12) return null;
  const matches = dateDays(start, end).filter((d) => Number(d.slice(5, 7)) === month && Number(d.slice(8)) === Number(short[1])); return matches.length === 1 ? matches[0]! : null;
}
const timeOf = (value: string | undefined) => { const match = value?.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$/); if (match) return `${match[1]!.padStart(2, '0')}:${match[2]}`; if (value && /^0(?:\.\d+)?$/.test(value.trim())) { const minutes = Math.round(Number(value) * 1440); if (minutes < 1440) return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; } return null; };
function grouped(fragments: TextFragment[]): TextFragment[][] {
  const rows: TextFragment[][] = [];
  for (const f of [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = rows[rows.length - 1]; if (last && Math.abs(last[0]!.y - f.y) <= 3) last.push(f); else rows.push([f]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}
const key = (s: string) => functionKey(s).replace(/[^a-z0-9]/g, '');
const codeOf = (s: string) => { const k = key(s); return k === 'libre' || k === 'l' ? 'LIBRE' : k === 'vacaciones' ? 'VACACIONES' : k === 'ausencia' ? 'AUSENCIA' : s.trim().toUpperCase(); };

/** Deterministic readers: positioned PDF glosa, wide grids, or a row per assignment. */
export function extractScheduleRoster(fragments: TextFragment[], start: string, end: string): RosterExtraction {
  dateDays(start, end); const result: RosterExtraction = { rows: [], issues: [] };
  for (const page of [...new Set(fragments.map((f) => f.page))]) {
    const lines = grouped(fragments.filter((f) => f.page === page));
    const glosa = lines.some((r) => r.some((f) => key(f.text) === 'codigoturno'));
    const headerIndex = lines.findIndex((r) => r.filter((f) => dateOf(f.text, start, end)).length >= 2 || r.some((f) => ['fecha', 'date'].includes(key(f.text))));
    if (headerIndex < 0) { result.issues.push(`Página/hoja ${page}: no se reconocieron fechas. Usa la plantilla de carga.`); continue; }
    const header = lines[headerIndex]!; const dateColumns = header.flatMap((f) => { const date = dateOf(f.text, start, end); return date ? [{ x: f.x, date }] : []; });
    if (dateColumns.length >= 2) {
      let name: string | null = null; let identity: string | null = null;
      const firstX = Math.min(...dateColumns.map((c) => c.x));
      const nearest = (r: TextFragment[], x: number) => r.filter((f) => f.x >= firstX - 20).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      for (let i = headerIndex + 1; i < lines.length; i++) {
        const row = lines[i]!; const label = row.find((f) => key(f.text) === 'codigoturno');
        const names = row.filter((f) => f.x < firstX - (glosa ? 140 : 30) && !['nombre', 'firma', 'sumainiciotermino', 'codigoturno', 'horainicio', 'horatermino', 'horas', 'permanencia', 'feriado'].includes(key(f.text)) && !/^semana\s*\d/i.test(f.text));
        if (names.length) { const raw = names.map((f) => f.text.trim()).filter(Boolean).join(' '); if (glosa) name = row.some((f) => key(f.text) === 'sumainiciotermino') || !name ? raw : `${name} ${raw}`; else { identity = scheduleCsvText(raw); name = identity; } }
        if (glosa && !label) continue;
        if (!name) { if (label) result.issues.push(`Página ${page}: hay códigos sin nombre reconocible.`); continue; }
        for (const col of dateColumns) {
          const f = nearest(row, col.x); const maxDistance = Math.min(35, Math.abs((dateColumns[1]?.x ?? col.x + 70) - dateColumns[0]!.x) / 2);
          let code = f && Math.abs(f.x - col.x) < maxDistance ? codeOf(f.text) : '';
          const following = lines.slice(i + 1); const nextPerson = following.findIndex((r) => r.some((f) => key(f.text) === 'sumainiciotermino')); const block = nextPerson >= 0 ? following.slice(0, nextPerson) : following;
          const startRow = block.find((r) => r.some((f) => key(f.text) === 'horainicio')) ?? []; const endRow = block.find((r) => r.some((f) => key(f.text) === 'horatermino')) ?? [];
          const startCell = nearest(startRow, col.x); const endCell = nearest(endRow, col.x);
          if (glosa && !code && startCell && Math.abs(startCell.x - col.x) < maxDistance && key(startCell.text) === 'libre') code = 'LIBRE';
          if (!code) { result.issues.push(`${name} · ${col.date}: casilla sin programación; no se interpreta como Libre.`); continue; }
          const startTime = glosa && startCell && Math.abs(startCell.x - col.x) < maxDistance ? timeOf(startCell.text) : null; const endTime = glosa && endCell && Math.abs(endCell.x - col.x) < maxDistance ? timeOf(endCell.text) : null;
          if (glosa && !['LIBRE', 'VACACIONES', 'AUSENCIA'].includes(code) && (!startTime || !endTime)) result.issues.push(`${name} · ${col.date}: falta una hora válida en la glosa.`);
          result.rows.push({ employeeCode: !glosa && identity && /^(?:@[A-Za-z0-9_.-]{1,100}|[A-Za-z0-9_-]{1,32})$/.test(identity) ? identity : null, name, date: col.date, code, startTime, endTime });
        }
      }
    } else {
      const column = (names: string[]) => header.find((f) => names.includes(key(f.text)))?.x;
      const codeX = column(['codigo', 'codigoturno', 'turno']); const dateX = column(['fecha', 'date']);
      const employeeX = column(['idcolaborador', 'codigocolaborador', 'colaborador', 'empleado']); const nameX = column(['nombre', 'nombres']);
      const startX = column(['inicio', 'horainicio']); const endX = column(['termino', 'horatermino', 'fin']);
      if (codeX === undefined || dateX === undefined || (employeeX === undefined && nameX === undefined)) { result.issues.push(`Página/hoja ${page}: faltan ID_COLABORADOR o NOMBRE, FECHA y CODIGO.`); continue; }
      const cell = (row: TextFragment[], x: number | undefined) => x === undefined ? null : row.find((f) => Math.abs(f.x - x) < 10)?.text.trim() ?? null;
      for (const row of lines.slice(headerIndex + 1)) {
        const date = dateOf(cell(row, dateX) ?? '', start, end); const code = cell(row, codeX);
        if (!date || !code) { if (row.some((f) => f.text.trim())) result.issues.push(`Página/hoja ${page}: fila con fecha o código inválido.`); continue; }
        const startRaw = cell(row, startX); const endRaw = cell(row, endX); const startTime = timeOf(startRaw ?? undefined); const endTime = timeOf(endRaw ?? undefined);
        if ((startRaw && !startTime) || (endRaw && !endTime)) result.issues.push(`Página/hoja ${page}: hora inválida en ${date}.`);
        result.rows.push({ employeeCode: cell(row, employeeX) ? scheduleCsvText(cell(row, employeeX)!) : null, name: cell(row, nameX) ? scheduleCsvText(cell(row, nameX)!) : null, date, code: codeOf(code), startTime, endTime });
      }
    }
  }
  if (!result.rows.length) result.issues.push('No se reconocieron asignaciones.');
  if (result.rows.length > 2000) return { rows: [], issues: ['La carga admite como máximo 2.000 asignaciones.'] };
  return result;
}
