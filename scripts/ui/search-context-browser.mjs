import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

// Only the existing disposable PostgreSQL/loopback fixture may run this script.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
});
const base = 'http://localhost:3000';
const marker = `SEARCH_CONTEXT_${Date.now()}`;
const entryQuery = `${marker} ENTRY habitación &`;
const taskQuery = `${marker} TASK`;
const results = [];
const errors = [];
const mutations = [];
const listHref = q => '/buscar?' + new URLSearchParams({ q });

async function session(width, key = 'admin', options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...options });
  await context.addCookies([{ name: 'lor_session', value: fixture.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
  });
  context.on('page', page => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/operational-actions/')) mutations.push(request.url());
    });
  });
  return context;
}

async function returned(page, list, anchor, scrollY) {
  const selected = page.locator(`[data-list-item="${anchor}"]`);
  await selected.waitFor();
  await page.waitForFunction(({ anchor, scrollY, scope }) =>
    sessionStorage.getItem(`aroh:list-return:${scope}`) === null &&
    document.activeElement?.id === anchor &&
    document.getElementById(anchor)?.getAttribute('aria-current') === 'true' &&
    Math.abs(window.scrollY - scrollY) <= 2,
  { anchor, scrollY, scope: fixture.users.admin.id });
  const url = new URL(page.url());
  assert.equal(url.pathname + url.search, list);
  assert.equal(url.hash, '#' + anchor);
}

async function journey(page, q, detailRoot) {
  const list = listHref(q);
  await page.goto(base + '/buscar');
  await page.locator('input[name=q]').fill(q);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.waitForURL(base + list);
  await page.getByRole('heading', { name: 'Búsqueda global', exact: true }).waitFor();
  const rows = page.locator('[data-list-item]');
  assert.equal(await rows.count(), 24, 'Only the real matching fixture rows are projected');
  const row = rows.nth(10);
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  const anchor = await row.getAttribute('id');
  const href = new URL(await row.getAttribute('href'), base);
  assert.ok(href.pathname.startsWith(detailRoot));
  assert.equal(href.searchParams.get('desdeLista'), `${list}#${anchor}`);
  if (detailRoot === '/tareas/') await row.press('Enter');
  else await row.click();
  const back = page.locator('[data-list-return]');
  await back.waitFor();
  assert.equal(await back.innerText(), 'Volver a resultados');
  assert.equal(await back.getAttribute('href'), `${list}#${anchor}`);
  const saved = await page.evaluate(({ scope, list }) => JSON.parse(sessionStorage.getItem(`aroh:list-position:${scope}:${list}`)), { scope: fixture.users.admin.id, list });
  assert.deepEqual(Object.keys(saved).sort(), ['rowAnchor', 'scrollY'], 'Position storage contains no copied operational record');
  assert.equal(saved.rowAnchor, anchor);
  assert.ok(saved.scrollY > 0);

  const detailBeforeCancel = page.url();
  const actions = page.locator('[aria-label="Acciones del asunto"]');
  await actions.getByText('Más ···', { exact: true }).click();
  await actions.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=title]').fill('SEARCH_UNSAVED_NEVER_PERSISTED');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(page.url(), detailBeforeCancel);
  assert.equal(await back.getAttribute('href'), `${list}#${anchor}`);
  await page.reload();
  await back.click();
  await returned(page, list, anchor, saved.scrollY);
  assert.equal(await page.locator('input[name=q]').inputValue(), q);

  await page.goBack();
  await back.waitFor();
  assert.equal(new URL(page.url()).pathname, href.pathname);
  await page.goForward();
  await row.waitFor();
  assert.equal(new URL(page.url()).hash, '#' + anchor);
  await page.goBack();
  await back.waitFor();
  await page.goBack();
  await row.waitFor();
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-current') === 'true', anchor);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - saved.scrollY) <= 2, 'Back keeps native scroll');

  // A second result supersedes the older selected row without replacing history.
  await row.click();
  await back.click();
  await returned(page, list, anchor, saved.scrollY);
  const next = rows.nth(11);
  const nextAnchor = await next.getAttribute('id');
  await next.click();
  await back.waitFor();
  await page.goBack();
  await next.waitFor();
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-current') === 'true', nextAnchor);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Search fits desktop and mobile');
  return { queryPreserved: true, nativeDetail: detailRoot, selectedRow: true, scroll: true, cancel: true, reload: true, keyboard: true, nativeHistory: true };
}

try {
  // Synthetic fixture preparation is the only data write in this read-only UI journey.
  await db.operationalEntry.createMany({ data: Array.from({ length: 24 }, (_, index) => ({
    type: 'NOVEDAD', title: `${entryQuery} ${index}`, description: 'Synthetic authorized search continuity',
    createdById: fixture.users.admin.id, ownerId: fixture.users.admin.id, departmentId: fixture.areaId,
    occurredAt: new Date(Date.now() - index * 1000),
  })) });
  await db.task.createMany({ data: Array.from({ length: 24 }, (_, index) => ({
    title: `${taskQuery} ${index}`, description: 'Synthetic authorized task continuity',
    createdById: fixture.users.admin.id, assigneeId: fixture.users.admin.id, departmentId: fixture.areaId,
    createdAt: new Date(Date.now() - index * 1000),
  })) });
  const privateTitle = `${marker} PRIVATE_VISIBILITY_EXCLUDED`;
  const privateFollowUp = await db.followUp.create({ data: { action: privateTitle, visibility: 'PRIVADO', createdById: fixture.users.worker.id, ownerId: fixture.users.worker.id } });
  const privateTask = await db.task.create({ data: { title: privateTitle, followUpId: privateFollowUp.id, createdById: fixture.users.worker.id } });
  const hkVisibleTitle = `${marker} HK_OWN_VISIBLE`;
  await db.housekeepingRequest.create({ data: { requestKey: `${marker}-own`, workflowVersion: 1, title: hkVisibleTitle, description: 'Synthetic own work', createdById: fixture.users.maid.id, assignedToId: fixture.users.maid.id, departmentId: fixture.areaId } });
  const hkHiddenTitle = `${marker} HK_OTHER_EXCLUDED`;
  await db.housekeepingRequest.create({ data: { requestKey: `${marker}-other`, workflowVersion: 1, title: hkHiddenTitle, description: 'Synthetic other work', createdById: fixture.users.admin.id, assignedToId: fixture.users.admin.id, departmentId: fixture.areaId } });
  const hkDemoTitle = `${marker} HK_DEMO_EXCLUDED`;
  await db.housekeepingRequest.create({ data: { requestKey: `${marker}-demo`, isDemo: true, title: hkDemoTitle, createdById: fixture.users.admin.id } });

  const entriesBefore = await db.operationalEntry.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } });
  const tasksBefore = await db.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } });
  const hkBefore = await db.housekeepingRequest.findMany({ where: { requestKey: { startsWith: marker } }, orderBy: { id: 'asc' } });

  for (const width of [1280, 390]) {
    const admin = await session(width);
    try {
      const page = await admin.newPage();
      results.push({ width, ...await journey(page, entryQuery, '/libro/') });
      results.push({ width, ...await journey(page, taskQuery, '/tareas/') });
      await page.goto(base + listHref(`${marker} PRIVATE`));
      await page.getByText(/No encontré registros/).waitFor();
      assert.equal(await page.locator('[data-list-item]').count(), 0);
      assert.ok(!(await page.content()).includes(privateTitle), 'Private source and linked task never enter HTML for another user');
      await page.goto(`${base}/tareas/${privateTask.id}?desdeLista=${encodeURIComponent(listHref(`${marker} PRIVATE`))}`);
      assert.ok(!(await page.content()).includes(privateTitle), 'Forged search context does not grant native detail access');
      await page.goto(base + listHref(`${marker} NO_MATCH`));
      await page.getByText(/No encontré registros/).waitFor();
      assert.equal(await page.locator('[data-list-item]').count(), 0);
      await page.goto(base + '/buscar');
      await page.getByText('Escribe un número o una referencia operativa.', { exact: true }).waitFor();
      results.push({ width, otherPrivateSourceHidden: true, reservedTaskHidden: true, forgedContextRejected: true, emptyAndNoMatch: true });
    } finally { await admin.close(); }

    const author = await session(width, 'worker');
    try {
      const page = await author.newPage();
      await page.goto(base + listHref(`${marker} PRIVATE`));
      const visibleTask = page.locator(`[data-list-item="registro-search-Task-${privateTask.id}"]`);
      await visibleTask.waitFor();
      assert.equal(await page.locator('[data-list-item]').count(), 2, 'Private author retains authorized FollowUp and Task');
      const follow = page.locator(`[data-list-item="registro-search-FollowUp-${privateFollowUp.id}"]`);
      const href = new URL(await follow.getAttribute('href'), base);
      assert.equal(href.pathname, '/seguimientos');
      assert.equal(href.searchParams.get('q'), `#${privateFollowUp.humanId}`);
      assert.equal(href.searchParams.has('desdeLista'), false, 'Unsupported destination retains its native link');
      results.push({ width, privateAuthorCanRead: true, unsupportedDestinationNative: true });
    } finally { await author.close(); }

    const maid = await session(width, 'maid');
    try {
      const page = await maid.newPage();
      await page.goto(base + listHref(marker));
      await page.getByText(hkVisibleTitle, { exact: true }).waitFor();
      assert.equal(await page.locator('[data-list-item]').count(), 1, 'Area-only account receives only its authorized Housekeeping result');
      const html = await page.content();
      for (const hidden of [entryQuery, taskQuery, privateTitle, hkHiddenTitle, hkDemoTitle]) assert.ok(!html.includes(hidden), 'Search retains native permission and privacy filtering');
      const href = new URL(await page.locator('[data-list-item]').getAttribute('href'), base);
      assert.equal(href.pathname, '/admin/housekeeping');
      assert.equal(href.searchParams.has('desdeLista'), false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      results.push({ width, areaOnlyScopePreserved: true, otherWorkAndDemoHidden: true });
    } finally { await maid.close(); }
  }

  for (const mode of ['no-storage', 'no-javascript']) {
    const context = await session(390, 'admin', mode === 'no-javascript' ? { javaScriptEnabled: false } : {});
    try {
      if (mode === 'no-storage') await context.addInitScript(() => {
        for (const name of ['getItem', 'setItem', 'removeItem']) {
          const original = Storage.prototype[name];
          Storage.prototype[name] = function (key, ...args) {
            if (key.startsWith('aroh:list-')) throw new Error('Synthetic storage unavailable');
            return original.call(this, key, ...args);
          };
        }
      });
      const page = await context.newPage();
      const list = listHref(taskQuery);
      await page.goto(base + list);
      const row = page.locator('[data-list-item]').nth(10);
      const anchor = await row.getAttribute('id');
      await row.click();
      await page.locator('[data-list-return]').click();
      await page.locator(`[data-list-item="${anchor}"]`).waitFor();
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
      assert.equal(new URL(page.url()).hash, '#' + anchor);
      if (mode === 'no-storage') await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-current') === 'true', anchor);
      results.push({ mode, nativeSearchAndAnchorReturn: true });
    } finally { await context.close(); }
  }

  assert.deepEqual(await db.operationalEntry.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } }), entriesBefore);
  assert.deepEqual(await db.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } }), tasksBefore);
  assert.deepEqual(await db.housekeepingRequest.findMany({ where: { requestKey: { startsWith: marker } }, orderBy: { id: 'asc' } }), hkBefore);
  assert.deepEqual(errors, []);
  assert.deepEqual(mutations, [], 'Reading, returning and cancelling never submit an operational action');
  console.log('Search/native detail continuity and scoped privacy passed.', JSON.stringify(results));
} finally {
  writeFileSync('/tmp/search-context-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close();
  await db.$disconnect();
}
