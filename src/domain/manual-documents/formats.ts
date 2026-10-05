import { MANUAL_DOCUMENT_LIMITS as LIMITS } from './types';
import type { DocumentEvidence, DocumentFormat } from './types';

export function validateDocumentFile(name: string, bytes: Uint8Array): DocumentFormat {
  if (!bytes.length || bytes.length > LIMITS.fileBytes) throw new Error('El archivo debe tener contenido y no superar 4 MB.');
  if (name.length > 200 || /[\x00-\x1f]/.test(name)) throw new Error('El nombre de archivo no es válido.');
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (!extension || !['pdf', 'xlsx', 'csv', 'tsv'].includes(extension)) throw new Error('Usa PDF, XLSX sin macros, CSV o TSV.');
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 8));
  if (extension === 'pdf' && !header.startsWith('%PDF-')) throw new Error('El contenido no corresponde a un PDF.');
  if (extension === 'xlsx' && !header.startsWith('PK\x03\x04')) throw new Error('El contenido no corresponde a un XLSX.');
  if (['csv', 'tsv'].includes(extension) && (bytes.includes(0) || header.startsWith('%PDF') || header.startsWith('PK'))) throw new Error('El contenido no corresponde a texto CSV/TSV.');
  return extension as DocumentFormat;
}

export function cellAddress(row: number, column: number): string {
  let label = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return `${label}${row}`;
}

export function boundEvidence(evidence: DocumentEvidence[]): void {
  if (evidence.length > LIMITS.cells) throw new Error('El documento supera el límite de 40.000 fragmentos/celdas.');
  if (evidence.reduce((sum, item) => sum + item.text.length, 0) > LIMITS.textCharacters) throw new Error('El documento supera el límite de 400.000 caracteres.');
}

export function textRowsEvidence(rows: string[][], sheet: string): DocumentEvidence[] {
  if (rows.length > LIMITS.rows || rows.some((row) => row.length > LIMITS.columns)) throw new Error('La hoja supera 2.000 filas o 100 columnas.');
  const evidence: DocumentEvidence[] = [];
  let cellCount = 0;
  rows.forEach((row, index) => row.forEach((text, column) => {
    cellCount += 1;
    if (cellCount > LIMITS.cells) throw new Error('La hoja supera 40.000 celdas.');
    if (text.length) evidence.push({ id: `${sheet}:${cellAddress(index + 1, column + 1)}`, sheet, cell: cellAddress(index + 1, column + 1), row: index + 1, column: column + 1, text,
      ...(/^[=+@]/.test(text) ? { warning: 'Posible fórmula: se conserva como texto y no se ejecuta.' } : {}),
    });
  }));
  boundEvidence(evidence);
  return evidence;
}

export type SafeZipEntry = { name: string; method: number; start: number; compressedSize: number; expandedSize: number };
/** Check the central AND local headers before passing an XLSX to the existing library.
 * Expanded sizes are also checked against the actual streaming inflate in the browser worker.
 */
export function inspectXlsxArchive(bytes: Uint8Array): SafeZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (): never => { throw new Error('XLSX inválido, cifrado, activo o fuera de los límites de seguridad.'); };
  if (bytes.length < 22) return fail();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) return fail();
  const count = view.getUint16(end + 10, true);
  const directoryBytes = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (!count || count > LIMITS.archiveEntries || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || count !== view.getUint16(end + 8, true) || directoryOffset + directoryBytes !== end) return fail();
  let cursor = directoryOffset;
  let totalExpanded = 0;
  const names = new Set<string>();
  const entries: SafeZipEntry[] = [];
  const ranges: Array<[number, number]> = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) return fail();
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const expandedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength + extraLength + commentLength > end || (flags & 1) || ![0, 8].includes(method) || view.getUint16(cursor + 34, true) !== 0 || compressedSize === 0xffffffff || expandedSize === 0xffffffff || local + 30 > directoryOffset) return fail();
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (!name || name.includes('..') || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || names.has(name.toLowerCase()) || /vba|macros?|activex|embeddings|externallinks|customui/i.test(name)) return fail();
    names.add(name.toLowerCase());
    totalExpanded += expandedSize;
    if (totalExpanded > LIMITS.expandedBytes || expandedSize > Math.max(compressedSize, 1) * LIMITS.compressionRatio) return fail();
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) return fail();
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > directoryOffset || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) return fail();
    if (!(flags & 8) && (view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== expandedSize)) return fail();
    ranges.push([local, start + compressedSize]);
    entries.push({ name, method, start, compressedSize, expandedSize });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end || !names.has('[content_types].xml') || !names.has('xl/workbook.xml')) return fail();
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, index) => index > 0 && range[0] < ranges[index - 1]![1])) return fail();
  return entries;
}
