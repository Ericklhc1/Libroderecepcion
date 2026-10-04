import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient(), browser = await chromium.launch({ headless: true }), results = [];
const base = 'http://localhost:3000';

async function session(token, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...options });
  await context.addCookies([{ name: 'lor_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  return { context, page };
}

// Isolated role and identity on the guarded disposable database only.
async function readerFixture(width) {
  const role = await db.role.create({ data: {
    key: `QA_CUSTODY_${width}_${randomUUID().slice(0, 8)}`, name: 'QA lectura de custodia',
    permissions: { create: { permission: { connect: { key: 'custody.view' } } } },
  } });
  const admin = await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id } });
  const reader = await db.user.create({ data: {
    username: `qa_custody_${randomUUID().slice(0, 12)}`, name: 'QA lector de custodia', passwordHash: 'synthetic-no-login',
    roleId: role.id, departmentId: fixture.areaId, mustChangePassword: false, tutorialDoneAt: new Date(), tutorialKnownModules: admin.tutorialKnownModules,
  } });
  const accepted = await db.legalAcceptance.findMany({ where: { userId: admin.id }, select: { document: true, version: true } });
  for (const terms of accepted) await db.legalAcceptance.create({ data: { ...terms, userId: reader.id } });
  const expiresAt = new Date(Date.now() + 3600000);
  const login = await db.session.create({ data: { userId: reader.id, expiresAt } });
  const token = await new SignJWT({ sub: reader.id, sid: login.id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  return { role, reader, token };
}

function filteredHref(marker, status, humanId) {
  return '/custodia?' + new URLSearchParams({ estado: status, q: marker, pagina: '1', ...(humanId ? { objeto: String(humanId) } : {}) });
}
function checkFilters(page, marker, status) {
  const url = new URL(page.url());
  assert.equal(url.pathname, '/custodia');
  assert.equal(url.searchParams.get('q'), marker);
  assert.equal(url.searchParams.get('estado'), status);
  assert.equal(url.searchParams.get('pagina'), '1');
  assert.equal(url.searchParams.has('objeto'), false, 'Native success returns to the filtered list');
}
async function submit(page, button) {
  const [navigation] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), button.click()]);
  assert.ok(navigation, 'A saved custody action must reload the document, not only navigate its fragment');
  assert.equal(navigation.request().resourceType(), 'document');
  assert.equal(navigation.ok(), true);
}
async function nativeChange(context, fields) {
  const response = await context.request.post(base + '/api/operational-actions/custody-change', { headers: { Origin: base }, data: fields });
  return { status: response.status(), body: await response.json() };
}

try {
  for (const width of [1280, 390]) {
    const marker = `CUSTODY_CONTEXT_${width}_${randomUUID().slice(0, 6)}`;
    const admin = await session(fixture.users.admin.token, width);
    const page = admin.page;
    const list = filteredHref(marker, 'EN_CUSTODIA');
    await page.goto(base + list);
    await page.getByRole('button', { name: 'Registrar objeto', exact: true }).click();
    let inner = page.getByRole('dialog', { name: 'Registrar objeto encontrado', exact: true });
    await inner.locator('input[name=item]').fill(marker);
    await inner.locator('input[name=foundLocation]').fill('Hallazgo sintético del recorrido');
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - 60000)).replace(' ', 'T');
    await inner.locator('input[name=foundAt]').fill(local);
    await inner.locator('input[name=custodyLocation]').fill('Gabinete sintético original');
    await submit(page, inner.getByRole('button', { name: 'Guardar en custodia', exact: true }));
    checkFilters(page, marker, 'EN_CUSTODIA');
    let record = await db.lostFoundItem.findFirstOrThrow({ where: { item: marker } });
    const rowId = `registro-custody-${record.id}`;
    const row = page.locator(`[data-list-item="${rowId}"][aria-haspopup="dialog"]`);
    const panel = page.locator(`[data-custody-detail="${record.id}"]`);
    await row.waitFor();
    assert.equal(await page.locator('[data-worklist-panel]').count(), 0);
    await row.click();
    await panel.waitFor();
    assert.equal(new URL(page.url()).hash, '#' + rowId);
    await panel.getByText('Hallazgo sintético del recorrido', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Registrar entrega', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Registrar entrega', exact: true });
    await inner.locator('textarea[name=note]').fill('Borrador cancelado');
    await page.keyboard.press('Escape');
    await inner.waitFor({ state: 'hidden' });
    await panel.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1, 'Escape preserves the outer record context');
    assert.equal(await db.lostFoundEvent.count({ where: { itemId: record.id } }), 1);
    await page.goBack();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).hash, '');
    await page.goForward();
    await panel.waitFor();
    await page.getByRole('button', { name: 'Cancelar y volver a la lista', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    await page.waitForFunction(id => document.activeElement?.id === id, rowId);
    assert.equal(new URL(page.url()).hash, '');
    assert.equal((await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } })).version, record.version);

    // The same native revision check must reject a stale nested form.
    await row.click();
    await panel.getByRole('button', { name: 'Mover / cambiar responsable', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Mover / cambiar responsable', exact: true });
    await inner.locator('input[name=custodyLocation]').fill('Cambio obsoleto que no debe guardarse');
    await inner.locator('textarea[name=note]').fill('Formulario anterior');
    const moved = await nativeChange(admin.context, { id: record.id, version: String(record.version), action: 'MOVER', custodyLocation: 'Gabinete actualizado', note: 'Cambio concurrente nativo' });
    assert.equal(moved.status, 200); assert.equal(moved.body.ok, true);
    await inner.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
    await inner.getByText('El registro cambió. Actualiza antes de continuar.', { exact: true }).waitFor();
    record = await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(record.custodyLocation, 'Gabinete actualizado');
    assert.equal(record.version, 2);
    assert.equal(await db.lostFoundEvent.count({ where: { itemId: record.id } }), 2);
    await page.keyboard.press('Escape');
    await page.goto(base + list);
    await row.click();
    await panel.getByRole('button', { name: 'Mover / cambiar responsable', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Mover / cambiar responsable', exact: true });
    await inner.locator('input[name=custodyLocation]').fill('Gabinete confirmado desde formulario');
    await inner.locator('textarea[name=note]').fill('Movimiento nativo posterior al rechazo obsoleto');
    await submit(page, inner.getByRole('button', { name: 'Guardar cambio', exact: true }));
    checkFilters(page, marker, 'EN_CUSTODIA');
    record = await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(record.custodyLocation, 'Gabinete confirmado desde formulario');
    assert.equal(record.version, 3);
    assert.equal(await db.lostFoundEvent.count({ where: { itemId: record.id } }), 3);
    await row.getByText('Gabinete confirmado desde formulario', { exact: false }).waitFor();
    assert.equal(await page.locator('[data-worklist-panel]').count(), 0, 'A saved change returns to the list even when the row remains visible');
    await row.click();
    await panel.getByText('Gabinete confirmado desde formulario', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Registrar entrega', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Registrar entrega', exact: true });
    await inner.locator('textarea[name=note]').fill('Entrega registrada en prueba');
    await inner.getByRole('button', { name: 'Cerrar custodia', exact: true }).click();
    assert.equal(await inner.locator('textarea[name=evidenceNote]').evaluate(input => input.validity.valueMissing), true);
    assert.equal(await db.lostFoundEvent.count({ where: { itemId: record.id } }), 3, 'Evidence cannot be inferred from opening a form');
    await inner.locator('textarea[name=evidenceNote]').fill('Acta de entrega sintética');
    await submit(page, inner.getByRole('button', { name: 'Cerrar custodia', exact: true }));
    checkFilters(page, marker, 'EN_CUSTODIA');
    record = await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(record.status, 'ENTREGADO');
    assert.equal(record.closedById, fixture.users.admin.id);
    assert.equal(record.evidenceNote, 'Acta de entrega sintética');
    await page.getByText('No hay objetos con estos filtros.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-worklist-panel]').count(), 0);
    assert.equal(await row.count(), 0, 'The delivered object is no longer in the EN_CUSTODIA list');

    await page.goto(base + filteredHref(marker, 'ENTREGADO', record.humanId));
    await panel.waitFor();
    await panel.getByText('Acta de entrega sintética', { exact: false }).waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Registrar entrega', exact: true }).count(), 0);
    await panel.getByRole('button', { name: 'Reabrir custodia', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Reabrir custodia', exact: true });
    await inner.locator('textarea[name=note]').fill('Reapertura explícita del recorrido');
    await submit(page, inner.getByRole('button', { name: 'Guardar cambio', exact: true }));
    checkFilters(page, marker, 'ENTREGADO');
    await page.getByText('No hay objetos con estos filtros.', { exact: true }).waitFor();
    record = await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(record.status, 'EN_CUSTODIA');
    assert.equal(record.evidenceNote, null);
    const reopenAudit = await db.auditLog.findFirstOrThrow({ where: { entity: 'LostFoundItem', entityId: record.id, action: 'REABRIR' } });
    assert.equal(reopenAudit.before.evidenceNote, 'Acta de entrega sintética');

    await page.goto(base + filteredHref(marker, 'EN_CUSTODIA', record.humanId));
    await panel.waitFor();
    await panel.getByText('Historial y responsables', { exact: true }).click();
    await panel.getByText(/ENTREGAR/).waitFor();
    await panel.getByRole('button', { name: 'Registrar disposición final', exact: true }).click();
    inner = page.getByRole('dialog', { name: 'Registrar disposición final', exact: true });
    await inner.locator('textarea[name=note]').fill('Disposición final sintética');
    await inner.locator('textarea[name=evidenceNote]').fill('Acta de disposición sintética');
    await submit(page, inner.getByRole('button', { name: 'Cerrar custodia', exact: true }));
    checkFilters(page, marker, 'EN_CUSTODIA');
    await page.getByText('No hay objetos con estos filtros.', { exact: true }).waitFor();
    record = await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(record.status, 'DISPUESTO');
    assert.equal(record.version, 6);
    const events = await db.lostFoundEvent.findMany({ where: { itemId: record.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(events.map(event => event.action), ['REGISTRAR', 'MOVER', 'MOVER', 'ENTREGAR', 'REABRIR', 'DISPONER']);
    assert.ok(events.every(event => event.actorId === fixture.users.admin.id));

    // Existing hash links still reach the correct original folio.
    const closedList = filteredHref(marker, 'DISPUESTO');
    await page.goto(base + closedList + '#objeto-' + record.humanId);
    await page.locator('#objeto-' + record.humanId).waitFor();
    await row.click();
    await panel.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const deepLink = await page.locator('[data-worklist-panel]').getByRole('link', { name: 'Abrir enlace del objeto', exact: true }).getAttribute('href');
    assert.equal(new URL(deepLink, base).searchParams.get('objeto'), String(record.humanId));

    const isolated = await readerFixture(width);
    const readOnly = await session(isolated.token, width);
    await readOnly.page.goto(base + deepLink);
    const readPanel = readOnly.page.locator(`[data-custody-detail="${record.id}"]`);
    await readPanel.waitFor();
    assert.equal(await readOnly.page.getByRole('button', { name: 'Registrar objeto', exact: true }).count(), 0);
    assert.equal(await readPanel.locator('button').count(), 0);
    await readPanel.getByText('Acta de disposición sintética', { exact: false }).waitFor();
    const denied = await nativeChange(readOnly.context, { id: record.id, version: String(record.version), action: 'REABRIR', note: 'Debe rechazarse por permiso' });
    assert.equal(denied.status, 400); assert.equal(denied.body.ok, false);
    assert.equal((await db.lostFoundItem.findUniqueOrThrow({ where: { id: record.id } })).version, record.version);
    await db.rolePermission.create({ data: { role: { connect: { id: isolated.role.id } }, permission: { connect: { key: 'custody.manage' } } } });
    await readOnly.page.reload();
    await readPanel.getByRole('button', { name: 'Reabrir custodia', exact: true }).waitFor();
    await readOnly.page.getByRole('button', { name: 'Registrar objeto', exact: true }).waitFor();
    assert.equal(await db.lostFoundEvent.count({ where: { itemId: record.id } }), 6, 'Granting permission and viewing do not register a handover');

    const noJs = await session(fixture.users.admin.token, width, { javaScriptEnabled: false });
    await noJs.page.goto(base + deepLink);
    const fallback = noJs.page.locator('[data-worklist-fallback][open]');
    await fallback.getByText('Hallazgo sintético del recorrido', { exact: true }).waitFor();
    await fallback.getByText('Acta de disposición sintética', { exact: false }).waitFor();
    await fallback.getByText('Historial y responsables', { exact: true }).click();
    await fallback.getByText(/ENTREGAR/).waitFor();
    await page.goto(base + closedList + '&objeto=999999999');
    await row.waitFor();
    assert.equal(await page.locator('[data-worklist-panel]').count(), 0, 'An unreturned folio cannot open a record');
    results.push({ width, compactList: true, originalFolio: true, nestedEscape: true, backForward: true, focusRestored: true, staleVersionRejected: true, nativeMoveReloaded: true, evidenceRequired: true, filtersAfterNativeActions: true, deliveryReopenDisposition: true, actorAndHistoryPreserved: true, readOnlyAndRoleGrant: true, nativeNoJavaScriptRead: true, physicalSafari: false });
    await admin.context.close(); await readOnly.context.close(); await noJs.context.close();
  }
} finally {
  writeFileSync('custody-worklist-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close(); await db.$disconnect();
}
