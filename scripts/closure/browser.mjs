import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { assertClosureQaEnvironment } from './guard.mjs';
import { waitForNativeShiftReceipt } from '../ui/shift-action-observation.mjs';

assertClosureQaEnvironment();
const ORIGIN = 'http://localhost:3000';
const CONTROL = '/admin/mantenimiento';
const SETTING = 'system.maintenance';
const OUTPUT = '/tmp/aroh-closure-qa';
const fixture = JSON.parse(readFileSync('/tmp/aroh-closure-fixture.json', 'utf8'));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const db = new PrismaClient();
const contexts = [];
const results = [];
let browser;
let admin;
let activePage;
let phase = 'startup';
let failure;
mkdirSync(OUTPUT, { recursive: true });

function evidence(data) { console.log(JSON.stringify({ suite: 'ordered-closure', ...data })); }
function mark(value) { phase = value; evidence({ phase }); }
async function state() { return (await db.systemSetting.findUnique({ where: { key: SETTING }, select: { value: true } }))?.value; }
async function accountSnapshot() {
  return {
    users: await db.user.findMany({ select: { id: true, roleId: true, active: true, deletedAt: true }, orderBy: { id: 'asc' } }),
    roles: await db.role.findMany({ select: { id: true, key: true, operational: true, permissions: { select: { permissionId: true }, orderBy: { permissionId: 'asc' } } }, orderBy: { id: 'asc' } }),
    sessions: await db.session.findMany({ select: { id: true, userId: true }, orderBy: { id: 'asc' } }),
  };
}
async function actor(key) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  contexts.push(context);
  await context.addCookies([{ name: 'lor_session', value: fixture.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const incidentalApi = url.pathname.startsWith('/api/') && !['/api/libro/reporte', '/api/maintenance', '/api/health/version'].includes(url.pathname);
    const prefetch = request.headers()['next-router-prefetch'] === '1' || request.headers().purpose === 'prefetch';
    return url.origin !== ORIGIN || incidentalApi || prefetch ? route.abort() : route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000);
  await page.addInitScript(() => {
    window.__shiftUxActionResults = [];
    window.addEventListener('aroh:action-result', event => {
      if (typeof event.detail?.ok === 'boolean') window.__shiftUxActionResults.push({ ok: event.detail.ok, formId: event.detail.formId });
    });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  return { key, context, page, errors };
}
async function visit(who, path) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  activePage = who.page;
  await who.page.goto(ORIGIN + path);
}
async function submit(who, button, expectedOk = true) {
  activePage = who.page;
  const formId = await button.evaluate(element => element.form?.id);
  assert.ok(formId, 'Submission uses the real native ActionForm');
  const offset = await who.page.evaluate(() => window.__shiftUxActionResults.length);
  await button.click();
  await waitForNativeShiftReceipt(who.page, { formId, offset }, expectedOk);
}
async function byLabel(who, name, expectedOk = true) {
  await submit(who, who.page.getByRole('button', { name, exact: true }), expectedOk);
}
async function screenshot(who, name, width = 1280) {
  await who.page.setViewportSize({ width, height: 900 });
  assert.ok(await who.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} fits viewport ${width}`);
  await who.page.screenshot({ path: `${OUTPUT}/${name}-${width}.png`, fullPage: true });
  await who.page.setViewportSize({ width: 1280, height: 900 });
}
async function api(who, path, method = 'GET') {
  // APIRequestContext ignores browser route interception. Pin every probe to
  // this origin and prohibit redirects; no app response is mocked or replaced.
  assert.ok(path.startsWith('/api/'));
  return who.context.request.fetch(ORIGIN + path, { method, maxRedirects: 0, timeout: 15_000,
    headers: { Origin: ORIGIN }, ...(method === 'POST' ? { data: {} } : {}) });
}
async function assertBlockedApi(who, path, method = 'GET') {
  const response = await api(who, path, method);
  assert.equal(response.status(), 503, `${method} ${path} is rejected on the server`);
  assert.equal(response.headers()['cache-control'], 'no-store');
  assert.equal((await response.json()).code, 'MAINTENANCE');
}
async function adminReady(expected) {
  await visit(admin, CONTROL);
  await admin.page.getByRole('heading', { name: 'Disponibilidad y cierre ordenado', exact: true }).waitFor();
  assert.equal(await admin.page.getByRole('button', { name: 'Descargar respaldo actualizado', exact: true }).isEnabled(), expected);
}
async function fillCount(who) {
  const page = who.page;
  await page.locator(`input[name="d_${fixture.denominationId}"]`).fill('5');
  await page.locator(`input[name="g_${fixture.guaranteeId}"]`).check();
}
async function checkUrgents(page) {
  for (const checkbox of await page.locator('input[name="urgentAcknowledged"]').all()) await checkbox.check();
}
async function closeNative(who, shift, exerciseFailure = false) {
  mark(`native-close-${who.key}`);
  await visit(who, '/turno');
  await who.page.getByRole('heading', { name: 'Cierre de tu turno', exact: true }).waitFor();
  await byLabel(who, 'Cerrar y enviar turno');
  await who.page.waitForURL(/\/turno\/entrega\/[^/?]+/);
  const handover = await db.shiftHandover.findUniqueOrThrow({ where: { fromShiftId: shift.id } });
  assert.equal(handover.status, 'BORRADOR');
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).status, 'PREPARANDO_ENTREGA');
  if (exerciseFailure) {
    // A forged navigation step cannot skip the server's cash/custody gates.
    await visit(who, `/turno/entrega/${handover.id}?paso=4`);
    await who.page.getByText('Cierre guiado · paso 1 de 4', { exact: true }).waitFor();
    assert.equal(await who.page.getByRole('button', { name: 'REVISAR Y ENVIAR ENTREGA', exact: true }).count(), 0);
    await visit(who, `/turno/entrega/${handover.id}?paso=1`);
    // Bypass only HTML required validation to prove the real action rejects
    // omitted physical guarantee validation; no backend or response is faked.
    const countButton = who.page.getByRole('button', { name: 'Guardar arqueo declarado', exact: true });
    await who.page.locator(`input[name="d_${fixture.denominationId}"]`).fill('5');
    await countButton.evaluate(element => { element.form.noValidate = true; });
    await submit(who, countButton, false);
    assert.equal(await db.cashCount.count({ where: { handoverId: handover.id } }), 0);
    assert.equal((await db.shift.findUniqueOrThrow({ where: { id: shift.id } })).actualEnd, null);
    await countButton.evaluate(element => { element.form.noValidate = false; });
    results.push({ failedPhysicalValidationPreservedShift: true, forgedStepCannotSkip: true });
  }
  await fillCount(who);
  await byLabel(who, 'Guardar arqueo declarado');
  await who.page.getByRole('button', { name: 'CERRAR CAJA', exact: true }).waitFor();
  const element = await db.handoverElement.findFirstOrThrow({ where: { handoverId: handover.id, elementTypeId: fixture.elementTypeId } });
  await who.page.locator('select[name="elementPicker"]').selectOption(element.id);
  await byLabel(who, 'Guardar elementos de entrega');
  await byLabel(who, 'CERRAR CAJA');
  await who.page.getByRole('heading', { name: 'Caja cerrada', exact: true }).waitFor();
  await who.page.getByRole('link', { name: 'SIGUIENTE →', exact: true }).click();
  await who.page.waitForURL(url => url.searchParams.get('paso') === '2');
  await byLabel(who, 'CONFIRMAR PENDIENTES REVISADOS');
  await who.page.waitForURL(url => url.searchParams.get('paso') === '3');
  await checkUrgents(who.page);
  await byLabel(who, 'CONFIRMAR REVISIÓN FINAL');
  await who.page.waitForURL(url => url.searchParams.get('paso') === '4');
  await who.page.getByRole('button', { name: 'REVISAR Y ENVIAR ENTREGA', exact: true }).click();
  const sendDialog = who.page.getByRole('dialog', { name: '¿Estás seguro/a de que quieres enviar la entrega?', exact: true });
  await sendDialog.waitFor();
  await submit(who, sendDialog.getByRole('button', { name: 'SÍ, ENVIAR ENTREGA', exact: true }));
  await who.page.getByRole('button', { name: 'CERRAR MI TURNO', exact: true }).waitFor();
  await who.page.getByRole('button', { name: 'CERRAR MI TURNO', exact: true }).click();
  const closeDialog = who.page.getByRole('dialog', { name: '¿Confirmas el cierre definitivo de tu turno?', exact: true });
  await closeDialog.waitFor();
  await submit(who, closeDialog.getByRole('button', { name: 'SÍ, CERRAR TURNO', exact: true }));
  await who.page.waitForURL(ORIGIN + '/turno');
  const closed = await db.shift.findUniqueOrThrow({ where: { id: shift.id } });
  assert.equal(closed.status, 'CERRADO'); assert.ok(closed.actualEnd);
  assert.equal(await db.shiftAssignment.count({ where: { shiftId: shift.id, leftAt: null } }), 0);
  const sent = await db.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
  assert.equal(sent.status, 'ENVIADA'); assert.ok(sent.issuedAt); assert.equal(sent.receivedAt, null);
  assert.equal((await state()).enabled, false, 'One person closing never locks everyone out');
  return handover.id;
}
async function receiveNative(who, handoverId) {
  mark(`native-final-receipt-${handoverId}`);
  const beforeShifts = await db.shift.count(), beforeAssignments = await db.shiftAssignment.count();
  await visit(who, `/turno/entrega/${handoverId}`);
  await byLabel(who, 'Recibir entrega final');
  await who.page.getByText('Recepción de turno · paso 1 de 5', { exact: true }).waitFor();
  const claimed = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  assert.equal(claimed.receivedById, fixture.users[who.key].id); assert.equal(claimed.receivedAt, null);
  await byLabel(who, 'CONFIRMAR ENTREGA REVISADA');
  await who.page.getByText('Recepción de turno · paso 2 de 5', { exact: true }).waitFor();
  await fillCount(who);
  await byLabel(who, 'Confirmar arqueo recibido');
  await who.page.getByText('Recepción de turno · paso 3 de 5', { exact: true }).waitFor();
  const element = await db.handoverElement.findFirstOrThrow({ where: { handoverId, elementTypeId: fixture.elementTypeId } });
  await who.page.locator('select[name="elementPicker"]').selectOption(element.id);
  await byLabel(who, 'Confirmar elementos recibidos');
  await byLabel(who, 'CONFIRMAR CAJA Y CUSTODIA');
  await who.page.getByText('Recepción de turno · paso 4 de 5', { exact: true }).waitFor();
  await checkUrgents(who.page);
  await byLabel(who, 'CONFIRMAR REVISIÓN FINAL');
  await who.page.getByText('Recepción de turno · paso 5 de 5', { exact: true }).waitFor();
  await who.page.locator('textarea[name="observations"]').fill('SYNTHETIC CLOSURE · recepción final verificada en navegador sin nueva jornada.');
  await screenshot(who, `final-reception-confirmation-${handoverId}`, 390);
  await byLabel(who, 'Confirmar recepción final');
  await who.page.waitForURL(ORIGIN + '/turno');
  const received = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  assert.equal(received.status, 'RECIBIDA'); assert.ok(received.receivedAt); assert.equal(received.toShiftId, null);
  assert.equal(received.receivedById, fixture.users[who.key].id);
  assert.equal(await db.shift.count(), beforeShifts, 'Final receipt does not create a shift');
  assert.equal(await db.shiftAssignment.count(), beforeAssignments, 'Final receipt does not create participation');
  await visit(who, `/turno/entrega/${handoverId}`);
  await who.page.getByText('Recepción final completada · sin nueva jornada', { exact: true }).waitFor();
  await screenshot(who, `final-reception-completed-${handoverId}`, 390);
  results.push({ nativeFinalReceipt: true, noNewWorkday: true, handoverId });
}
async function recover() {
  const current = await state();
  if (!current?.closure || !admin) return;
  await visit(admin, CONTROL);
  await admin.page.getByText('Recuperación del sistema', { exact: true }).click();
  await admin.page.getByRole('checkbox', { name: 'Confirmo que deseo desactivar el cierre ordenado y restablecer el acceso del personal.', exact: true }).check();
  await byLabel(admin, 'Recuperar acceso del sistema');
  await admin.page.getByRole('button', { name: 'Activar despedida y cierre operativo', exact: true }).waitFor();
  assert.equal((await state()).closure, null); assert.equal((await state()).enabled, false);
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  admin = await actor('admin');
  const worker = await actor('worker'), coworker = await actor('coworker'), receiver = await actor('receiver');
  const accountsBefore = await accountSnapshot();
  assert.equal(await db.mailSettings.count(), 0, 'No mail configuration in the disposable fixture');
  assert.equal(await db.operationalEntry.count(), fixture.expectedEntries);
  assert.ok(fixture.expectedEntries > 2000);
  mark('authenticated-before-farewell');
  await visit(receiver, '/perfil');
  await receiver.page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
  await visit(admin, CONTROL);
  const begin = admin.page.getByRole('button', { name: 'Activar despedida y cierre operativo', exact: true });
  await begin.waitFor();
  await begin.click();
  assert.equal((await state())?.closure ?? null, null, 'Unchecked explicit confirmation cannot activate farewell');
  await admin.page.getByRole('checkbox', { name: 'Confirmo que se mostrará la despedida, no se iniciarán turnos nuevos y sólo se permitirá finalizar la operación pendiente.', exact: true }).check();
  await submit(admin, begin);
  await admin.page.getByRole('button', { name: 'Descargar respaldo actualizado', exact: true }).waitFor();
  assert.equal((await state()).closure.phase, 'CLOSING'); assert.equal((await state()).enabled, false);
  await adminReady(false);
  assert.equal(await admin.page.getByRole('button', { name: 'Dejar acceso exclusivo a sysadmin', exact: true }).isDisabled(), true);
  await screenshot(admin, 'pending-admin');
  mark('restricted-page-and-direct-actions');
  await visit(worker, '/libro');
  await worker.page.waitForURL(ORIGIN + '/turno');
  await worker.page.getByRole('heading', { name: 'Cierre de tu turno', exact: true }).waitFor();
  assert.equal(await worker.page.getByRole('button', { name: 'Abrir mi turno', exact: true }).count(), 0);
  await screenshot(worker, 'farewell'); await screenshot(worker, 'farewell', 390);
  await visit(receiver, '/turno');
  await receiver.page.getByText(/No tienes un turno pendiente de cierre/).waitFor();
  await assertBlockedApi(worker, '/api/chat/saved');
  await assertBlockedApi(worker, '/api/operational-actions/task-status', 'POST');
  assert.equal((await api(admin, '/api/chat/saved')).status(), 200, 'SysAdmin keeps API access during closing');
  const handovers = [];
  handovers.push(await closeNative(worker, fixture.shifts[0], true));
  await adminReady(false);
  await visit(coworker, '/turno');
  await coworker.page.getByRole('button', { name: 'Cerrar y enviar turno', exact: true }).waitFor();
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: fixture.shifts[1].id } })).status, 'ACTIVO');
  results.push({ oneUserDoesNotLockOthers: true, pendingOtherShiftPreserved: true });
  handovers.push(await closeNative(coworker, fixture.shifts[1]));
  await adminReady(false);
  for (const handoverId of handovers) await receiveNative(receiver, handoverId);
  await adminReady(true);
  await screenshot(admin, 'ready-for-backup');
  mark('download-save-and-full-content');
  const downloadPromise = admin.page.waitForEvent('download');
  await admin.page.getByRole('button', { name: 'Descargar respaldo actualizado', exact: true }).click();
  const download = await downloadPromise;
  const savedPath = `${OUTPUT}/${download.suggestedFilename()}`;
  await download.saveAs(savedPath);
  assert.equal(await download.failure(), null, 'Actual browser download finishes before verification');
  const bytes = readFileSync(savedPath), exported = JSON.parse(bytes.toString('utf8'));
  assert.equal(exported.format, 'AROH_SYSTEM_CLOSURE_BACKUP');
  for (const user of Object.values(fixture.users)) assert.equal(bytes.includes(Buffer.from(user.token)), false, 'Session credentials never enter the operational backup');
  const tables = exported.data.tables;
  assert.equal(tables.entries.length, fixture.expectedEntries, 'More than 2,000 source records are exported');
  assert.ok(tables.entries.some(entry => entry.description.includes('BEYOND_2000_LIMIT')));
  assert.equal(tables.entries.find(entry => entry.id === fixture.source.entryId).description, fixture.source.fullDescription);
  assert.equal(tables.comments.find(comment => comment.id === fixture.source.commentId).body, fixture.source.fullComment);
  assert.ok(tables.auditLogs.some(event => event.entityId === fixture.source.entryId && event.summary === 'SYNTHETIC CLOSURE source trace'));
  for (const humanId of fixture.requiredClosureHumanIds) assert.ok(tables.shifts.some(shift => shift.humanId === humanId && shift.status === 'CERRADO'));
  for (const shift of fixture.shifts) assert.ok(tables.shifts.some(row => row.id === shift.id && row.status === 'CERRADO' && row.actualEnd));
  for (const handoverId of handovers) assert.ok(tables.handovers.some(row => row.id === handoverId && row.status === 'RECIBIDA' && row.receivedAt && row.toShiftId === null));
  const digest = createHash('sha256').update(bytes).digest('hex');
  await admin.page.getByLabel('Seleccionar el respaldo guardado', { exact: true }).waitFor();
  let current = await state();
  assert.equal(current.closure.backup.digest, digest);
  assert.equal(current.closure.backup.verifiedAt, null, 'Generating/downloading never marks the saved file verified');
  assert.equal(await admin.page.getByRole('button', { name: 'Dejar acceso exclusivo a sysadmin', exact: true }).isDisabled(), true);
  const corruptPath = `${OUTPUT}/corrupt-synthetic-backup.json`;
  writeFileSync(corruptPath, JSON.stringify({ ...exported, createdAt: 'tampered-local-file' }));
  await admin.page.getByLabel('Seleccionar el respaldo guardado', { exact: true }).setInputFiles(corruptPath);
  await admin.page.getByText('El archivo no coincide con el último respaldo. Selecciona el archivo correcto o genera uno nuevo.', { exact: true }).waitFor();
  assert.equal(await admin.page.getByRole('button', { name: 'Verificar respaldo guardado', exact: true }).isDisabled(), true);
  await admin.page.getByLabel('Seleccionar el respaldo guardado', { exact: true }).setInputFiles(savedPath);
  await admin.page.getByText('Archivo local leído: coincide con el respaldo generado. Confirma su revisión para verificar vigencia en servidor.', { exact: true }).waitFor();
  await admin.page.getByRole('checkbox', { name: 'Abrí y revisé el respaldo guardado: contiene los cierres y novedades completos, incluido el turno final.', exact: true }).check();
  await byLabel(admin, 'Verificar respaldo guardado');
  await admin.page.getByText('Respaldo verificado. El bloqueo volverá a comprobar que no hay pendientes ni cambios.', { exact: true }).waitFor();
  assert.ok((await state()).closure.backup.verifiedAt);
  await screenshot(admin, 'verified-backup', 390);
  results.push({ actualSavedDownload: true, fullSourceDescriptions: true, fullComments: true, traceability: true, recordsBeyond2000: fixture.expectedEntries, requiredHistoricalClosures: true, finalClosuresIncluded: true, corruptFileRejected: true, digest });
  mark('specific-explicit-lock');
  await admin.page.getByLabel('Escribe DEJAR ACCESO SOLO A SYSADMIN', { exact: true }).fill('CONFIRMACION INCORRECTA');
  await admin.page.getByRole('checkbox', { name: 'Autorizo específicamente el bloqueo final del personal, después de revisar y verificar el respaldo actualizado.', exact: true }).check();
  await byLabel(admin, 'Dejar acceso exclusivo a sysadmin', false);
  assert.equal((await state()).closure.phase, 'CLOSING');
  await admin.page.getByLabel('Escribe DEJAR ACCESO SOLO A SYSADMIN', { exact: true }).fill('DEJAR ACCESO SOLO A SYSADMIN');
  await byLabel(admin, 'Dejar acceso exclusivo a sysadmin');
  current = await state(); assert.equal(current.closure.phase, 'LOCKED'); assert.equal(current.enabled, true);
  mark('existing-sessions-blocked-sysadmin-preserved');
  for (const who of [worker, coworker, receiver]) {
    await visit(who, '/perfil'); await who.page.waitForURL(ORIGIN + '/mantenimiento');
    await who.page.getByRole('heading', { name: 'Sistema fuera de servicio', exact: true }).waitFor();
    assert.equal(await who.page.getByRole('link', { name: 'Abrir control de mantenimiento', exact: true }).count(), 0);
    await assertBlockedApi(who, '/api/chat/saved');
    await assertBlockedApi(who, '/api/operational-actions/task-status', 'POST');
  }
  await screenshot(worker, 'out-of-service'); await screenshot(worker, 'out-of-service', 390);
  await visit(admin, CONTROL);
  await admin.page.getByRole('heading', { name: 'Disponibilidad y cierre ordenado', exact: true }).waitFor();
  assert.equal((await api(admin, '/api/chat/saved')).status(), 200);
  await screenshot(admin, 'locked-sysadmin'); await screenshot(admin, 'locked-sysadmin', 390);
  assert.deepEqual(await accountSnapshot(), accountsBefore, 'Accounts, permissions and preexisting sessions are preserved');
  mark('explicit-recovery');
  await recover();
  await visit(receiver, '/perfil');
  await receiver.page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
  assert.equal((await api(receiver, '/api/chat/saved')).status(), 200);
  assert.deepEqual(await accountSnapshot(), accountsBefore);
  assert.equal(await db.shift.count(), fixture.shifts.length + fixture.requiredClosureHumanIds.length, 'The full flow never opens a new workday');
  for (const who of [admin, worker, coworker, receiver]) assert.deepEqual(who.errors, [], 'No browser runtime exceptions');
  results.push({ explicitLockRequired: true, wrongConfirmationRejected: true, existingSessionsBlocked: true, sysadminAdminAndApiPreserved: true, accountsRolesSessionsConserved: true, explicitRecovery: true });
} catch (error) {
  failure = error;
  evidence({ phase: 'failed', at: phase, error: error instanceof Error ? error.name : 'Unknown error',
    ...(error instanceof assert.AssertionError ? { assertion: error.message } : {}),
    location: error instanceof Error ? error.stack?.split('\n').find(line => line.includes('/scripts/closure/browser.mjs:'))?.trim() : undefined });
  await activePage?.screenshot({ path: `${OUTPUT}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  try { await recover(); } catch (error) { failure ??= error; evidence({ phase: 'cleanup-recovery-failed', error: error.name }); }
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close(); await db.$disconnect();
  const report = { suite: 'ordered-closure', passed: !failure, lastPhase: phase, results, output: OUTPUT, productionRequests: 0 };
  writeFileSync(`${OUTPUT}/results.json`, JSON.stringify(report, null, 2) + '\n');
  evidence({ phase: 'finished', passed: !failure, assertionsGroups: results.length, evidenceDirectory: OUTPUT });
}
if (failure) process.exitCode = 1;
