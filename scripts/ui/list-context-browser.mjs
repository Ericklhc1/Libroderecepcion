import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const base = 'http://localhost:3000';
const marker = `LIST_CONTEXT_${Date.now()}`;
const results = [];

async function openContext(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...options });
  await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path))
      ? route.abort() : route.continue();
  });
  return context;
}

async function checkJourney(page, list, expectedDetailRoot) {
  await page.goto(base + list);
  const rows = page.locator('[data-list-item]');
  assert.ok(await rows.count() >= 10, 'Synthetic list has enough rows to exercise real scroll');
  const row = rows.nth(9);
  await row.scrollIntoViewIfNeeded();
  const anchor = await row.getAttribute('id');
  const detailHref = await row.getAttribute('href');
  const detail = new URL(detailHref, base);
  assert.ok(detail.pathname.startsWith(expectedDetailRoot));
  assert.equal(detail.searchParams.get('desdeLista'), list + '#' + anchor);
  if (new URL(list, base).pathname === '/tareas') {
    await row.focus();
    await row.press('Enter');
  } else {
    await row.click();
  }
  await page.locator('[data-list-return]').waitFor();
  const captured = await page.evaluate(({ scope, href }) => JSON.parse(sessionStorage.getItem(`aroh:list-position:${scope}:${href}`)), { scope: fixture.users.admin.id, href: list });
  assert.ok(captured.scrollY > 0, 'Capture actual scroll at activation');
  assert.equal(captured.rowAnchor, anchor);
  assert.equal(await page.locator('[data-list-return]').getAttribute('href'), list + '#' + anchor);

  const detailBeforeCancel = page.url();
  const actions = page.locator('[aria-label="Acciones del asunto"]');
  await actions.getByText('Más ···', { exact: true }).click();
  await actions.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=title]').fill('Synthetic unsaved edit');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(page.url(), detailBeforeCancel, 'Cancelling a native dialog preserves the exact detail URL');
  assert.equal(await page.locator('[data-list-return]').getAttribute('href'), list + '#' + anchor);

  // Reloading or sharing a detail never drops its native return query.
  await page.reload();
  await page.locator('[data-list-return]').click();
  const selected = page.locator(`[data-list-item="${anchor}"]`);
  await selected.waitFor();
  await page.waitForFunction(scope => sessionStorage.getItem(`aroh:list-return:${scope}`) === null, fixture.users.admin.id);
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
  assert.equal(await selected.getAttribute('aria-current'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement?.id), anchor);
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - captured.scrollY) <= 2, 'Explicit return restores exact scroll');

  // Real history: list -> detail -> return list; Back and Forward still traverse
  // those same pages. No replaceState, synthetic routes or router.back shortcut.
  await page.goBack();
  await page.locator('[data-list-return]').waitFor();
  assert.equal(new URL(page.url()).pathname, detail.pathname);
  await page.goForward();
  await selected.waitFor();
  assert.equal(new URL(page.url()).hash, '#' + anchor);
  await page.goBack();
  await page.locator('[data-list-return]').waitFor();
  await page.goBack();
  await selected.waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await selected.getAttribute('aria-current'), 'true');
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - captured.scrollY) <= 2, 'Browser Back keeps native scroll');
  await page.goForward();
  await page.locator('[data-list-return]').waitFor();
  await page.locator('[data-list-return]').click();
  await selected.waitFor();
  await page.waitForFunction(scope => sessionStorage.getItem(`aroh:list-return:${scope}`) === null, fixture.users.admin.id);
  const nextRow = page.locator('[data-list-item]').nth(10);
  const nextAnchor = await nextRow.getAttribute('id');
  await nextRow.click();
  await page.locator('[data-list-return]').waitFor();
  await page.goBack();
  await page.locator(`[data-list-item="${nextAnchor}"]`).waitFor();
  assert.equal(await page.locator(`[data-list-item="${nextAnchor}"]`).getAttribute('aria-current'), 'true', 'Back selects the most recent row even when the list URL has an older fragment');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
  return { listRoot: new URL(list, base).pathname, detailRoot: expectedDetailRoot, filters: true, selection: true, scroll: true, cancel: true, reload: true, nativeHistory: true };
}

try {
  const role = await db.role.findUniqueOrThrow({ where: { key: 'RECEPCIONISTA' } });
  const author = await db.user.create({ data: { name: marker, username: marker.toLowerCase(), passwordHash: 'synthetic-no-login', roleId: role.id, departmentId: fixture.areaId } });
  await db.operationalEntry.createMany({ data: Array.from({ length: 85 }, (_, index) => ({
    type: 'INCIDENCIA', title: `${marker} ${index}`, description: 'Synthetic list continuity only',
    createdById: author.id, ownerId: fixture.users.admin.id, departmentId: fixture.areaId,
    priority: 'ALTA', occurredAt: new Date(Date.now() - index * 1000),
  })) });
  await db.task.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
    title: `${marker} task ${index}`, description: 'Synthetic list continuity only',
    createdById: fixture.users.admin.id, assigneeId: fixture.users.admin.id, departmentId: fixture.areaId,
    priority: 'ALTA',
  })) });

  const entryList = `/libro?${new URLSearchParams({ q: marker, clase: 'entry', tipo: 'INCIDENCIA', estado: 'abiertos', prioridad: 'ALTA', area: fixture.areaId, responsable: fixture.users.admin.id, pagina: '2' })}`;
  const taskBookList = `/libro?${new URLSearchParams({ q: marker, clase: 'task', prioridad: 'ALTA', pagina: '2' })}`;
  const taskList = `/tareas?${new URLSearchParams({ q: marker, mias: '1', estado: 'PENDIENTE', prioridad: 'ALTA', area: fixture.areaId })}`;

  for (const width of [1280, 390]) {
    const context = await openContext(width);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      for (const [list, detailRoot] of [[entryList, '/libro/'], [taskBookList, '/tareas/'], [taskList, '/tareas/']]) {
        results.push({ width, ...await checkJourney(page, list, detailRoot) });
      }
      const entry = await db.operationalEntry.findFirstOrThrow({ where: { title: { startsWith: marker } } });
      await page.goto(`${base}/libro/${entry.id}`);
      assert.equal(await page.locator('[data-list-return]').getAttribute('href'), '/libro');
      await page.goto(`${base}/libro/${entry.id}?desdeLista=${encodeURIComponent('//evil.invalid/libro')}`);
      assert.equal(await page.locator('[data-list-return]').getAttribute('href'), '/libro');
      results.push({ width, directLinks: true, externalReturnRejected: true });
    } finally { await context.close(); }
  }

  const noStorage = await openContext(390);
  try {
    await noStorage.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[name];
        Storage.prototype[name] = function (key, ...args) {
          if (key.startsWith('aroh:list-')) throw new Error('Synthetic storage unavailable');
          return original.call(this, key, ...args);
        };
      }
    });
    const page = await noStorage.newPage();
    await page.goto(base + entryList);
    const row = page.locator('[data-list-item]').nth(9);
    const anchor = await row.getAttribute('id');
    await row.click();
    await page.locator('[data-list-return]').click();
    await page.locator(`[data-list-item="${anchor}"]`).waitFor();
    assert.equal(new URL(page.url()).hash, '#' + anchor);
    assert.equal(await page.locator(`[data-list-item="${anchor}"]`).getAttribute('aria-current'), 'true');
    results.push({ storageUnavailable: true, nativeAnchorFallback: true });
  } finally { await noStorage.close(); }

  const noJs = await openContext(390, { javaScriptEnabled: false });
  try {
    const page = await noJs.newPage();
    await page.goto(base + taskList);
    const row = page.locator('[data-list-item]').nth(9);
    const anchor = await row.getAttribute('id');
    await row.click();
    await page.locator('[data-list-return]').click();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, taskList);
    assert.equal(new URL(page.url()).hash, '#' + anchor);
    results.push({ javascriptDisabled: true, nativeLinks: true });
  } finally { await noJs.close(); }

  assert.equal(await db.operationalEntry.count({ where: { title: { startsWith: marker }, status: { not: 'ABIERTO' } } }), 0);
  assert.equal(await db.task.count({ where: { title: { startsWith: marker }, status: { not: 'PENDIENTE' } } }), 0);
  console.log('List/detail continuity passed without operational transitions.', JSON.stringify(results));
} finally {
  writeFileSync('/tmp/list-context-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close();
  await db.$disconnect();
}
