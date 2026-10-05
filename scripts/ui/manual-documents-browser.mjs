/** Run after the existing CI fixture and compiled Next server are ready.
 * No new bundler/server/database process, no real sessions, no external traffic.
 * Uses the same loopback/CI guard, synthetic session fixture and browser adapter
 * as the existing authenticated UI journeys. Never point this at production.
 */
import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const origin = 'http://localhost:3000';
const target = `${origin}/supervision/documentos`;
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
assert.ok(fixture.users.admin?.token && fixture.users.admin?.id && fixture.users.worker?.token && fixture.users.maid?.token, 'The existing synthetic fixture is required.');
assert.ok(process.env.PLAYWRIGHT_MODULE, 'The existing approved browser adapter is required.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ headless: true });
const outbound = [];
const writes = [];
const errors = [];
const phases = [];
let phase = 'startup';
let failed = true;
const mark = (name) => { phase = name; phases.push(name); console.log(JSON.stringify({ suite: 'manual-documents-browser', phase: name })); };
async function actor(name, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  if (name) await context.addCookies([{ name: 'lor_session', value: fixture.users[name].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin) { outbound.push(url.origin); return route.abort(); }
    // Known shell keep-alive is blocked separately; any feature POST still fails.
    if (!['GET', 'HEAD'].includes(request.method()) && url.pathname !== '/api/auth/pulse') writes.push({ method: request.method(), path: url.pathname });
    const backgroundApi = url.pathname.startsWith('/api/') && url.pathname !== '/api/maintenance';
    const prefetch = request.headers()['next-router-prefetch'] === '1' || request.headers().purpose === 'prefetch';
    if (backgroundApi || prefetch || !['GET', 'HEAD'].includes(request.method())) return route.abort();
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  return { context, page };
}
function pdf(pages) {
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text, index) => {
    const content = text ? `BT /F1 18 Tf 40 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : '';
    objects[4 + index * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`;
    objects[5 + index * 2] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  });
  let bytes = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(bytes)); bytes += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(bytes);
  bytes += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(bytes);
}
async function downloadBytes(download) { const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); }
try {
  const { context, page } = await actor('admin');
  mark('authenticated-page');
  await page.goto(target);
  assert.equal(new URL(page.url()).pathname, '/supervision/documentos', 'Synthetic supervisor permissions must pass the real route guard.');
  await page.getByLabel('Abrir documento en este navegador').waitFor();
  const fileInput = page.getByLabel('Abrir documento en este navegador');
  const csv = Buffer.from('Concepto;Importe\nAjuste;-1.234\nFecha;05/10/2026\n');
  const load = async (name, mimeType, buffer) => { await fileInput.setInputFiles({ name, mimeType, buffer }); await page.getByText('Leyendo el original local…', { exact: true }).waitFor({ state: 'hidden' }); };
  mark('csv-worker'); await load('synthetic.csv', 'text/csv', csv);
  const amountEvidence = page.locator('li').filter({ has: page.getByText('-1.234', { exact: true }) });
  await amountEvidence.getByRole('button', { name: 'Revisar dato', exact: true }).click();
  await page.getByLabel('Nombre del dato').fill('Ajuste');
  await page.getByLabel('Tipo', { exact: true }).selectOption('money');
  await page.getByLabel('Moneda', { exact: true }).selectOption('CLP');
  await page.getByLabel('Notación', { exact: true }).selectOption('es-CL');
  await page.getByRole('button', { name: 'Preparar aprobación local', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Compara el original' }).waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Preparar aprobación local', exact: true }).dblclick();
  await page.getByRole('heading', { name: 'Historial de esta sesión (1)', exact: true }).waitFor();
  mark('correction-and-return');
  await page.getByLabel('Valor a revisar').fill('1.234');
  assert.equal(await page.getByRole('checkbox').isChecked(), false);
  await page.getByLabel('Motivo de corrección o selección parcial').fill('Signo corregido tras cotejar.');
  await page.getByLabel('Interpretación del revisor', { exact: false }).fill('Podría ser anticipo; es sólo una interpretación.');
  await page.getByRole('button', { name: 'Preparar devolución local', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'motivo' }).waitFor();
  await page.getByLabel('Nota o motivo de devolución').fill('Pedir confirmación del signo.');
  await page.getByRole('button', { name: 'Preparar devolución local', exact: true }).click();
  await page.getByRole('heading', { name: 'Historial de esta sesión (2)', exact: true }).waitFor();
  mark('dedup-and-invalid-original');
  await load('renamed.csv', 'text/csv', csv);
  await page.getByRole('status').filter({ hasText: 'ya está abierto' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Documentos locales abiertos' }).getByRole('button').count(), 1);
  await load('bad.pdf', 'application/pdf', Buffer.from('not a PDF'));
  await page.getByRole('alert').filter({ hasText: 'no corresponde a un PDF' }).waitFor();
  await page.getByRole('heading', { name: 'Historial de esta sesión (2)', exact: true }).waitFor();
  mark('export-original-and-history');
  const reviewDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar revisión JSON', exact: true }).click();
  const exported = JSON.parse((await downloadBytes(await reviewDownload)).toString());
  assert.equal(exported.operationalApproval, false); assert.equal(exported.originalPersisted, false); assert.equal(exported.history.length, 2); assert.equal(exported.history[0].claims[0].value, '-1.234'); assert.equal(exported.history[1].claims[0].value, '1.234');
  const originalDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar original local', exact: true }).click();
  assert.equal(createHash('sha256').update(await downloadBytes(await originalDownload)).digest('hex'), exported.sha256);
  mark('xlsx-worker');
  const ExcelJS = require('exceljs'); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Control'); sheet.getCell('B3').value = -1234.5; sheet.getCell('D5').value = { formula: 'SUM(B3)', result: -1234.5 };
  await load('synthetic.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await workbook.xlsx.writeBuffer()));
  await page.getByText('=SUM(B3)', { exact: true }).waitFor();
  await page.getByText('Fórmula no ejecutada.', { exact: false }).waitFor();
  mark('pdf-worker-and-canvas');
  await load('synthetic.pdf', 'application/pdf', pdf(['Original first page 1234', 'Original second page 5678']));
  await page.getByText('Original first page 1234', { exact: true }).waitFor();
  await page.getByLabel('Página 1 del PDF original', { exact: true }).waitFor({ state: 'visible' });
  assert.ok(await page.locator('canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
  await page.getByLabel('Página del original', { exact: true }).selectOption('2');
  await page.getByText('Original second page 5678', { exact: true }).waitFor();
  await page.getByLabel('Página 2 del PDF original', { exact: true }).waitFor({ state: 'visible' });
  // The visible canvas is checked above; no file or screenshot is uploaded.
  mark('scanned-manual-transcription');
  await load('scan-synthetic.pdf', 'application/pdf', pdf(['']));
  await page.getByText('No se encontró texto seleccionable.', { exact: false }).waitFor();
  await page.getByText('Transcribir un dato visible de la página 1', { exact: true }).click();
  await page.getByLabel('Transcripción manual del original').fill('100');
  await page.getByRole('button', { name: 'Añadir transcripción con página', exact: true }).click();
  await page.getByText('100', { exact: true }).waitFor();
  await page.getByText('Transcripción manual del revisor;', { exact: false }).waitFor();
  mark('page-limit-preserves-session');
  await load('too-many-pages.pdf', 'application/pdf', pdf(Array.from({ length: 41 }, () => '')));
  await page.getByRole('alert').filter({ hasText: '40 páginas' }).waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Documentos locales abiertos' }).getByRole('button').count(), 4);
  mark('mobile-and-clear-cancel');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Documentos locales abiertos' }).getByRole('button', { name: 'synthetic.csv', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal overflow at 390px');
  // Synthetic viewport only; no production browser or data is used.
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Cerrar borradores locales', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'Documentos locales abiertos' }).getByRole('button').count(), 4);
  mark('other-user-and-route-permissions');
  const other = await actor('worker', 390);
  await other.page.goto(target);
  assert.equal(new URL(other.page.url()).pathname, '/supervision/documentos');
  assert.equal(await other.page.getByRole('navigation', { name: 'Documentos locales abiertos' }).count(), 0, 'Another user/session does not inherit originals or local reviews');
  await other.context.close();
  const forbidden = await actor('maid');
  await forbidden.page.goto(target);
  assert.equal(new URL(forbidden.page.url()).pathname, '/sin-permisos', 'A role without Supervisión access is denied');
  await forbidden.context.close();
  const anonymous = await actor(null);
  await anonymous.page.goto(target);
  assert.equal(new URL(anonymous.page.url()).pathname, '/login');
  await anonymous.context.close();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Cerrar borradores locales', exact: true }).click();
  assert.equal(await page.getByRole('navigation', { name: 'Documentos locales abiertos' }).count(), 0);
  await context.close();
  assert.deepEqual(outbound, [], 'No external request attempts'); assert.deepEqual(writes, [], 'No server mutations/uploads'); assert.deepEqual(errors, [], 'No browser runtime errors');
  failed = false;
  console.log(JSON.stringify({ suite: 'manual-documents-browser', result: 'passed', phases, outboundRequests: outbound.length, writes: writes.length, runtimeErrors: errors.length }));
} catch (error) {
  // Failure text contains only synthetic assertion names, never sessions/headers.
  console.error(JSON.stringify({ suite: 'manual-documents-browser', result: 'failed', phase, error: error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : 'Unknown error', runtimeErrors: errors }));
  throw error;
} finally {
  writeFileSync('/tmp/manual-documents-browser-results.json', JSON.stringify({ result: failed ? 'failed' : 'passed', phase, phases, outboundRequests: outbound.length, writes, runtimeErrors: errors }, null, 2));
  await browser.close();
}
