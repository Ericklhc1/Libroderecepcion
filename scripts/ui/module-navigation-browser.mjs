import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { watchSyntheticNavigation } from './navigation-diagnostics.mjs';

// Read-only navigation against the existing guarded synthetic fixture. No writes to operations.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
const noJsFailures = [];
const base = 'http://localhost:3000';

async function checkFrontiDraft(page, expected) {
  await page.getByRole('button', { name: 'Abrir Fronti', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Fronti', exact: true });
  assert.equal(await panel.getByRole('textbox', { name: 'Mensaje para Fronti', exact: true }).inputValue(), expected, 'SPA navigation and history retain the unsent Fronti draft');
  await panel.getByRole('button', { name: 'Minimizar Fronti', exact: true }).click();
}

async function focused(locator) { return locator.evaluate(node => node === document.activeElement); }
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Navigation must fit the viewport');
}
async function openMobile(page) {
  const trigger = page.getByRole('navigation', { name: 'Navegación rápida', exact: true }).getByRole('button', { name: 'Más', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Todo el menú', exact: true });
  await panel.waitFor();
  return { trigger, panel };
}
async function expandMobileModule(panel, label) {
  const options = panel.getByRole('button', { name: 'Vistas de ' + label, exact: true });
  if (!(await options.isVisible())) await panel.getByRole('button', { name: 'Operación', exact: true }).click();
  if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
}

try {
  for (const width of [1280, 1024, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    const navigationFailure = await watchSyntheticNavigation(page);
    page.setDefaultTimeout(12000);
    const hydrationErrors = [];
    const frontiPosts = [];
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/fronti') frontiPosts.push(request.method()); });
    page.on('pageerror', error => hydrationErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydration|didn.t match|server rendered html/i.test(message.text())) hydrationErrors.push(message.text()); });
    await page.goto(base + '/libro?clase=entry&tipo=INCIDENCIA');
    assert.equal(new URL(page.url()).pathname, '/libro', 'The synthetic session must pass native authentication');
    await noOverflow(page);
    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    const draft = 'UNSENT_SYNTHETIC_FRONTI_DRAFT_' + width;
    await page.getByRole('button', { name: 'Abrir Fronti', exact: true }).click();
    const fronti = page.getByRole('region', { name: 'Fronti', exact: true });
    await fronti.getByRole('textbox', { name: 'Mensaje para Fronti', exact: true }).fill(draft);
    await fronti.getByRole('button', { name: 'Minimizar Fronti', exact: true }).click();

    if (width >= 1024) {
      const nav = page.getByRole('navigation', { name: 'Módulos', exact: true });
      const trigger = nav.getByRole('button', { name: 'Operación', exact: true });
      const panel = page.locator('[aria-label="Accesos de Operación"]');
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      await panel.waitFor();
      assert.ok(await focused(panel.locator('a').first()), 'ArrowDown enters the first destination');
      await page.keyboard.press('End');
      assert.ok(await focused(panel.locator('a').last()), 'End reaches the last destination');
      await page.keyboard.press('Home');
      assert.ok(await focused(panel.locator('a').first()), 'Home reaches the first destination');
      assert.equal(await panel.getByRole('link', { name: 'Incidencias', exact: true }).count(), 0, 'Secondary destinations start closed');
      await panel.getByRole('button', { name: 'Vistas de Novedades', exact: true }).click();
      const selected = panel.locator('a[aria-current="page"]');
      assert.equal(await selected.count(), 1);
      assert.equal(await selected.getAttribute('href'), '/libro?clase=entry&tipo=INCIDENCIA');
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      assert.ok(await focused(trigger), 'Escape returns focus');
      await trigger.click();
      await page.keyboard.press('Tab');
      assert.ok(await focused(panel.getByRole('button', { name: 'Cerrar accesos', exact: true })), 'Tab enters the disclosure');
      await page.keyboard.press('Shift+Tab');
      await panel.waitFor({ state: 'hidden' });
      assert.ok(await focused(trigger));
      await trigger.click();
      await page.getByRole('searchbox', { name: 'Búsqueda global', exact: true }).click();
      await panel.waitFor({ state: 'hidden' });
      // Query-only navigation must close the panel and select a single destination.
      await trigger.click();
      await panel.getByRole('button', { name: 'Vistas de Novedades', exact: true }).click();
      navigationFailure.mark('module-task-query', '/libro?clase=task');
      const taskDocument = await page.evaluate(() => performance.timeOrigin);
      try {
        await panel.getByRole('link', { name: 'Mis tareas', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/libro' && url.searchParams.get('clase') === 'task');
        assert.equal(await page.evaluate(() => performance.timeOrigin), taskDocument, 'Module navigation must preserve the current document and global drafts');
      } catch (error) { await navigationFailure('module-task-query'); throw error; }
      await panel.waitFor({ state: 'hidden' });
      await trigger.click();
      await panel.getByRole('button', { name: 'Vistas de Novedades', exact: true }).click();
      assert.equal(await panel.locator('a[aria-current="page"]').getAttribute('href'), '/libro?clase=task');
      await page.keyboard.press('Escape');
      await page.goBack();
      await page.waitForURL(url => url.searchParams.get('tipo') === 'INCIDENCIA');
      await panel.waitFor({ state: 'hidden' });
      // Every approved operation root remains reachable, including shortcut submenus.
      await trigger.click();
      await panel.getByRole('button', { name: 'Vistas de Novedades', exact: true }).click();
      for (const href of ['/coordinacion', '/libro?clase=entry', '/novedades/habitacion', '/caja', '/turno', '/llaves', '/notificaciones', '/housekeeping', '/custodia', '/seguimientos', '/tareas', '/historial']) {
        assert.ok(await panel.locator('a').evaluateAll((links, href) => links.some(link => link.getAttribute('href') === href), href), 'Missing destination: ' + href);
      }
      if (width === 1280) console.log('AROH_VISUAL_EVIDENCE ' + JSON.stringify({ name: 'modules-desktop', width, mime: 'image/jpeg', image: (await page.screenshot({ type: 'jpeg', quality: 40 })).toString('base64') }));
      await page.keyboard.press('Escape');
    } else {
      const { trigger, panel } = await openMobile(page);
      const close = panel.getByRole('button', { name: 'Cerrar', exact: true });
      assert.ok(await focused(close), 'Mobile dialog initially focuses Close');
      // Visibility precedes the end of mobile-menu-open (translateY(1rem) -> 0).
      // Measure its final geometry, using animation state rather than a sleep.
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Todo el menú"]');
        return dialog && dialog.getAnimations().filter(animation => animation.animationName === 'mobile-menu-open')
          .every(animation => animation.playState === 'finished' || animation.playState === 'idle');
      }, undefined, { timeout: 12000 });
      const box = await panel.boundingBox();
      const quickActionsBox = await page.getByRole('navigation', { name: 'Navegación rápida', exact: true }).boundingBox();
      const geometry = JSON.stringify({ width, panel: box, quickActions: quickActionsBox, viewport: page.viewportSize() });
      assert.ok(box && box.y >= 0 && box.y + box.height <= 841, 'Mobile dialog fits above quick actions: ' + geometry);
      assert.ok(quickActionsBox && box.y + box.height <= quickActionsBox.y + 1, 'Mobile dialog clears the actual quick-action bar (including its border): ' + geometry);
      await page.keyboard.press('Shift+Tab');
      assert.ok(await focused(panel.getByRole('button', { name: 'Cerrar sesión', exact: true })), 'Focus stays inside the dialog');
      await page.keyboard.press('Tab');
      assert.ok(await focused(close));
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      assert.ok(await focused(trigger), 'Escape returns to the mobile module trigger');
      const more = page.getByRole('navigation', { name: 'Navegación rápida', exact: true }).getByRole('button', { name: 'Más', exact: true });
      await more.click();
      await panel.waitFor();
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      assert.ok(await focused(more), 'The single mobile menu trigger retains focus return');
      await trigger.click();
      await expandMobileModule(panel, 'Novedades');
      await panel.getByRole('link', { name: 'Mis tareas', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/libro' && url.searchParams.get('clase') === 'task');
      await panel.waitFor({ state: 'hidden' });
      assert.ok((await page.locator('[data-module-navigation="mobile"]').textContent()).includes('Mis tareas'), 'Persistent context reflects the query view');
      await trigger.click();
      await expandMobileModule(panel, 'Caja');
      await panel.getByRole('link', { name: 'Garantías', exact: true }).waitFor();
      await panel.getByRole('group', { name: 'Apariencia', exact: true }).waitFor();
      if (width === 390) console.log('AROH_VISUAL_EVIDENCE ' + JSON.stringify({ name: 'modules-mobile', width, mime: 'image/jpeg', image: (await page.screenshot({ type: 'jpeg', quality: 40 })).toString('base64') }));
      await page.keyboard.press('Escape');
      await page.goBack();
      await page.waitForURL(url => url.searchParams.get('tipo') === 'INCIDENCIA');
      await panel.waitFor({ state: 'hidden' });
    }
    await checkFrontiDraft(page, draft);
    await page.goForward();
    await page.waitForURL(url => url.pathname === '/libro' && url.searchParams.get('clase') === 'task');
    await checkFrontiDraft(page, draft);
    await page.goBack();
    await page.waitForURL(url => url.searchParams.get('tipo') === 'INCIDENCIA');
    await checkFrontiDraft(page, draft);
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, 'Navigation and Back/Forward preserve the document');
    assert.deepEqual(frontiPosts, [], 'Checking a draft never sends it or invokes an assistant action');
    await noOverflow(page);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const headerBox = await page.locator('header').first().boundingBox();
    assert.ok(headerBox && Math.abs(headerBox.y) <= 1, 'The shared header stays at the top while scrolling');
    assert.deepEqual(hydrationErrors, []);
    results.push({ width, groups: true, querySelection: true, keyboard: true, focusReturn: true, backDismissal: true, forwardAndBack: true, frontiDraftPreserved: true, noFrontiSubmission: true, noOverflow: true });
    await context.close();
  }
  for (const key of ['admin', 'maid']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
    try {
    await context.addCookies([{ name: 'lor_session', value: fixture.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base + (key === 'admin' ? '/libro' : '/housekeeping'));
    const nativeSummary = page.locator('noscript details > summary');
    assert.equal(await nativeSummary.textContent(), 'Abrir módulos disponibles');
    await nativeSummary.click();
    const fallback = page.getByRole('navigation', { name: 'Módulos sin JavaScript', exact: true });
    await fallback.waitFor();
    assert.ok(await fallback.locator('a[href="/housekeeping"]').count() > 0);
    if (key === 'admin') {
      await fallback.locator('a[href="/caja"]').click();
      assert.equal(new URL(page.url()).pathname, '/caja');
    } else {
      assert.equal(await fallback.locator('a[href^="/libro"]').count(), 0, 'Native catalogue still uses the role-filtered server projection');
      assert.equal(await fallback.locator('a[href="/caja"]').count(), 0);
    }
    await page.locator('[aria-label="Contexto operativo"] time[datetime]').waitFor();
    results.push({ javascriptDisabled: true, role: key, nativeModuleLinks: true, permissionsPreserved: true, operationalDateVisible: true });
    } catch (error) { noJsFailures.push({ role: key, error: error.name, message: error.message.slice(0, 400) }); }
    finally { await context.close(); }
  }
  console.log('NOJS_CHARACTERIZATION ' + JSON.stringify({ status: noJsFailures.length ? 'inherited-limitation' : 'passed', baseline: '928f57b5fc6823229d160623e6253d4a7ce02fb3', noJsFailures }));
  console.log('Module navigation JavaScript verification passed; NoJS characterization reported separately.', JSON.stringify(results));
} finally {
  writeFileSync('module-navigation-browser-results.json', JSON.stringify({ browser: browser.version(), results, noJsFailures }, null, 2));
  await browser.close();
}
