import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const [baseline, candidate, output] = process.argv.slice(2).map(p => resolve(p));
const requireCandidate = createRequire(`${candidate}/package.json`);
const { PrismaClient } = requireCandidate('@prisma/client');
const { chromium } = await import(pathToFileURL(`${candidate}/node_modules/playwright-core/index.mjs`).href);
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const backends = { baseline: { tree: baseline, port: 3101 }, candidate: { tree: candidate, port: 3102 } };
let activeBackend = 'baseline';
const children = [], contexts = [], results = [];
const customResponses = new Map();
let customResponseSequence = 0;
const report = { platformSkew: 'NOT_TESTED', productionDecision: 'UNVERIFIED',
  candidateStatus: 'PROVISIONAL_COMPATIBILITY_ONLY_NOT_RELEASE_APPROVED', results,
  sourceCommits: {
    baseline: readFileSync(`${output}/baseline-sha.txt`, 'utf8').trim(),
    candidate: readFileSync(`${output}/candidate-sha.txt`, 'utf8').trim(),
  } };
assert.match(report.sourceCommits.baseline, /^[a-f0-9]{40}$/);
assert.match(report.sourceCommits.candidate, /^[a-f0-9]{40}$/);
report.customApiContractSources = [
  'src/components/operational/navigation-action.ts',
  'src/components/operational/cash-box.tsx',
  'src/app/api/operational-actions/[procedure]/route.ts',
  'src/server/actions/cash.ts',
  'src/server/services/handover-elements.ts',
  'src/server/security/same-origin.ts',
].map(path => {
  const sha256 = tree => createHash('sha256').update(readFileSync(`${tree}/${path}`)).digest('hex');
  const baselineSha256 = sha256(baseline), candidateSha256 = sha256(candidate);
  return { path, baselineSha256, candidateSha256, identical: baselineSha256 === candidateSha256 };
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function metadata(tree) {
  const manifest = JSON.parse(readFileSync(`${tree}/.next/server/server-reference-manifest.json`, 'utf8'));
  return { version: JSON.parse(readFileSync(`${tree}/package.json`, 'utf8')).version,
    buildId: readFileSync(`${tree}/.next/BUILD_ID`, 'utf8').trim(),
    actionIds: new Set([...Object.keys(manifest.node ?? {}), ...Object.keys(manifest.edge ?? {})]),
    encryptionKey: manifest.encryptionKey };
}
const oldBuild = metadata(baseline), newBuild = metadata(candidate);
assert.equal(oldBuild.version, '1.57.0');
assert.equal(newBuild.version, '1.58.0');
assert.notEqual(oldBuild.buildId, newBuild.buildId);
report.builds = { baseline: { version: oldBuild.version, buildId: oldBuild.buildId },
  candidate: { version: newBuild.version, buildId: newBuild.buildId },
  sharedActionIds: [...oldBuild.actionIds].filter(id => newBuild.actionIds.has(id)).length,
  independentActionEncryptionKeys: Boolean(oldBuild.encryptionKey && newBuild.encryptionKey && oldBuild.encryptionKey !== newBuild.encryptionKey) };
// Never print, persist or override either manifest's encryptionKey.
delete oldBuild.encryptionKey; delete newBuild.encryptionKey;
assert.equal(report.builds.independentActionEncryptionKeys, true, 'Independent build encryption keys are required; do not override them to pass');

// Same origin/cookies/Host/Origin before and after the switch. No old deployment
// fallback, sticky routing, request replay, asset merging or simulated Skew.
const proxy = http.createServer((request, response) => {
  const selected = activeBackend;
  const observeCustomJson = request.method === 'POST' && /^\/api\/operational-actions\/handover-missing(?:-approve)?(?:\?|$)/.test(request.url);
  const observationId = observeCustomJson ? String(++customResponseSequence) : null;
  const upstream = http.request({ hostname: '127.0.0.1', port: backends[selected].port,
    path: request.url, method: request.method, headers: request.headers }, incoming => {
    if (observeCustomJson) {
      const chunks = []; let bytes = 0;
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes <= 65536) chunks.push(chunk); });
      incoming.on('end', () => {
        try {
          if (bytes > 65536) throw new Error('Synthetic custom API response exceeds observation limit');
          let body = Buffer.concat(chunks);
          const encoding = incoming.headers['content-encoding'];
          const limits = { maxOutputLength: 65536 };
          if (encoding === 'gzip') body = gunzipSync(body, limits);
          else if (encoding === 'deflate') body = inflateSync(body, limits);
          else if (encoding === 'br') body = brotliDecompressSync(body, limits);
          else if (encoding && encoding !== 'identity') throw new Error('Unsupported response encoding in synthetic observer');
          if (body.length > 65536) throw new Error('Decoded synthetic response exceeds observation limit');
          customResponses.set(observationId, { body: JSON.parse(body.toString('utf8')) });
        } catch (error) { customResponses.set(observationId, { error: error.message }); }
      });
    }
    response.writeHead(incoming.statusCode, { ...incoming.headers, 'x-cross-version-backend': selected,
      ...(observationId ? { 'x-cross-version-observation': observationId } : {}) });
    incoming.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Synthetic upstream unavailable'); });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
});

async function eventually(check, message, timeout = 15000) {
  const until = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await sleep(100); } while (Date.now() < until);
  throw new Error(message);
}
async function runFixture(scenario = 'normal') {
  const path = `${output}/private-fixture.json`;
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/cross-version/fixture.mts', path, scenario],
      { cwd: candidate, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error('Synthetic fixture failed')));
  });
  return JSON.parse(readFileSync(path, 'utf8'));
}
async function actor(browser, fixture, key, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  contexts.push(context);
  await context.addCookies([{ name: 'lor_session', value: fixture.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { report.externalBrowserRequestBlocked = true; return route.abort(); }
    // Only the long-lived notification stream is excluded; auth pulse stays on.
    return url.pathname === '/api/notifications/stream' ? route.abort() : route.continue();
  });
  await context.routeWebSocket('**/*', socket => { report.webSocketBlocked = true; socket.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  return { context, page };
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const formFor = (page, name) => page.locator('form').filter({ has: button(page, name) });
async function submit(page, name, evidence, expectedBackend = activeBackend) {
  await page.evaluate(() => { window.__crossAction = null; window.addEventListener('aroh:action-result', event => {
    window.__crossAction = { ok: event.detail.ok };
  }, { once: true }); });
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && Boolean(response.request().headers()['next-action']));
  // Attach rejection handling before click, so click failures cannot leak it.
  const observed = pending.then(response => ({ response }), error => ({ error }));
  await button(page, name).click();
  const captured = await observed;
  if (captured.error) throw new Error('No browser Server Action POST was observed');
  const response = captured.response;
  const actionId = response.request().headers()['next-action'];
  const row = { control: name, actionId, backend: response.headers()['x-cross-version-backend'], status: response.status(),
    actionFromBaselineManifest: oldBuild.actionIds.has(actionId), actionPresentInCandidateManifest: newBuild.actionIds.has(actionId) };
  evidence.push(row);
  assert.equal(row.backend, expectedBackend, 'Submission went to the wrong build');
  if (expectedBackend === 'candidate' && page.__oldDocument) assert.ok(row.actionFromBaselineManifest, 'Not a baseline action');
  assert.ok(response.ok(), `Server Action HTTP ${response.status()}`);
  await page.waitForFunction(() => window.__crossAction !== null);
  row.applicationAccepted = await page.evaluate(() => window.__crossAction.ok);
  assert.equal(row.applicationAccepted, true, 'Application rejected the actual browser form');
}
async function controls(form) {
  return form.evaluate(node => Array.from(node.elements).filter(el => el.name && !el.name.startsWith('$ACTION') && el.name !== 'metricStartedAt')
    .map(el => ({ name: el.name, value: el.value, checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : null })));
}
async function freeze(page, form) {
  const documentId = randomUUID();
  await page.evaluate(id => { window.__crossDocument = id; }, documentId);
  page.__oldDocument = activeBackend === 'baseline';
  return { documentId, values: await controls(form), href: page.url() };
}
async function unchanged(page, form, snapshot) {
  assert.equal(await page.evaluate(() => window.__crossDocument), snapshot.documentId, 'Document reloaded or replaced');
  assert.equal(page.url(), snapshot.href, 'Unexpected navigation');
  assert.deepEqual(await controls(form), snapshot.values, 'Unsaved input changed');
}
async function missingDraft(page, path, procedure, reason) {
  await page.goto(path);
  const isApproval = procedure === 'handover-missing-approve';
  const name = isApproval ? 'Autorizar continuidad con diferencia' : 'Registrar no recibido';
  await page.locator('summary').filter({ hasText: isApproval ? /^Revisar excepción$/ : /^(Corregir no recibido|No recibido)$/ }).click();
  const form = formFor(page, name);
  await form.locator('textarea[name=reason]').fill(reason);
  return { page, form, name, procedure, snapshot: await freeze(page, form) };
}
async function submitCustom(draft, evidence, expectedError) {
  const { page, form, name, procedure, snapshot } = draft;
  const expectedFields = Object.fromEntries(snapshot.values.map(control => [control.name, control.value]));
  assert.deepEqual(Object.keys(expectedFields).sort(), ['elementId', 'handoverId', 'reason', 'revision']);
  await unchanged(page, form, snapshot);
  const oldDocument = page.__oldDocument;
  const endpoint = `/api/operational-actions/${procedure}`;
  // Observe bytes at the transparent proxy: native document navigation can
  // remove CDP's response body before Playwright reads it. Do not replay,
  // modify bodies, pin the client or delay its real navigation.
  const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint)
    .then(async response => ({ response, headers: await response.request().allHeaders() }))
    .then(value => ({ value }), error => ({ error }));
  await button(page, name).click();
  const captured = await pending;
  if (captured.error) throw new Error(`Custom API observation failed: ${captured.error.message}`);
  const { response, headers } = captured.value;
  const observationId = response.headers()['x-cross-version-observation'];
  const observed = await eventually(() => customResponses.get(observationId), 'Custom API response was not observed at proxy');
  customResponses.delete(observationId);
  assert.equal(observed.error, undefined, observed.error);
  const body = observed.body;
  const request = response.request(), requestFields = request.postDataJSON();
  const action = { transport: 'custom-json', procedure,
    clientDocument: oldDocument ? 'baseline' : 'candidate',
    backend: response.headers()['x-cross-version-backend'], status: response.status(),
    requestFields: Object.keys(requestFields).sort(), responseFields: Object.keys(body).sort(),
    hasFrameworkActionHeader: Boolean(headers['next-action']),
    hasDeploymentHeader: Boolean(headers['x-deployment-id']),
    hasDeploymentQuery: new URL(request.url()).searchParams.has('dpl'),
    applicationAccepted: body.ok, expectedRejection: Boolean(expectedError),
  };
  evidence.push(action);
  assert.equal(action.backend, 'candidate');
  assert.equal(action.hasFrameworkActionHeader, false, 'Custom API was confused with a framework Server Action');
  assert.ok(headers['content-type']?.startsWith('application/json'));
  assert.equal(headers.origin, origin);
  assert.deepEqual(requestFields, expectedFields, 'Old form JSON contract changed in transit');
  if (oldDocument) {
    assert.equal(action.hasDeploymentHeader, false, 'Baseline custom fetch was altered to pin a deployment');
    assert.equal(action.hasDeploymentQuery, false);
  }
  if (expectedError) {
    assert.equal(response.status(), 400); assert.equal(body.ok, false);
    assert.match(body.error, expectedError); assert.equal(body.navigateTo, undefined);
    await page.getByRole('alert').filter({ hasText: expectedError }).waitFor();
    await unchanged(page, form, snapshot);
    action.rejectedDraftRetained = true;
  } else {
    assert.equal(response.status(), 200); assert.equal(body.ok, true);
    assert.equal(typeof body.message, 'string');
    assert.deepEqual(action.responseFields, ['message', 'navigateTo', 'ok']);
    assert.equal(body.navigateTo, `/turno/entrega/${encodeURIComponent(expectedFields.handoverId)}`);
    await page.waitForFunction(id => window.__crossDocument !== id, snapshot.documentId);
    assert.equal(page.url(), `${origin}${body.navigateTo}`);
    action.nativeDocumentNavigationObserved = true;
  }
  return action;
}
async function customCustodyScenario(browser, width, mode, row) {
  const crossed = mode === 'cross-custom-custody';
  const fixture = await runFixture('custody-exception');
  const { handoverId, elementId, incomingShiftId } = fixture.exception;
  const path = `${origin}/turno/entrega/${handoverId}`;
  const receiver = await actor(browser, fixture, 'incoming', width);
  const supervisor = await actor(browser, fixture, 'admin', width);
  const staleReceiver = await receiver.context.newPage(); staleReceiver.setDefaultTimeout(15000);
  const staleSupervisor = await supervisor.context.newPage(); staleSupervisor.setDefaultTimeout(15000);
  const beforeHandover = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  const beforeGuarantee = await db.guarantee.findUniqueOrThrow({ where: { id: fixture.guaranteeId } });
  const beforeCounts = await db.cashCount.count({ where: { handoverId } });
  const beforeMovements = await db.cashMovement.findMany({ where: { shiftId: fixture.shiftId }, orderBy: { id: 'asc' } });
  const load = async (page, procedure, reason) => {
    activeBackend = crossed ? 'baseline' : 'candidate';
    return missingDraft(page, path, procedure, reason);
  };
  const currentElement = () => db.handoverElement.findUniqueOrThrow({ where: { id: elementId } });
  const currentAudits = () => db.auditLog.findMany({ where: { entity: 'ShiftHandover', entityId: handoverId }, orderBy: { id: 'asc' } });
  const firstReason = `PRUEBA SINTÉTICA ${width} · falta llave; localizar con saliente`;
  const reportDraft = await load(receiver.page, 'handover-missing', firstReason);
  const staleReportDraft = await load(staleReceiver, 'handover-missing', 'PRUEBA SINTÉTICA · revisión vieja no debe reemplazar la declaración');
  row.stage = 'old-custom-missing-report'; activeBackend = 'candidate';
  await submitCustom(reportDraft, row.actions);
  let element = await currentElement();
  assert.equal(element.missingReason, firstReason); assert.equal(element.missingReportedById, fixture.users.incoming.id);
  assert.ok(element.missingReportedAt); assert.equal(element.confirmed, false); assert.equal(element.missingApprovedAt, null);
  const reportedAudits = await currentAudits();
  assert.equal(reportedAudits.filter(audit => audit.after?.elementId === elementId && audit.after?.responsibleId === fixture.users.incoming.id).length, 1);
  assert.ok(reportedAudits.some(audit => audit.sessionId === fixture.users.incoming.sessionId));
  await submitCustom(staleReportDraft, row.actions, /custodia cambió/i);
  assert.deepEqual(await currentElement(), element); assert.deepEqual(await currentAudits(), reportedAudits);
  assert.equal(await receiver.page.getByText('Revisar excepción', { exact: true }).count(), 0);

  const staleApproval = await load(staleSupervisor, 'handover-missing-approve', 'PRUEBA SINTÉTICA · aprobación con revisión vieja');
  const correctedReason = `PRUEBA SINTÉTICA ${width} · responsable localiza llave con Supervisor`;
  const correction = await load(receiver.page, 'handover-missing', correctedReason);
  row.stage = 'old-custom-correction-invalidates-stale-approval'; activeBackend = 'candidate';
  await submitCustom(correction, row.actions);
  element = await currentElement(); const correctedAudits = await currentAudits();
  await submitCustom(staleApproval, row.actions, /diferencia cambió/i);
  assert.deepEqual(await currentElement(), element); assert.deepEqual(await currentAudits(), correctedAudits);
  const approvalReason = `PRUEBA SINTÉTICA ${width} · Supervisor localiza; continuidad con diferencia`;
  const approval = await load(supervisor.page, 'handover-missing-approve', approvalReason);
  row.stage = 'old-custom-independent-approval'; activeBackend = 'candidate';
  await submitCustom(approval, row.actions);
  element = await currentElement();
  assert.equal(element.missingApprovedById, fixture.users.admin.id); assert.ok(element.missingApprovedAt);
  assert.equal(element.missingApprovalNote, approvalReason); assert.equal(element.confirmed, false);
  const approvalAudits = await currentAudits();
  assert.equal(approvalAudits.filter(audit => audit.after?.elementId === elementId && audit.after?.approvedById === fixture.users.admin.id).length, 1);
  assert.ok(approvalAudits.some(audit => audit.after?.approvedById === fixture.users.admin.id && audit.sessionId === fixture.users.admin.sessionId));
  assert.notEqual(element.missingReportedById, element.missingApprovedById);

  const finalReason = `PRUEBA SINTÉTICA ${width} · corregido después de autorizar; exige nueva revisión`;
  const correctionAfterApproval = await load(receiver.page, 'handover-missing', finalReason);
  activeBackend = 'candidate'; await submitCustom(correctionAfterApproval, row.actions);
  element = await currentElement();
  assert.equal(element.missingReason, finalReason); assert.equal(element.missingApprovedAt, null);
  assert.equal(element.missingApprovedById, null); assert.equal(element.missingApprovalNote, null); assert.equal(element.confirmed, false);
  const reapproval = await load(supervisor.page, 'handover-missing-approve', 'PRUEBA SINTÉTICA · revisión independiente de la corrección final');
  activeBackend = 'candidate'; await submitCustom(reapproval, row.actions);
  element = await currentElement();
  assert.ok(element.missingApprovedAt); assert.equal(element.missingApprovedById, fixture.users.admin.id);
  assert.equal(element.declared, true); assert.equal(element.confirmed, false);
  const afterHandover = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  assert.equal(afterHandover.status, 'ENVIADA'); assert.equal(afterHandover.receivedAt, null);
  assert.equal(afterHandover.receiverCustodyReviewedAt, null); assert.equal(afterHandover.receiverFinalReviewAt, null);
  assert.deepEqual(afterHandover.snapshot, beforeHandover.snapshot);
  for (const field of ['issuedById', 'issuerSessionId', 'issuedAt']) assert.deepEqual(afterHandover[field], beforeHandover[field]);
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: incomingShiftId } })).status, 'INICIADO');
  assert.deepEqual(await db.guarantee.findUniqueOrThrow({ where: { id: fixture.guaranteeId } }), beforeGuarantee);
  assert.equal(await db.cashCount.count({ where: { handoverId } }), beforeCounts);
  assert.deepEqual(await db.cashMovement.findMany({ where: { shiftId: fixture.shiftId }, orderBy: { id: 'asc' } }), beforeMovements);
  const keys = await db.roomKey.findMany({ orderBy: { id: 'asc' } });
  assert.equal(createHash('sha256').update(JSON.stringify(keys)).digest('hex'), fixture.keyInventoryDigest);
  assert.equal(await db.operationalMailOutbox.count({ where: { status: 'ENVIADO' } }), 0);
  row.customCustody = { oldClientToNewApi: crossed, requestAndResponseContractsVerified: true,
    staleReportAndApprovalRejectedWithoutWrites: true, independentApprovalAudited: true,
    correctionInvalidatesApproval: true, physicalPossessionNotInvented: true,
    nativeFullPageNavigationObserved: true, shiftNotActivatedByException: true,
    cashGuaranteeInventoryAndIssuedSnapshotUnchanged: true, platformPinning: 'NOT_TESTED' };
}
async function fillCash(page, fixture, kind, notes) {
  const name = kind === 'DECLARADO' ? 'Guardar arqueo declarado' : 'Confirmar arqueo recibido';
  const form = formFor(page, name); await form.waitFor();
  for (const id of fixture.denominationIds) await form.locator(`input[name="d_${id}"]`).fill('1');
  await form.locator(`input[name="g_${fixture.guaranteeId}"]`).check();
  await form.locator('textarea[name=notes]').fill(notes);
  return form;
}
async function verifyCash(fixture, handoverId, kind, notes, actorKey) {
  const count = await eventually(() => db.cashCount.findUnique({ where: { handoverId_kind: { handoverId, kind } }, include: { lines: true } }), 'Count not persisted');
  assert.equal(count.notes, notes); assert.equal(count.countedById, fixture.users[actorKey].id); assert.ok(count.countedAt);
  assert.equal(await db.cashCount.count({ where: { handoverId, kind } }), 1);
  const positive = count.lines.filter(line => line.quantity > 0);
  assert.deepEqual(positive.map(line => [line.denominationId, line.quantity]).sort(), fixture.denominationIds.map(id => [id, 1]).sort());
  assert.deepEqual(count.expectedSnapshot.guarantees.map(g => [g.id, g.amountMinor]), [[fixture.guaranteeId, 10000]]);
  return count;
}
async function declareElements(page, elementId) {
  const form = formFor(page, 'Guardar elementos de entrega');
  await form.locator('select[name=elementPicker]').selectOption(elementId);
  assert.equal(await form.locator(`input[name="e_${elementId}"]`).inputValue(), 'true');
  return form;
}
async function prepare(page, fixture, evidence, row) {
  await page.goto(`${origin}/turno`);
  await page.locator('summary').filter({ hasText: /^Entregar turno$/ }).click();
  await button(page, 'INICIAR CIERRE DE TURNO').click();
  await submit(page, 'SÍ, INICIAR CIERRE', evidence);
  const handover = await eventually(() => db.shiftHandover.findUnique({ where: { fromShiftId: fixture.shiftId } }), 'No native draft');
  row.preparation = { backend: activeBackend, nativeWritePersisted: true, automaticNavigation: true,
    explicitDocumentReloadBeforeMeasuredDraft: false, nativeContinueLinkUsed: false };
  const destination = `/turno/entrega/${handover.id}`;
  try { await page.waitForURL(url => url.pathname === destination); }
  catch {
    row.preparation.automaticNavigation = false;
    const continueLink = page.getByRole('link', { name: 'Continuar cierre · Caja y entrega', exact: true });
    if (!await continueLink.isVisible() && activeBackend === 'baseline') {
      // Baseline 1.57 may remain in its pending action after the confirmed DB
      // write. This explicit reload is only precondition construction, BEFORE
      // any draft under measurement exists; it never passes the native journey.
      row.preparation.explicitDocumentReloadBeforeMeasuredDraft = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await continueLink.click();
    row.preparation.nativeContinueLinkUsed = true;
    await page.waitForURL(url => url.pathname === destination);
  }
  await button(page, 'Guardar arqueo declarado').waitFor();
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: fixture.shiftId } })).status, 'PREPARANDO_ENTREGA');
  const element = await db.handoverElement.findUniqueOrThrow({ where: { handoverId_elementTypeId: { handoverId: handover.id, elementTypeId: fixture.elementTypeId } } });
  return { handoverId: handover.id, elementId: element.id, path: `${origin}/turno/entrega/${handover.id}` };
}
async function closeCash(page, fixture, path, evidence) {
  await page.goto(`${path}?paso=1`);
  await submit(page, 'CERRAR CAJA', evidence);
  const rows = await db.$queryRaw`SELECT "closedById", "closedAt", "reopenedAt", "snapshot" FROM "ShiftCashClosure" WHERE "shiftId" = ${fixture.shiftId}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].closedById, fixture.users.outgoing.id);
  assert.ok(rows[0].closedAt); assert.equal(rows[0].reopenedAt, null);
  assert.equal(rows[0].snapshot.openCashGuarantees, 1);
  const currencies = rows[0].snapshot.currencies;
  assert.equal(currencies.length, 2);
  for (const [currency, fund, guarantee] of [['CLP', 20000, 10000], ['USD', 20, 0]]) {
    const actual = currencies.find(row => row.currency === currency);
    assert.ok(actual);
    assert.equal(actual.fund, fund); assert.equal(actual.expected, fund); assert.equal(actual.counted, fund);
    assert.equal(actual.difference, 0); assert.equal(actual.guaranteeCustody, guarantee);
    assert.equal(actual.operational, 0); assert.equal(actual.transferable, 0);
  }
  return rows[0];
}
async function finishCycle(browser, outgoing, fixture, state, width, evidence) {
  const { handoverId, path, elementId } = state;
  await outgoing.goto(`${path}?paso=2`);
  await submit(outgoing, 'CONFIRMAR PENDIENTES REVISADOS', evidence);
  await outgoing.waitForURL('**?paso=3');
  const urgent = outgoing.locator('input[name=urgentAcknowledged]');
  if (await urgent.count()) await urgent.check();
  await submit(outgoing, 'CONFIRMAR REVISIÓN FINAL', evidence);
  await outgoing.waitForURL('**?paso=4');
  await button(outgoing, 'REVISAR Y ENVIAR ENTREGA').click();
  await submit(outgoing, 'SÍ, ENVIAR ENTREGA', evidence);
  await button(outgoing, 'CERRAR MI TURNO').waitFor();
  await button(outgoing, 'CERRAR MI TURNO').click();
  await submit(outgoing, 'SÍ, CERRAR TURNO', evidence);
  const closed = await db.shift.findUniqueOrThrow({ where: { id: fixture.shiftId }, include: { assignments: true } });
  assert.equal(closed.status, 'CERRADO'); assert.equal(closed.closedById, fixture.users.outgoing.id); assert.ok(closed.actualEnd);
  assert.ok(closed.assignments.every(assignment => assignment.leftAt));
  const sent = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  assert.equal(sent.issuedById, fixture.users.outgoing.id); assert.equal(sent.issuerSessionId, fixture.users.outgoing.sessionId);
  assert.ok(sent.issuedAt); assert.equal(sent.status, 'ENVIADA');
  assert.ok(sent.snapshot.items.some(item => item.refId === fixture.entryId));
  assert.ok(sent.snapshot.items.some(item => item.refId === fixture.taskId));
  const outgoingSignature = { issuedById: sent.issuedById, issuerSessionId: sent.issuerSessionId, issuedAt: sent.issuedAt };
  const signedCount = await db.cashCount.findUniqueOrThrow({ where: { handoverId_kind: { handoverId, kind: 'DECLARADO' } }, include: { lines: { orderBy: { id: 'asc' } } } });
  const signedClosure = await db.$queryRaw`SELECT * FROM "ShiftCashClosure" WHERE "shiftId" = ${fixture.shiftId}`;
  const outgoingAudits = await db.auditLog.findMany({ where: { userId: fixture.users.outgoing.id,
    OR: [{ entityId: fixture.shiftId }, { entityId: handoverId }] }, orderBy: { id: 'asc' } });
  assert.ok(outgoingAudits.some(audit => audit.action === 'TURNO_CERRAR' && audit.sessionId === fixture.users.outgoing.sessionId));
  assert.ok(outgoingAudits.some(audit => audit.action === 'TURNO_ENTREGAR' && audit.sessionId === fixture.users.outgoing.sessionId));

  const { page: incoming } = await actor(browser, fixture, 'incoming', width);
  await incoming.goto(`${origin}/turno`);
  await button(incoming, 'INICIAR RECEPCIÓN DE TURNO').click();
  await submit(incoming, 'SÍ, INICIAR RECEPCIÓN', evidence);
  await incoming.waitForURL(`**/turno/entrega/${handoverId}`);
  await submit(incoming, 'CONFIRMAR ENTREGA REVISADA', evidence);
  await fillCash(incoming, fixture, 'CONFIRMADO', 'PRUEBA SINTÉTICA · recuento receptor');
  await submit(incoming, 'Confirmar arqueo recibido', evidence);
  await verifyCash(fixture, handoverId, 'CONFIRMADO', 'PRUEBA SINTÉTICA · recuento receptor', 'incoming');
  // Count action revalidates the server page. Do not force a refresh to conceal
  // a stale guided step; the next real UI control must become available.
  const receiverForm = formFor(incoming, 'Confirmar elementos recibidos');
  await receiverForm.locator('select[name=elementPicker]').selectOption(elementId);
  await submit(incoming, 'Confirmar elementos recibidos', evidence);
  await submit(incoming, 'CONFIRMAR CAJA Y CUSTODIA', evidence);
  const incomingUrgent = incoming.locator('input[name=urgentAcknowledged]');
  if (await incomingUrgent.count()) await incomingUrgent.check();
  await submit(incoming, 'CONFIRMAR REVISIÓN FINAL', evidence);
  await incoming.locator('textarea[name=observations]').fill('PRUEBA SINTÉTICA · recibido conforme');
  await submit(incoming, 'CONFIRMAR RECEPCIÓN Y ABRIR MI TURNO', evidence);
  const received = await db.shiftHandover.findUniqueOrThrow({ where: { id: handoverId } });
  assert.equal(received.status, 'RECIBIDA'); assert.equal(received.receivedById, fixture.users.incoming.id);
  assert.equal(received.receiverSessionId, fixture.users.incoming.sessionId); assert.ok(received.receivedAt);
  assert.ok(received.receiverBriefingReviewedAt && received.receiverCustodyReviewedAt && received.receiverFinalReviewAt);
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: received.toShiftId } })).status, 'ACTIVO');
  assert.deepEqual(received.snapshot, sent.snapshot, 'Receiver must not rewrite signed outgoing snapshot');
  assert.deepEqual({ issuedById: received.issuedById, issuerSessionId: received.issuerSessionId, issuedAt: received.issuedAt }, outgoingSignature);
  assert.deepEqual(await db.cashCount.findUniqueOrThrow({ where: { id: signedCount.id }, include: { lines: { orderBy: { id: 'asc' } } } }), signedCount);
  assert.deepEqual(await db.$queryRaw`SELECT * FROM "ShiftCashClosure" WHERE "shiftId" = ${fixture.shiftId}`, signedClosure);
  assert.deepEqual(await db.auditLog.findMany({ where: { id: { in: outgoingAudits.map(audit => audit.id) } }, orderBy: { id: 'asc' } }), outgoingAudits);
  const receivingAudit = await db.auditLog.findMany({ where: { entity: 'ShiftHandover', entityId: handoverId, action: 'TURNO_RECIBIR' } });
  assert.ok(receivingAudit.some(audit => audit.userId === fixture.users.incoming.id && audit.sessionId === fixture.users.incoming.sessionId));
  const guarantee = await db.guarantee.findUniqueOrThrow({ where: { id: fixture.guaranteeId } });
  assert.equal(guarantee.state, 'VIGENTE'); assert.equal(guarantee.kind, 'EFECTIVO');
  assert.equal(Number(guarantee.amount), 10000); assert.equal(guarantee.currency, 'CLP');
  const element = await db.handoverElement.findUniqueOrThrow({ where: { id: elementId } });
  assert.equal(element.declared, true); assert.equal(element.confirmed, true); assert.equal(element.missingApprovedAt, null);
  for (const [actorKey, field] of [['outgoing', 'declared'], ['incoming', 'confirmed']]) {
    const audits = await db.auditLog.findMany({ where: { entity: 'ShiftHandover', entityId: handoverId, userId: fixture.users[actorKey].id } });
    assert.ok(audits.some(audit => audit.after?.field === field && audit.sessionId === fixture.users[actorKey].sessionId));
  }
  assert.equal((await db.operationalEntry.findUniqueOrThrow({ where: { id: fixture.entryId } })).status, 'ABIERTO');
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: fixture.taskId } })).status, 'PENDIENTE');
  const keys = await db.roomKey.findMany({ orderBy: { id: 'asc' } });
  assert.equal(keys.length, fixture.roomKeyCount);
  assert.equal(createHash('sha256').update(JSON.stringify(keys)).digest('hex'), fixture.keyInventoryDigest);
  assert.equal(await db.operationalMailOutbox.count({ where: { status: 'ENVIADO' } }), 0);
  return { outgoingClosed: true, incomingActive: true, pendingEntryAndTaskPreserved: true,
    declaredAndConfirmedCash: true, cashGuaranteeValidatedSeparately: true, custodyAuditedByBothSessions: true,
    signedSnapshotImmutable: true, completeRoomKeyInventoryUnchanged: true, roomKeyCount: keys.length, externalMailSent: false };
}

let browser;
try {
  // Next must know the public origin behind the local proxy. next start with
  // the private listening port would synthesize request.url as :3101/:3102
  // and legitimately fail the application's unchanged same-origin check.
  // Use Next's supported programmatic server options, not app/config edits.
  const serverBootstrap = `
    const http = require('node:http');
    const next = require(process.cwd() + '/node_modules/next');
    const app = next({ dev: false, dir: process.cwd(), hostname: 'localhost', port: 3000 });
    app.prepare().then(() => {
      const handle = app.getRequestHandler();
      http.createServer((request, response) => handle(request, response))
        .listen(Number(process.argv[1]), '127.0.0.1');
    }).catch(error => { console.error(error); process.exit(2); });
  `;
  for (const info of Object.values(backends)) {
    const log = createWriteStream(`${output}/${info.port}-server.log`, { mode: 0o600 });
    const child = spawn(process.execPath, ['--input-type=commonjs', '-e', serverBootstrap, String(info.port)],
      { cwd: info.tree, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log); child.stderr.pipe(log); children.push(child);
    await eventually(async () => {
      if (child.exitCode !== null) throw new Error('Next server exited before readiness');
      try { return (await fetch(`http://127.0.0.1:${info.port}/login`)).ok; } catch { return false; }
    }, 'Next server did not become ready', 60000);
  }
  await new Promise(resolvePromise => proxy.listen(3000, 'localhost', resolvePromise));
  report.sameOriginPreflight = [];
  for (const backend of Object.keys(backends)) {
    activeBackend = backend;
    const endpoint = `${origin}/api/operational-actions/cross-version-unknown-procedure`;
    const allowedOrigin = await fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    const refusedOrigin = await fetch(endpoint, { method: 'POST', headers: { Origin: 'http://synthetic-untrusted.invalid', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(allowedOrigin.status, 404, 'Public origin was not recognized by the unmodified API');
    assert.equal((await allowedOrigin.json()).error, 'Procedimiento no disponible.');
    assert.equal(refusedOrigin.status, 403, 'Same-origin protection must remain enforced');
    report.sameOriginPreflight.push({ backend, publicOriginAccepted: true, crossOriginRejected: true });
  }
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    for (const mode of ['cross-cash-custody', 'cross-note', 'candidate-control', 'cross-custom-custody', 'candidate-custom-custody-control']) {
      const row = { width, mode, status: 'RUNNING', actions: [], stage: 'fixture-and-baseline-preparation' }; results.push(row);
      const start = Date.now();
      try {
        activeBackend = mode.includes('control') ? 'candidate' : 'baseline';
        if (mode.includes('custom-custody')) {
          await customCustodyScenario(browser, width, mode, row);
          row.status = 'PASS';
          continue;
        }
        const fixture = await runFixture();
        const { context, page } = await actor(browser, fixture, 'outgoing', width);
        const state = await prepare(page, fixture, row.actions, row);
        row.nightEndsAtHotel08 = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' }).format(new Date(fixture.plannedEnd)) === '08:00';
        assert.equal(row.nightEndsAtHotel08, true);
        const notes = `PRUEBA SINTÉTICA · arqueo ${mode} ${width}`;
        const cashForm = await fillCash(page, fixture, 'DECLARADO', notes);
        if (mode === 'cross-cash-custody') {
          const custodyPage = await context.newPage(); custodyPage.setDefaultTimeout(15000);
          await custodyPage.goto(`${state.path}?paso=1`);
          const custodyForm = await declareElements(custodyPage, state.elementId);
          const cashDraft = await freeze(page, cashForm), custodyDraft = await freeze(custodyPage, custodyForm);
          assert.equal(await db.cashCount.count({ where: { handoverId: state.handoverId } }), 0);
          assert.equal((await db.handoverElement.findUniqueOrThrow({ where: { id: state.elementId } })).declared, false);
          activeBackend = 'candidate';
          row.stage = 'old-unsaved-cash-and-custody';
          await unchanged(page, cashForm, cashDraft); await unchanged(custodyPage, custodyForm, custodyDraft);
          row.unsavedInputsRetainedAtSwitch = true;
          const attempts = [];
          for (const [target, form, snapshot, name] of [[page, cashForm, cashDraft, 'Guardar arqueo declarado'], [custodyPage, custodyForm, custodyDraft, 'Guardar elementos de entrega']]) {
            try {
              await submit(target, name, row.actions, 'candidate');
              assert.equal(await target.evaluate(() => window.__crossDocument), snapshot.documentId, 'Successful action replaced document');
              target.__oldDocument = false;
              if (name === 'Guardar arqueo declarado') await verifyCash(fixture, state.handoverId, 'DECLARADO', notes, 'outgoing');
              else assert.equal((await db.handoverElement.findUniqueOrThrow({ where: { id: state.elementId } })).declared, true);
              attempts.push({ form: name, compatible: true });
            } catch (error) {
              let inputRetained = false; try { await unchanged(target, form, snapshot); inputRetained = true; } catch {}
              attempts.push({ form: name, compatible: false, inputRetainedAfterFailure: inputRetained, failure: error.message });
            }
          }
          row.oldFormSubmissions = attempts;
          assert.ok(attempts.every(attempt => attempt.compatible), 'Old browser forms are incompatible with replacement backend');
        } else {
          await submit(page, 'Guardar arqueo declarado', row.actions);
          await verifyCash(fixture, state.handoverId, 'DECLARADO', notes, 'outgoing');
          await declareElements(page, state.elementId);
          await submit(page, 'Guardar elementos de entrega', row.actions);
        }
        row.stage = 'formal-cash-closure';
        await closeCash(page, fixture, state.path, row.actions);
        await page.goto(`${state.path}?paso=2`);
        const noteName = 'Guardar nota para el turno siguiente', noteForm = formFor(page, noteName);
        const observation = `PRUEBA SINTÉTICA · borrador sin guardar ${mode} ${width}`;
        await noteForm.locator('textarea[name=observation]').fill(observation);
        await noteForm.locator('textarea[name=nextAction]').fill('Revisar pendiente nocturno sin copiar ni duplicar');
        if (mode === 'cross-note') {
          const draft = await freeze(page, noteForm);
          const reloadProbe = await context.newPage(); await reloadProbe.goto(`${state.path}?paso=2`);
          await formFor(reloadProbe, noteName).locator('textarea[name=observation]').fill('PRUEBA SINTÉTICA · solamente memoria del documento');
          activeBackend = 'candidate';
          row.stage = 'old-unsaved-note';
          await unchanged(page, noteForm, draft); row.unsavedInputsRetainedAtSwitch = true;
          // Separate destructive negative probe. It is NEVER a recovery of the
          // measured old tab and its outcome cannot turn compatibility green.
          await reloadProbe.reload();
          row.hardReloadDraftRetained = await formFor(reloadProbe, noteName).locator('textarea[name=observation]').inputValue() === 'PRUEBA SINTÉTICA · solamente memoria del documento';
          await reloadProbe.close();
          try { await submit(page, noteName, row.actions, 'candidate'); }
          catch (error) {
            let retained = false; try { await unchanged(page, noteForm, draft); retained = true; } catch {}
            row.inputRetainedAfterFailure = retained; throw error;
          }
          assert.equal(await page.evaluate(() => window.__crossDocument), draft.documentId, 'Old note required a hard reload');
          page.__oldDocument = false;
        } else await submit(page, noteName, row.actions);
        const manual = await db.handoverItem.findMany({ where: { handoverId: state.handoverId, manual: true } });
        assert.equal(manual.length, 1); assert.equal(manual[0].title, `Observación: ${observation}`);
        assert.equal(manual[0].detail, 'Siguiente acción: Revisar pendiente nocturno sin copiar ni duplicar');
        row.stage = 'native-close-and-receive';
        row.cycle = await finishCycle(browser, page, fixture, state, width, row.actions);
        row.status = 'PASS';
      } catch (error) {
        row.status = mode.includes('control') ? 'CONTROL_FAILED' : 'NO_GO_OR_HARNESS_FAILURE'; row.failure = error.message;
        row.syntheticUiDiagnostics = [];
        for (const context of contexts) for (const page of context.pages()) {
          try {
            row.syntheticUiDiagnostics.push({ path: new URL(page.url()).pathname,
              visibleText: (await page.locator('body').innerText({ timeout: 1000 })).slice(-4000) });
          } catch { /* Preserve the actual failure if a document is unavailable. */ }
        }
      }
      finally {
        row.elapsedMs = Date.now() - start;
        await Promise.all(contexts.splice(0).map(context => context.close().catch(() => {})));
        writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
      }
    }
  }
  for (const row of results.filter(row => !row.mode.includes('control') && row.status !== 'PASS')) {
    const controlMode = row.mode.includes('custom-custody') ? 'candidate-custom-custody-control' : 'candidate-control';
    const controlPassed = results.some(control => control.width === row.width && control.mode === controlMode && control.status === 'PASS');
    if (row.mode.includes('custom-custody')) {
      const customRejected = row.actions.some(action => action.transport === 'custom-json' && action.clientDocument === 'baseline' &&
        action.backend === 'candidate' && !action.expectedRejection && action.status >= 400);
      row.classification = controlPassed && customRejected ? 'CONFIRMED_OLD_CUSTOM_API_REJECTION_NO_GO' : 'CUSTOM_API_FAILURE_REQUIRES_DIAGNOSIS';
      continue;
    }
    const staleRejected = row.actions.some(action => action.backend === 'candidate' && action.actionFromBaselineManifest &&
      !action.actionPresentInCandidateManifest && action.status >= 400);
    row.classification = controlPassed && staleRejected ? 'CONFIRMED_STALE_ACTION_NO_GO' : 'FAILURE_REQUIRES_DIAGNOSIS_NO_GO_UNTIL_RESOLVED';
  }
  report.runtimeNetworkClean = !report.externalBrowserRequestBlocked && !report.webSocketBlocked &&
    (!existsSync(`${output}/network-violations.log`) || readFileSync(`${output}/network-violations.log`, 'utf8').trim() === '');
  report.nativePreparationNavigation = results.filter(row => row.preparation).every(row => row.preparation.automaticNavigation)
    ? 'PASS' : 'FAILED_RECORDED_SEPARATELY_FROM_FORM_CONTRACTS';
  report.localCompatibility = results.every(row => row.status === 'PASS') && report.runtimeNetworkClean &&
    report.nativePreparationNavigation === 'PASS' ? 'PASS' : 'NO_GO_OR_INCONCLUSIVE';
  report.customApiCompatibility = results.filter(row => row.mode.includes('custom-custody')).every(row => row.status === 'PASS') &&
    report.runtimeNetworkClean ? 'PASS' : 'NO_GO_OR_INCONCLUSIVE';
  // Even an entirely green local run cannot verify Vercel routing or durability.
  report.productionDecision = 'UNVERIFIED_PLATFORM_AND_RELOAD_LIMITS';
  process.exitCode = report.localCompatibility === 'PASS' ? 0 : 1;
} catch (error) { report.harnessFailure = error.message; process.exitCode = 2; }
finally {
  writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2));
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await browser?.close(); await db.$disconnect();
  proxy.closeAllConnections(); await new Promise(resolvePromise => proxy.close(resolvePromise));
  for (const child of children) child.kill('SIGTERM');
  // Private fixture and server logs deliberately are not emitted or uploaded.
  console.log(JSON.stringify(report, null, 2));
}
