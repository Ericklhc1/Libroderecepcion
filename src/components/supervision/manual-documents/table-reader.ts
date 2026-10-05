import { parseDelimited } from '@/domain/delimited-report';
import { boundEvidence, cellAddress, inspectXlsxArchive, textRowsEvidence } from '@/domain/manual-documents/formats';
import { MANUAL_DOCUMENT_LIMITS as LIMITS } from '@/domain/manual-documents/types';
import type { DocumentEvidence, DocumentExtraction } from '@/domain/manual-documents/types';

function csvDelimiter(text: string): ',' | ';' {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (ch === ',') commas += 1;
      if (ch === ';') semicolons += 1;
      if (ch === '\n' || ch === '\r') break;
    }
  }
  return semicolons > commas ? ';' : ',';
}

export function readLocalDelimited(bytes: Uint8Array, format: 'csv' | 'tsv'): DocumentExtraction {
  let text: string;
  const warnings: string[] = [];
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    text = new TextDecoder('windows-1252').decode(bytes);
    warnings.push('Se utilizó Windows-1252; comprueba tildes y símbolos contra el original.');
  }
  text = text.replace(/^\uFEFF/, '');
  if (text.length > LIMITS.textCharacters) throw new Error('El archivo supera 400.000 caracteres.');
  const delimiter = format === 'tsv' ? '\t' : csvDelimiter(text);
  const rows = parseDelimited(text, delimiter, { strict: true, preserveEmptyRows: true, preserveWhitespace: true, maxRows: LIMITS.rows, maxColumns: LIMITS.columns, maxCellCharacters: 10_000 });
  if (!rows.some((row) => row.some(Boolean))) throw new Error('El archivo no contiene datos.');
  warnings.push(`Separador leído: ${delimiter === '\t' ? 'tabulación' : delimiter === ';' ? 'punto y coma' : 'coma'}. Comprueba las columnas; los valores se conservan como texto.`);
  return { evidence: textRowsEvidence(rows, 'Datos'), warnings, sheets: ['Datos'], pageCount: null };
}

/** Bounded inflate is mandatory. A browser without raw-deflate streaming rejects XLSX. */
export async function verifyExpandedXlsx(bytes: Uint8Array): Promise<void> {
  const entries = inspectXlsxArchive(bytes);
  let total = 0;
  for (const entry of entries) {
    const compressed = Uint8Array.from(bytes.subarray(entry.start, entry.start + entry.compressedSize));
    let stream = new Blob([compressed]).stream();
    if (entry.method === 8) {
      try { stream = stream.pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { throw new Error('Este navegador no permite validar XLSX con límites seguros. Usa CSV/TSV o un navegador actualizado.'); }
    }
    const reader = stream.getReader();
    let expanded = 0;
    const decoder = new TextDecoder();
    let tail = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        expanded += value.byteLength;
        total += value.byteLength;
        if (expanded > entry.expandedSize || total > LIMITS.expandedBytes) throw new Error('El XLSX descomprimido supera los límites declarados.');
        if (/\.xml$|\.rels$/i.test(entry.name)) {
          const chunk = tail + decoder.decode(value, { stream: true });
          if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|activeX/i.test(chunk)) throw new Error('El XLSX contiene declaraciones XML o contenido activo no admitidos.');
          tail = chunk.slice(-100);
        }
      }
      if (expanded !== entry.expandedSize) throw new Error('El XLSX tiene tamaños descomprimidos incoherentes.');
    } finally { await reader.cancel().catch(() => undefined); }
  }
}

export async function readLocalWorkbook(bytes: Uint8Array): Promise<DocumentExtraction> {
  await verifyExpandedXlsx(bytes);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  const evidence: DocumentEvidence[] = [];
  const sheets: string[] = [];
  let totalCells = 0;
  let characters = 0;
  workbook.eachSheet((sheet) => {
    if (sheet.rowCount > LIMITS.rows || sheet.columnCount > LIMITS.columns) throw new Error('Una hoja supera 2.000 filas o 100 columnas.');
    if (sheets.length >= 20) throw new Error('El libro supera 20 hojas.');
    sheets.push(sheet.name);
    sheet.eachRow((row, rowNumber) => row.eachCell((cell, columnNumber) => {
      totalCells += 1;
      if (totalCells > LIMITS.cells) throw new Error('El libro supera 40.000 celdas con datos.');
      const raw = cell.value;
      let text = '';
      let warning: string | undefined;
      if (raw === null) return;
      if (raw instanceof Date) {
        text = raw.toISOString().slice(0, 10);
        warning = `Fecha Excel leída como ${text}; formato de origen: ${cell.numFmt || 'general'}. Verifica la fecha en el original.`;
      } else if (typeof raw === 'object') {
        if ('formula' in raw || 'sharedFormula' in raw) {
          text = `=${'formula' in raw ? raw.formula : `[fórmula compartida ${raw.sharedFormula}]`}`;
          warning = 'Fórmula no ejecutada. El resultado guardado en Excel no se acredita como dato.';
        } else if ('hyperlink' in raw) {
          text = String(raw.text);
          warning = 'Enlace no abierto; sólo se muestra el texto de la celda.';
        } else if ('richText' in raw) text = raw.richText.map((part) => part.text).join('');
        else if ('error' in raw) { text = String(raw.error); warning = 'La celda contiene un error de Excel.'; }
      } else text = String(raw);
      if (!text) return;
      characters += text.length;
      if (characters > LIMITS.textCharacters) throw new Error('El libro supera 400.000 caracteres.');
      evidence.push({ id: `${sheet.id}:${cellAddress(rowNumber, columnNumber)}`, sheet: sheet.name, cell: cellAddress(rowNumber, columnNumber), row: rowNumber, column: columnNumber, text, warning });
    }));
  });
  if (!evidence.length) throw new Error('El libro no contiene celdas con datos.');
  boundEvidence(evidence);
  return { evidence, sheets, pageCount: null, warnings: ['Vista de valores de celdas; no reproduce diseño, celdas combinadas ni gráficos. El archivo original permanece disponible para descargar.', 'Las fórmulas, macros y enlaces no se ejecutan. Las filas y hojas ocultas también requieren revisión.'] };
}
