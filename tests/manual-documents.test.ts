import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseDelimited } from '@/domain/delimited-report';
import { appendLocalReview, buildFrontiDocumentText, documentDedupKey, evidenceLocation, localReviewExport, moneyTotals, parseDocumentDate, parseDocumentMoney, validateClaim } from '@/domain/manual-documents/review';
import { boundEvidence, cellAddress, inspectXlsxArchive, textRowsEvidence, validateDocumentFile } from '@/domain/manual-documents/formats';
import { MANUAL_DOCUMENT_CAPABILITIES, MANUAL_DOCUMENT_LIMITS, MANUAL_DOCUMENT_VERSION } from '@/domain/manual-documents/types';
import type { LocalReviewRevision, ManualDocumentDraft, ReviewClaim } from '@/domain/manual-documents/types';
import { readLocalDelimited, readLocalWorkbook, verifyExpandedXlsx } from '@/components/supervision/manual-documents/table-reader';

const sha = 'a'.repeat(64);
const scope = { userId: 'synthetic-reviewer', departmentId: 'synthetic-area' };
const claim = (overrides: Partial<ReviewClaim> = {}): ReviewClaim => ({ id: 'claim-1', evidenceId: 'Datos:A1', label: 'Importe fuente', kind: 'money', value: '-1.234', currency: 'CLP', numberFormat: 'es-CL', dateFormat: '', interpretation: '', correctionReason: '', ...overrides });
const draft = (): ManualDocumentDraft => ({ key: documentDedupKey(scope, sha), sha256: sha, name: 'synthetic.csv', size: 8, format: 'csv', parserVersion: MANUAL_DOCUMENT_VERSION, scope, history: [], sheets: ['Datos'], pageCount: null, warnings: [], evidence: [{ id: 'Datos:A1', sheet: 'Datos', cell: 'A1', row: 1, column: 1, text: '-1.234' }] });
const revision = (overrides: Partial<Omit<LocalReviewRevision, 'at' | 'revision'>> = {}): Omit<LocalReviewRevision, 'at' | 'revision'> => ({ actor: { id: scope.userId, name: 'Synthetic Reviewer' }, decision: 'PROPOSE_APPROVAL', claims: [claim()], note: '', originalCompared: true, unresolvedQuestions: '', ...overrides });

function zip(entries: Array<{ name: string; text: string; declaredSize?: number; method?: number }>): Uint8Array {
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const raw = Buffer.from(entry.text); const method = entry.method ?? 8;
    const bytes = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(entry.declaredSize ?? raw.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(method, 10); header.writeUInt32LE(bytes.length, 20); header.writeUInt32LE(entry.declaredSize ?? raw.length, 24); header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
    central.push(header, name); locals.push(local, name, bytes); offset += local.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const minimumEntries = [{ name: '[Content_Types].xml', text: '<Types />' }, { name: 'xl/workbook.xml', text: '<workbook />' }];

describe('documentos manuales: identidad, límites y lectura literal', () => {
  it('conserva el parser canónico por defecto y permite preservar filas vacías para evidencia', () => {
    expect(parseDelimited('a,b\n\n"c,d",e')).toEqual([['a', 'b'], ['c,d', 'e']]);
    expect(parseDelimited(',')).toEqual([]);
    expect(parseDelimited('a,b\n\nc,d', ',', { preserveEmptyRows: true })).toEqual([['a', 'b'], [''], ['c', 'd']]);
    const read = readLocalDelimited(new TextEncoder().encode('Concepto;Importe\r\n\r\n"Texto, con coma";"-1.234,50"'), 'csv');
    expect(read.evidence.find((item) => item.text === '-1.234,50')?.cell).toBe('B3');
  });
  it('admite comillas escapadas y multilínea sin ejecutar fórmulas ni enlazar URLs', () => {
    const read = readLocalDelimited(new TextEncoder().encode('a\tb\n"uno\n""dos"""\t"=HYPERLINK(""https://example.invalid"")"'), 'tsv');
    expect(read.evidence[2]?.text).toBe('uno\n"dos"');
    expect(read.evidence[3]?.warning).toContain('no se ejecuta');
  });
  it('rechaza delimitados truncados, binarios y archivos vacíos o sobredimensionados', () => {
    expect(() => readLocalDelimited(new TextEncoder().encode('a,"sin cierre'), 'csv')).toThrow(/comillas/);
    expect(() => parseDelimited('"a"otra,b', ',', { strict: true })).toThrow(/comillas/);
    expect(() => validateDocumentFile('fake.csv', new Uint8Array([0, 1]))).toThrow(/texto/);
    expect(() => validateDocumentFile('fake.pdf', new TextEncoder().encode('not pdf'))).toThrow(/PDF/);
    expect(() => validateDocumentFile('empty.tsv', new Uint8Array())).toThrow(/contenido/);
    expect(() => validateDocumentFile('large.csv', new Uint8Array(MANUAL_DOCUMENT_LIMITS.fileBytes + 1))).toThrow(/4 MB/);
    expect(() => validateDocumentFile('macro.xlsm', new TextEncoder().encode('PKxx'))).toThrow(/sin macros/);
  });
  it('aplica límites de filas, columnas, fragmentos, caracteres y celdas antes de revisión', () => {
    expect(() => parseDelimited('1\n2', ',', { maxRows: 1 })).toThrow(/filas/);
    expect(() => parseDelimited('1,2', ',', { maxColumns: 1 })).toThrow(/columnas/);
    expect(() => parseDelimited('""""""""', ',', { maxCellCharacters: 1, strict: true })).toThrow(/texto/);
    expect(() => textRowsEvidence([new Array(101).fill('x')], 'Sheet')).toThrow(/columnas/);
    expect(() => boundEvidence([{ id: '1', text: 'x'.repeat(400_001) }])).toThrow(/caracteres/);
    expect(cellAddress(23, 27)).toBe('AA23');
  });
  it('deduplica por bytes/versión/usuario/área, nunca por nombre', () => {
    expect(documentDedupKey(scope, sha)).toBe(draft().key);
    expect(documentDedupKey({ ...scope, userId: 'other' }, sha)).not.toBe(draft().key);
    expect(documentDedupKey({ ...scope, departmentId: null }, sha)).not.toBe(draft().key);
    expect(documentDedupKey(scope, sha, 'v2')).not.toBe(draft().key);
    expect(() => documentDedupKey(scope, 'invalid')).toThrow(/huella/);
    expect(evidenceLocation({ id: 'scan', page: 2, text: 'transcripción', origin: 'manual-transcription' })).toBe('Página 2 · transcripción manual');
  });
});

describe('XLSX local: descompresión y contenido no confiable', () => {
  it('acepta estructura acotada y comprueba expansión real, no sólo los metadatos ZIP', async () => {
    const bytes = zip(minimumEntries);
    expect(inspectXlsxArchive(bytes)).toHaveLength(2);
    await expect(verifyExpandedXlsx(bytes)).resolves.toBeUndefined();
    await expect(verifyExpandedXlsx(zip([...minimumEntries, { name: 'xl/worksheets/sheet1.xml', text: '<row>actually longer</row>', declaredSize: 1 }]))).rejects.toThrow(/límites declarados/);
  });
  it.each(['xl/vbaProject.bin', 'xl/externalLinks/externalLink1.xml', '../outside.xml', '/absolute.xml', 'xl/activeX/activeX1.xml'])('rechaza contenido/ruta activa %s', (name) => {
    expect(() => inspectXlsxArchive(zip([...minimumEntries, { name, text: 'x' }]))).toThrow(/seguridad/);
  });
  it('rechaza duplicados, expansión excesiva, ZIP truncado y XML con entidades', async () => {
    expect(() => inspectXlsxArchive(zip([...minimumEntries, minimumEntries[0]!]))).toThrow();
    expect(() => inspectXlsxArchive(zip([...minimumEntries, { name: 'large.xml', text: 'a'.repeat(100_000) }]))).toThrow();
    expect(() => inspectXlsxArchive(zip(minimumEntries).subarray(0, 30))).toThrow();
    await expect(verifyExpandedXlsx(zip([...minimumEntries, { name: 'evil.xml', text: '<!DOCTYPE foo [<!ENTITY x "y">]><foo />' }]))).rejects.toThrow(/XML/);
  });
  it('lee un Excel sintético real con filas/celdas exactas y no usa resultados de fórmulas', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Control');
    sheet.getCell('B3').value = -1234.5;
    sheet.getCell('D5').value = { formula: 'SUM(B3)', result: -1234.5 };
    sheet.getCell('F7').value = { text: 'Sitio', hyperlink: 'https://example.invalid/never-open' };
    const read = await readLocalWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(read.evidence.find((item) => item.cell === 'B3')?.text).toBe('-1234.5');
    expect(read.evidence.find((item) => item.cell === 'D5')).toMatchObject({ text: '=SUM(B3)', warning: expect.stringContaining('no ejecutada') });
    expect(read.evidence.find((item) => item.cell === 'F7')?.text).toBe('Sitio');
    expect(read.evidence.find((item) => item.cell === 'F7')?.warning).toContain('Enlace no abierto');
  });
});

describe('importes y fechas: notación explícita y aritmética exacta', () => {
  it.each([
    ['-1.234', 'CLP', 'es-CL', '-1234'], ['(USD 1,234.50)', 'USD', 'en-US', '-123450'],
    ['€ 0,10', 'EUR', 'es-CL', '10'], ['+1000', 'CLP', 'es-CL', '1000'], ['-0.00', 'USD', 'en-US', '0'],
  ] as const)('normaliza %s a unidades menores sin float', (raw, currency, format, expected) => {
    expect(parseDocumentMoney(raw, currency, format).minorUnits).toBe(expected);
  });
  it.each([
    ['1.234', '', 'es-CL'], ['1.234', 'CLP', ''], ['USD 12', 'CLP', 'en-US'], ['€ 12', 'USD', 'en-US'],
    ['1,50', 'CLP', 'es-CL'], ['1,234.56', 'USD', 'es-CL'], ['(-12)', 'USD', 'en-US'], ['$$12', 'USD', 'en-US'],
    ['1e5', 'CLP', 'es-CL'], ['1,2,3', 'USD', 'en-US'],
  ] as const)('rechaza ambigüedad o incoherencia: %s / %s / %s', (raw, currency, format) => {
    expect(() => parseDocumentMoney(raw, currency, format)).toThrow();
  });
  it('suma exactamente sin mezclar monedas ni perder signos', () => {
    expect(moneyTotals([claim({ value: '0.10', currency: 'USD', numberFormat: 'en-US' }), claim({ value: '0.20', currency: 'USD', numberFormat: 'en-US' }), claim(), claim({ value: 'bad' })])).toEqual([{ currency: 'USD', value: '0.30' }, { currency: 'CLP', value: '-1234' }]);
  });
  it('distingue fechas calendario reales de fechas ambiguas/rollover', () => {
    expect(parseDocumentDate('29/02/2024', 'dd/mm/yyyy')).toBe('2024-02-29');
    expect(parseDocumentDate('2026-10-05', 'yyyy-mm-dd')).toBe('2026-10-05');
    expect(() => parseDocumentDate('29/02/2026', 'dd/mm/yyyy')).toThrow(/no existe/);
    expect(() => parseDocumentDate('2026-02-31', 'yyyy-mm-dd')).toThrow();
    expect(() => parseDocumentDate('05/10/2026', '')).toThrow(/Elige/);
  });
});

describe('revisión humana local: historial y límites de autoridad', () => {
  it('conserva revisiones anteriores ante corrección/devolución y elimina doble clic idéntico', () => {
    const first = appendLocalReview(draft(), revision(), new Date('2026-10-05T10:00:00Z'));
    expect(first.history[0]?.revision).toBe(1);
    expect(appendLocalReview(first, revision()).history).toHaveLength(1);
    const input = revision({ decision: 'PROPOSE_RETURN', note: 'Falta cotejo', claims: [claim({ value: '1.234', correctionReason: 'El signo debe verificarse.' })] });
    const second = appendLocalReview(first, input);
    input.claims[0]!.value = '999';
    expect(second.history[0]?.claims[0]?.value).toBe('-1.234');
    expect(second.history[1]?.claims[0]?.value).toBe('1.234');
    expect(first.history).toHaveLength(1);
    expect(draft().history).toHaveLength(0);
  });
  it.each([
    { originalCompared: false }, { claims: [] }, { unresolvedQuestions: 'Moneda sin verificar' }, { claims: [claim({ label: '' })] },
  ])('bloquea propuesta de aprobación con faltantes %j', (change) => {
    expect(() => appendLocalReview(draft(), revision(change))).toThrow();
  });
  it('rechaza identidad distinta, evidencia duplicada, devolución sin motivo y corrección sin explicación', () => {
    expect(() => appendLocalReview(draft(), revision({ actor: { id: 'other', name: 'Other' } }))).toThrow(/otra sesión/);
    expect(() => appendLocalReview(draft(), revision({ claims: [claim(), claim({ id: 'different' })] }))).toThrow(/misma evidencia/);
    expect(() => appendLocalReview(draft(), revision({ decision: 'PROPOSE_RETURN' }))).toThrow(/motivo/);
    expect(validateClaim(claim({ value: '1234' }), draft().evidence)).toContain('Explica el cambio o la selección parcial del texto original.');
    expect(validateClaim(claim({ evidenceId: 'absent' }), draft().evidence)).toContain('Falta la evidencia de origen.');
  });
  it('conserva borradores incompletos e interpretaciones sin convertirlas en hechos', () => {
    const saved = appendLocalReview(draft(), revision({ decision: 'DRAFT', claims: [claim({ value: '??', interpretation: 'Podría ser un anticipo, no confirmado.' })] }));
    expect(saved.history[0]?.claims[0]?.interpretation).toContain('no confirmado');
    expect(localReviewExport(saved)).toMatchObject({ operationalApproval: false, originalPersisted: false, originalIncluded: false, status: 'LOCAL_PREPARATION_NOT_REGISTERED' });
  });
  it('bloquea toda capacidad remota hasta acreditación, incluso con nuevas variables de entorno', () => {
    expect(Object.values(MANUAL_DOCUMENT_CAPABILITIES)).toEqual([false, false, false, false]);
    expect(Object.isFrozen(MANUAL_DOCUMENT_CAPABILITIES)).toBe(true);
    expect(() => buildFrontiDocumentText(draft())).toThrow(/capacidad y coste/);
  });
  it('mantiene permiso de Supervisión, separación del importador actual y mensajes honestos', () => {
    const page = readFileSync('src/app/(app)/supervision/documentos/page.tsx', 'utf8');
    const ui = readFileSync('src/components/supervision/manual-documents/review-workspace.tsx', 'utf8');
    expect(page).toContain("requirePagePermission('supervision.center.view')");
    expect(page).toContain("hasPermission(user, 'supervision.audit.create')");
    expect(ui).toContain('Borrador local: no compartido, no registrado en AROH');
    expect(ui).toContain('Preparar aprobación local');
    expect(ui).not.toMatch(/fetch\(|localStorage|sessionStorage|indexedDB/);
    expect(readFileSync('src/app/api/supervision/auditoria-diaria/route.ts', 'utf8')).toContain('mergeSupervisionAuditReport');
  });
});
