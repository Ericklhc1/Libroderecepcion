import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

// Uses the existing synthetic fixture and guarded loopback database only.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
const storageKey = 'aroh.appearance.v1';

async function openPreference(page, width) {
  if (width >= 1024) await page.locator('[aria-controls="account-options"]').click();
  else await page.getByRole('navigation', { name: 'Navegación rápida', exact: true }).getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('group', { name: 'Apariencia', exact: true }).waitFor();
}
async function selectAppearance(page, label) {
  await page.getByRole('group', { name: 'Apariencia', exact: true }).locator('label').filter({ hasText: label }).click();
}
async function expectTheme(page, theme) {
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
}

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const hydrationErrors = [];
    page.on('console', message => { if (message.type() === 'error' && /hydration|didn.t match|server rendered html/i.test(message.text())) hydrationErrors.push(message.text()); });
    await page.goto('http://localhost:3000/libro');
    await openPreference(page, width);
    await selectAppearance(page, 'Oscuro');
    await expectTheme(page, 'dark');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), 'dark');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('group', { name: 'Apariencia', exact: true }).isVisible(), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(11, 28, 41)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Dark view must fit the viewport');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectTheme(page, 'dark');
    await openPreference(page, width);
    assert.equal(await page.getByRole('radio', { name: 'Oscuro', exact: true }).isChecked(), true);
    await selectAppearance(page, 'Sistema');
    await expectTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');
    await page.getByRole('radio', { name: 'Sistema', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.getByRole('radio', { name: 'Oscuro', exact: true }).isChecked(), true);
    const focusOutline = await page.getByRole('radio', { name: 'Oscuro', exact: true }).evaluate(input => getComputedStyle(input.nextElementSibling).outlineStyle);
    assert.equal(focusOutline, 'solid', 'Keyboard focus is visible on the full choice');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'dark');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' });
    if (width < 1024) assert.equal(await page.locator('.mobile-menu-enter').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.keyboard.press('Escape');
    // A genuine second tab exercises the native storage event.
    const secondPage = await context.newPage();
    await secondPage.goto('http://localhost:3000/libro');
    await secondPage.evaluate(key => localStorage.setItem(key, 'light'), storageKey);
    await expectTheme(page, 'light');
    await secondPage.close();
    assert.deepEqual(hydrationErrors, []);
    results.push({ width, persistence: true, systemChange: true, keyboard: true, printLight: true, crossTab: true, noHydrationErrors: true });
    await context.close();
  }
  // A browser denying storage must still change appearance and explain its limit.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => new URL(route.request().url()).hostname !== 'localhost' ? route.abort() : route.continue());
  await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto('http://localhost:3000/libro');
  await expectTheme(page, 'dark');
  await openPreference(page, 1280);
  await selectAppearance(page, 'Claro');
  await expectTheme(page, 'light');
  await page.getByText('No se pudo guardar. Se aplicará mientras esta página siga abierta.', { exact: true }).waitFor();
  results.push({ blockedStorage: true, systemFallback: true, selectionWorks: true });
  await context.close();
  console.log('Appearance browser verification passed.', JSON.stringify(results));
} finally {
  writeFileSync('appearance-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close();
}
