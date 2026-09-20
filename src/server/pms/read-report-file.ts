import 'server-only';

import { extname } from 'node:path';
import type { TextFragment } from '@/domain/pms/layout';
import { RuleError } from '@/server/errors';
import { readPdfFragments } from './read-pdf';

export type ExtractedReport = {
  name: string;
  fragments: TextFragment[];
};

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 100;
const MAX_CELLS = 200_000;

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(data).replace(/^\uFEFF/, '');
  }
}

function delimiterOf(text: string): ',' | ';' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 12).join('\n');
  const counts = ([',', ';', '\t'] as const).map((delimiter) => ({
    delimiter,
    count: [...sample].filter((character) => character === delimiter).length,
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

/** Lector pequeño de CSV/TSV: admite comillas, separadores dentro de celdas y saltos de línea. */
export function parseDelimited(text: string, delimiter = delimiterOf(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += character;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function dateText(value: Date): string {
  return [
    String(value.getUTCDate()).padStart(2, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    value.getUTCFullYear(),
  ].join('/');
}

function rowsToFragments(rows: Array<Array<string | number | boolean | Date | null>>): TextFragment[] {
  const widest = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const cells = rows.reduce((total, row) => total + row.length, 0);
  if (rows.length > MAX_ROWS || widest > MAX_COLUMNS || cells > MAX_CELLS) {
    throw new RuleError(
      `El archivo excede el límite de ${MAX_ROWS} filas, ${MAX_COLUMNS} columnas o ${MAX_CELLS} celdas.`,
    );
  }
  const fragments: TextFragment[] = [];
  const height = Math.max(rows.length, 1);
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === null || value === '') return;
      const text = value instanceof Date ? dateText(value) : String(value).trim();
      if (!text) return;
      fragments.push({
        page: 1,
        x: 40 + columnIndex * 120,
        y: 800 + (height - rowIndex) * 20,
        text,
      });
    });
  });
  return fragments;
}

async function readWorkbook(name: string, data: Uint8Array): Promise<ExtractedReport[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const bytes = Uint8Array.from(data);
  await workbook.xlsx.load(bytes.buffer);

  const reports: ExtractedReport[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: Array<Array<string | number | boolean | Date | null>> = [];
    worksheet.eachRow({ includeEmpty: false }, (excelRow) => {
      const row: Array<string | number | boolean | Date | null> = [];
      excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const raw = cell.value;
        let value: string | number | boolean | Date | null = null;
        if (raw instanceof Date) value = raw;
        else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') value = raw;
        else if (raw !== null && raw !== undefined) value = cell.text;
        row[columnNumber - 1] = value;
      });
      if (row.some((value) => value !== null && value !== '')) rows.push(row);
    });
    if (rows.length) {
      reports.push({
        name: workbook.worksheets.length > 1 ? `${name} · ${worksheet.name}` : name,
        fragments: rowsToFragments(rows),
      });
    }
  });
  if (!reports.length) throw new RuleError(`El libro ${name} no contiene hojas con datos.`);
  return reports;
}

/**
 * Convierte PDF, Excel moderno o texto delimitado al mismo lenguaje de
 * fragmentos. Desde aquí, todos pasan por el mismo reconocimiento semántico.
 */
export async function readReportFile(name: string, data: Uint8Array): Promise<ExtractedReport[]> {
  const extension = extname(name).toLowerCase();
  const signature = new TextDecoder('latin1').decode(data.slice(0, 5));

  if (extension === '.pdf' || signature.startsWith('%PDF')) {
    return [{ name, fragments: await readPdfFragments(data) }];
  }
  if (extension === '.xlsx' || extension === '.xlsm' || signature.startsWith('PK')) {
    return readWorkbook(name, data);
  }
  if (['.csv', '.tsv', '.txt'].includes(extension)) {
    const rows = parseDelimited(decodeText(data), extension === '.tsv' ? '\t' : undefined);
    if (!rows.length) throw new RuleError(`El archivo ${name} no contiene filas con datos.`);
    return [{ name, fragments: rowsToFragments(rows) }];
  }

  throw new RuleError(
    `El formato de ${name} no es compatible. Usa PDF, Excel .xlsx, CSV o TSV.`,
  );
}
