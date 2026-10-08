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
const noJsFailures = [];

// This harness only visits loopback synthetic fixtures. Keep failure output
// bounded and omit unknown query values, headers, cookies and response bodies.
function diagnosticUrl(value, depth = 0) {
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return '[non-local URL]';
    const params = new URLSearchParams();
    for (const [key, item] of url.searchParams) {
      if (['clase', 'tipo', 'estado', 'prioridad', 'pagina', 'mias'].includes(key)) params.set(key, item.slice(0, 80));
      else if (key === 'q' && item.startsWith('LIST_CONTEXT_')) params.set(key, item.slice(0, 80));
      else if (key === 'desdeLista' && depth === 0) params.set(key, diagnosticUrl(item, 1));
      else if (key !== '_rsc') params.set(key, '[omitted]');
    }
    return (url.pathname + (params.size ? '?' + params.toString() : '') + url.hash).slice(0, 1200);
  } catch { return '[invalid URL]'; }
}

async function captureFailure(page, progress, events) {
  const observed = await page.evaluate(({ anchor, scope }) => {
    const target = document.getElementById(anchor);
    const rows = [...document.querySelectorAll('[data-list-item]')];
    const visible = element => Boolean(element.getClientRects().length);
    const targetBox = target?.getBoundingClientRect();
    const treeSegments = [];
    const visitTree = (tree, depth = 0) => {
      if (!Array.isArray(tree) || depth > 8 || treeSegments.length >= 24) return;
      const segment = tree[0];
      // PAGE search data and arbitrary history state are deliberately not logged.
      if (typeof segment === 'string') treeSegments.push(segment.split('?', 1)[0].slice(0, 100));
      else if (Array.isArray(segment)) treeSegments.push(segment.slice(0, 3).map(item => String(item).slice(0, 100)));
      if (tree[1] && typeof tree[1] === 'object') Object.values(tree[1]).forEach(value => visitTree(value, depth + 1));
    };
    visitTree(history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE);
    let pendingReturn = null;
    try { pendingReturn = sessionStorage.getItem(`aroh:list-return:${scope}`); } catch { /* optional browser storage */ }
    return {
      url: location.href,
      readyState: document.readyState,
      returnHref: document.querySelector('[data-list-return]')?.getAttribute('href') ?? null,
      pendingReturn,
      history: { length: history.length, nextEntry: Boolean(history.state?.__NA), treeSegments },
      rowCount: rows.length,
      rows: rows.filter(visible).slice(0, 12).map(element => ({ id: element.id, current: element.getAttribute('aria-current') })),
      target: target ? { id: target.id, visible: visible(target), current: target.getAttribute('aria-current'), top: targetBox?.top, height: targetBox?.height } : null,
      activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
      scrollY,
      navigationTypes: performance.getEntriesByType('navigation').map(entry => entry.type).slice(-3),
      openDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
    };
  }, { anchor: progress.anchor ?? '', scope: fixture.users.admin.id }).catch(error => ({ observationError: error.name }));
  if (observed.url) observed.url = diagnosticUrl(observed.url);
  if (observed.returnHref) observed.returnHref = diagnosticUrl(observed.returnHref);
  if (observed.pendingReturn) observed.pendingReturn = diagnosticUrl(observed.pendingReturn);
  const report = {
    status: 'failed',
    width: page.viewportSize()?.width,
    step: progress.step,
    expectedList: diagnosticUrl(progress.list),
    expectedDetail: progress.detail ? diagnosticUrl(progress.detail) : null,
    anchor: progress.anchor ?? null,
    observed,
    events,
  };
  results.push(report);
  console.error('List context failure diagnostics:', JSON.stringify(report));
}

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
  const progress = { step: 'open-list', list, detail: null, anchor: null };
  const events = [];
  const record = event => {
    events.push({ step: progress.step, ...event });
    if (events.length > 32) events.shift();
  };
  const navigated = frame => {
    if (frame === page.mainFrame()) record({ event: 'navigation', url: diagnosticUrl(frame.url()) });
  };
  const pageError = error => record({ event: 'pageerror', name: error.name, message: error.message.slice(0, 600) });
  const failedRequest = request => {
    if (request.isNavigationRequest()) record({ event: 'requestfailed', url: diagnosticUrl(request.url()), error: request.failure()?.errorText?.slice(0, 160) });
  };
  page.on('framenavigated', navigated);
  page.on('pageerror', pageError);
  page.on('requestfailed', failedRequest);
  try {
  await page.goto(base + list);
  const rows = page.locator('[data-list-item]');
  assert.ok(await rows.count() >= 10, 'Synthetic list has enough rows to exercise real scroll');
  const row = rows.nth(9);
  await row.scrollIntoViewIfNeeded();
  const anchor = await row.getAttribute('id');
  const detailHref = await row.getAttribute('href');
  const detail = new URL(detailHref, base);
  progress.anchor = anchor;
  progress.detail = detailHref;
  assert.ok(detail.pathname.startsWith(expectedDetailRoot));
  assert.equal(detail.searchParams.get('desdeLista'), list + '#' + anchor);
  progress.step = 'open-detail';
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
  progress.step = 'cancel-native-edit';
  const actions = page.locator('[aria-label="Acciones del asunto"]');
  if (page.viewportSize().width < 1024) await actions.getByText('Más ···', { exact: true }).click();
  await actions.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[name=title]').fill('Synthetic unsaved edit');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(page.url(), detailBeforeCancel, 'Cancelling a native dialog preserves the exact detail URL');
  assert.equal(await page.locator('[data-list-return]').getAttribute('href'), list + '#' + anchor);

  // Reloading or sharing a detail never drops its native return query.
  progress.step = 'reload-detail';
  await page.reload();
  progress.step = 'first-explicit-return';
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
  progress.step = 'back-to-detail-after-return';
  await page.goBack();
  await page.locator('[data-list-return]').waitFor();
  assert.equal(new URL(page.url()).pathname, detail.pathname);
  progress.step = 'forward-to-returned-list';
  await page.goForward();
  await selected.waitFor();
  assert.equal(new URL(page.url()).hash, '#' + anchor);
  progress.step = 'back-to-detail-again';
  await page.goBack();
  await page.locator('[data-list-return]').waitFor();
  progress.step = 'back-to-original-list';
  await page.goBack();
  await selected.waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
  assert.equal(new URL(page.url()).hash, '');
  await page.waitForFunction(anchor => document.getElementById(anchor)?.getAttribute('aria-current') === 'true', anchor);
  assert.equal(await selected.getAttribute('aria-current'), 'true');
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - captured.scrollY) <= 2, 'Browser Back keeps native scroll');
  progress.step = 'forward-to-reloaded-detail';
  await page.goForward();
  await page.locator('[data-list-return]').waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, detail.pathname + detail.search, 'Forward returns to the exact canonical detail with its context');
  assert.equal(await page.locator('[data-list-return]').getAttribute('href'), list + '#' + anchor, 'The second return still targets the original filtered list and row');
  progress.step = 'second-explicit-return';
  record({ event: 'activate-return', url: diagnosticUrl(page.url()), target: diagnosticUrl(list + '#' + anchor) });
  await page.locator('[data-list-return]').click();
  await selected.waitFor();
  await page.waitForFunction(scope => sessionStorage.getItem(`aroh:list-return:${scope}`) === null, fixture.users.admin.id);
  const nextRow = page.locator('[data-list-item]').nth(10);
  const nextAnchor = await nextRow.getAttribute('id');
  progress.step = 'open-another-row';
  await nextRow.click();
  await page.locator('[data-list-return]').waitFor();
  progress.step = 'back-to-list-with-older-fragment';
  await page.goBack();
  await page.locator(`[data-list-item="${nextAnchor}"]`).waitFor();
  await page.waitForFunction(anchor => document.getElementById(anchor)?.getAttribute('aria-current') === 'true', nextAnchor);
  assert.equal(await page.locator(`[data-list-item="${nextAnchor}"]`).getAttribute('aria-current'), 'true', 'Back selects the most recent row even when the list URL has an older fragment');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
  return { listRoot: new URL(list, base).pathname, detailRoot: expectedDetailRoot, filters: true, selection: true, scroll: true, cancel: true, reload: true, nativeHistory: true };
  } catch (error) {
    await captureFailure(page, progress, events);
    throw error;
  } finally {
    page.off('framenavigated', navigated);
    page.off('pageerror', pageError);
    page.off('requestfailed', failedRequest);
  }
}

try {
  const role = await db.role.findUniqueOrThrow({ where: { key: 'RECEPCIONISTA' } });
  const author = await db.user.create({ data: { name: marker, username: marker.toLowerCase(), passwordHash: 'synthetic-no-login', roleId: role.id, departmentId: fixture.areaId } });
  await db.operationalEntry.createMany({ data: Array.from({ length: 85 }, (_, index) => ({
    type: 'INCIDENCIA', title: `${marker} ${index}`, description: 'Synthetic list continuity only',
    createdById: author.id, ownerId: fixture.users.admin.id, departmentId: fixture.areaId,
    priority: 'ALTA', occurredAt: new Date(Date.now() - index * 1000),
  })) });
  // The navigation fixture needs stable page membership, independent of SQL tie order.
  const fixtureEpoch = Date.now();
  await db.task.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
    title: `${marker} task ${index}`, description: 'Synthetic list continuity only',
    createdById: fixture.users.admin.id, assigneeId: fixture.users.admin.id, departmentId: fixture.areaId,
    priority: 'ALTA', createdAt: new Date(fixtureEpoch - index * 1000),
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
    // The row is server-rendered before ListNavigation's hydration effect can
    // select the fragment. With storage disabled there is no return marker to
    // await; wait for the same selection state asserted below instead.
    await page.waitForFunction(anchor => document.getElementById(anchor)?.getAttribute('aria-current') === 'true', anchor);
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
  } catch (error) { noJsFailures.push({ error: error.name, message: error.message.slice(0, 400) }); }
  finally { await noJs.close(); }

  assert.equal(await db.operationalEntry.count({ where: { title: { startsWith: marker }, status: { not: 'ABIERTO' } } }), 0);
  assert.equal(await db.task.count({ where: { title: { startsWith: marker }, status: { not: 'PENDIENTE' } } }), 0);
  console.log('NOJS_CHARACTERIZATION ' + JSON.stringify({ status: noJsFailures.length ? 'inherited-limitation' : 'passed', baseline: '928f57b5fc6823229d160623e6253d4a7ce02fb3', noJsFailures }));
  console.log('JavaScript list/detail continuity passed without operational transitions.', JSON.stringify(results));
} finally {
  writeFileSync('/tmp/list-context-browser-results.json', JSON.stringify({ browser: browser.version(), results, noJsFailures }, null, 2));
  await browser.close();
  await db.$disconnect();
}
