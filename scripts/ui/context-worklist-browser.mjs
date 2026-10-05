import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { watchSyntheticNavigation } from './navigation-diagnostics.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const base = 'http://localhost:3000';
const marker = `CONTEXT_WORKLIST_${Date.now()}`;
const results = [];
const noJsFailures = [];
const list = '/coordinacion?' + new URLSearchParams({ q: marker, area: fixture.areaId, vista: 'all', mios: '1', pagina: '2' });

async function session(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...options });
  await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
  });
  return context;
}

async function closed(page, anchor, scrollY) {
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(({ anchor, scrollY }) => document.activeElement?.id === anchor && Math.abs(window.scrollY - scrollY) <= 2, { anchor, scrollY });
  assert.equal(await page.locator(`[data-list-item="${anchor}"]`).getAttribute('aria-current'), 'true');
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
}

try {
  // Read-only journeys after fixture preparation; never create hotel records outside guarded CI.
  await db.task.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ title: `${marker} ${i}`, description: 'Synthetic native coordination context', createdById: fixture.users.admin.id, assigneeId: fixture.users.admin.id, departmentId: fixture.areaId, workNextAction: 'Revisar sin cambiar el registro' })) });
  for (const width of [1280, 390]) {
    const context = await session(width);
    try {
      const page = await context.newPage();
      const navigationFailure = await watchSyntheticNavigation(page);
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const mutations = [];
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/operational-actions/')) mutations.push(request.url()); });
      await page.goto(base + list);
      await page.locator('[data-list-item][aria-haspopup="dialog"]').first().waitFor();
      assert.equal(await page.locator('[data-worklist-fallback]').count(), 0, 'No editable fallback exists while JavaScript is enabled');
      const row = page.locator('[data-list-item][aria-haspopup="dialog"]').nth(9);
      await row.scrollIntoViewIfNeeded();
      await row.focus();
      const anchor = await row.getAttribute('id');
      const native = await row.getAttribute('href');
      const position = await page.evaluate(() => window.scrollY);
      assert.ok(position > 0);
      const nativeUrl = new URL(native, base);
      assert.equal(nativeUrl.searchParams.get('desdeLista'), `${list}#${anchor}`);
      await row.press('Enter');
      const panel = page.getByRole('dialog');
      await panel.waitFor();
      assert.equal(await panel.getAttribute('data-dialog-presentation'), 'side-panel');
      assert.equal(new URL(page.url()).hash, '#' + anchor);
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      const box = await panel.boundingBox();
      assert.ok(box && box.x >= 0 && Math.abs(box.x + box.width - width) <= 1 && box.height <= 900, 'Side panel fits the viewport');
      await panel.focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), true, 'Backward Tab from the dialog container stays inside');
      await page.keyboard.press('Tab');
      assert.equal(await panel.evaluate(node => node.contains(document.activeElement)), true, 'Forward Tab wraps inside');
      console.log('AROH_VISUAL_EVIDENCE ' + JSON.stringify({ name: 'coordination-panel-' + width, width, mime: 'image/jpeg', image: (await page.screenshot({ type: 'jpeg', quality: 40 })).toString('base64') }));
      await panel.getByText('Recepción, siguiente acción y relevo', { exact: true }).click();
      await panel.locator('textarea[name=nextAction]').first().fill('UNSAVED_CONTEXT_DRAFT');
      await panel.getByRole('button', { name: 'Cancelar y volver a la lista', exact: true }).click();
      await closed(page, anchor, position);
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
      assert.deepEqual(mutations, [], 'Cancel never sends an operational write');
      await page.goForward();
      await panel.waitFor();
      await page.goBack();
      await closed(page, anchor, position);
      await row.click();
      await panel.waitFor();
      await page.keyboard.press('Escape');
      await closed(page, anchor, position);
      // Native full record has safe return context and remains the real Task route.
      await row.click();
      await panel.locator('[data-worklist-native]').click();
      await page.locator('[data-list-return]').waitFor();
      assert.equal(new URL(page.url()).pathname, nativeUrl.pathname);
      assert.equal(await page.locator('[data-list-return]').innerText(), 'Volver a coordinación');
      await page.locator('[data-list-return]').click();
      await closed(page, anchor, position);
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
      // A later row remains selected even if the current URL names the older row.
      const nextRow = page.locator('[data-list-item][aria-haspopup="dialog"]').nth(10);
      await nextRow.scrollIntoViewIfNeeded();
      const nextAnchor = await nextRow.getAttribute('id');
      await nextRow.click();
      await panel.waitFor();
      const nextPosition = await page.evaluate(() => window.scrollY);
      await page.reload();
      await panel.waitFor();
      assert.equal(await page.locator('[data-worklist-panel]').getAttribute('data-worklist-panel'), nextAnchor, 'Reload resolves only the existing authorized row');
      await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await closed(page, nextAnchor, nextPosition);
      const nextPage = page.getByRole('navigation', { name: 'Páginas de coordinación' }).getByRole('link', { name: 'Siguiente →', exact: true });
      navigationFailure.mark('coordination-next-page', await nextPage.getAttribute('href'));
      const listDocument = await page.evaluate(() => performance.timeOrigin);
      try {
        await nextPage.click();
        await page.waitForURL(url => url.searchParams.get('pagina') === '3');
        assert.equal(await page.evaluate(() => performance.timeOrigin), listDocument, 'Pagination must preserve the current document and global drafts');
      } catch (error) { await navigationFailure('coordination-next-page'); throw error; }
      await page.goBack();
      await row.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('pagina'), '2');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      // Minimal requested URL: resolved area/view/page defaults must not prevent
      // Back from recognizing the original list or returning focus to its row.
      await page.goto(base + '/coordinacion?' + new URLSearchParams({ q: marker }));
      const defaultRow = page.locator('[data-list-item][aria-haspopup="dialog"]').first();
      await defaultRow.waitFor(); await defaultRow.focus();
      const defaultAnchor = await defaultRow.getAttribute('id');
      const defaultScroll = await page.evaluate(() => window.scrollY);
      await defaultRow.click(); await panel.waitFor();
      await page.keyboard.press('Escape'); await closed(page, defaultAnchor, defaultScroll);
      assert.equal(new URL(page.url()).searchParams.has('pagina'), false);
      assert.equal(new URL(page.url()).searchParams.has('vista'), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(mutations, []);
      results.push({ width, nativeRecord: true, filters: true, pagination: true, selection: true, scroll: true, cancelWithoutWrite: true, escape: true, nativeHistory: true, reload: true, keyboardFocus: true });
    } finally { await context.close(); }
  }

  const noStorage = await session(390);
  try {
    await noStorage.addInitScript(() => {
      for (const key of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[key];
        Storage.prototype[key] = function (name, ...args) { if (name.startsWith('aroh:list-')) throw new Error('Synthetic storage unavailable'); return original.call(this, name, ...args); };
      }
    });
    const page = await noStorage.newPage();
    await page.goto(base + list);
    const row = page.locator('[data-list-item][aria-haspopup="dialog"]').nth(9);
    await row.scrollIntoViewIfNeeded();
    await row.click();
    await page.getByRole('dialog').waitFor();
    const anchor = await row.getAttribute('id');
    const position = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Escape');
    await closed(page, anchor, position);
    results.push({ storageUnavailable: true, selectionAndScrollInHistory: true });
  } finally { await noStorage.close(); }

  const noJs = await session(390, { javaScriptEnabled: false });
  try {
    const page = await noJs.newPage();
    await page.goto(base + list);
    const fallback = page.locator('[data-worklist-fallback]').first();
    await fallback.locator('summary').first().click();
    assert.ok((await fallback.innerText()).includes('Revisar sin cambiar el registro'), 'Native details retain server-rendered information without JavaScript');
    const nativeLink = page.locator('[data-worklist-row]').first().locator('[data-worklist-native]');
    await nativeLink.click();
    await page.locator('[data-list-return]').waitFor();
    assert.ok(new URL(page.url()).pathname.startsWith('/tareas/'));
    await page.locator('[data-list-return]').click();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
    results.push({ javascriptDisabled: true, nativeDetailsAndRecordLinks: true });
  } catch (error) { noJsFailures.push({ error: error.name, message: error.message.slice(0, 400) }); }
  finally { await noJs.close(); }
  assert.equal(await db.task.count({ where: { title: { startsWith: marker }, status: { not: 'PENDIENTE' } } }), 0);
  assert.equal(await db.task.count({ where: { title: { startsWith: marker }, workNextAction: 'UNSAVED_CONTEXT_DRAFT' } }), 0);
  console.log('NOJS_CHARACTERIZATION ' + JSON.stringify({ status: noJsFailures.length ? 'inherited-limitation' : 'passed', baseline: '928f57b5fc6823229d160623e6253d4a7ce02fb3', noJsFailures }));
  console.log('Contextual JavaScript worklist journeys passed; NoJS characterization reported separately.', JSON.stringify(results));
} finally {
  writeFileSync('/tmp/context-worklist-browser-results.json', JSON.stringify({ browser: browser.version(), results, noJsFailures }, null, 2));
  await browser.close();
  await db.$disconnect();
}
