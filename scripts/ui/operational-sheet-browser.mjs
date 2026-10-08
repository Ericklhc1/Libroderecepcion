import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const results = [];
const routes = ['/', '/caja', '/coordinacion', '/libro', '/novedades/habitacion', '/llaves', '/inventario', '/housekeeping', '/jornada', '/turno', '/supervision', '/gerencia', '/equipo', '/admin', '/admin/auditoria', '/notificaciones'];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const route of routes) {
      const response = await page.goto(`http://localhost:3000${route}`);
      assert.ok(response?.ok(), `${width} ${route}: HTTP success`);
      await page.locator('#contenido-principal h1').first().waitFor();
      assert.ok(!page.url().includes('/login') && !page.url().includes('/sin-permisos'), `Authenticated ${route}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${route}: no page overflow`);
      if (width >= 1024) {
        const main = page.locator('#contenido-principal');
        assert.ok(await main.evaluate(node => node.getBoundingClientRect().width >= innerWidth - 1), `${route}: uses full width`);
      }
      const header = page.locator('#contenido-principal thead th').first();
      if (await header.count()) assert.equal(await header.evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)', `${route}: dark table header`);
      if (route === '/caja') {
        const actions = page.locator('[aria-label="Acciones de Caja"]');
        const more = actions.getByText('Más ···', { exact: true });
        if (await more.count()) assert.equal(await more.isVisible(), width < 1024);
      }
      if (route === '/novedades/habitacion') assert.equal(await page.getByText('Sin contexto abierto', { exact: true }).count(), 0);
      if (route === '/coordinacion') assert.equal(await page.getByText('Más vistas', { exact: true }).count(), 0);
      if (route === '/jornada') assert.equal(await page.getByText('Tres conceptos separados', { exact: true }).count(), 0);
      results.push({ width, route, passed: true });
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await context.close();
  }
  console.log('Operational sheet journeys passed:', results.length);
} finally {
  writeFileSync('operational-sheet-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close();
}
