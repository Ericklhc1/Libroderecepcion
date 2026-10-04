import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const base = 'http://localhost:3000';
const marker = `HISTORY_CONTEXT_${Date.now()}`;
const results = [];
try {
  await db.operationalEntry.createMany({ data: Array.from({ length: 65 }, (_, index) => ({ type: 'NOVEDAD', status: 'CERRADO', title: `${marker} ${index}`, description: 'Archivo sintético cerrado', createdById: fixture.users.admin.id, ownerId: fixture.users.admin.id, departmentId: fixture.areaId, occurredAt: new Date(Date.now() - index * 1000) })) });
  const list = '/historial?' + new URLSearchParams({ q: marker, clase: 'entry', estado: 'CERRADO', pagina: '2' });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto(base + list);
    assert.equal(await page.locator('[data-list-item]').count(), 15, 'Closed archive retains native pagination');
    const report = new URL(await page.getByRole('link', { name: 'Ver / imprimir informe', exact: true }).getAttribute('href'), base);
    assert.equal(report.pathname, '/api/libro/reporte');
    assert.equal(report.searchParams.get('vista'), 'historial');
    assert.equal(report.searchParams.has('pagina'), false, 'Printing retains the original all-filtered-results contract');
    const row = page.locator('[data-list-item]').nth(9);
    await row.scrollIntoViewIfNeeded(); await row.focus();
    const anchor = await row.getAttribute('id');
    await row.press('Enter');
    const back = page.locator('[data-list-return]'); await back.waitFor();
    const position = await page.evaluate(({ scope, list }) => JSON.parse(sessionStorage.getItem(`aroh:list-position:${scope}:${list}`)), { scope: fixture.users.admin.id, list });
    assert.equal(await back.innerText(), 'Volver al historial');
    assert.equal(await back.getAttribute('href'), list + '#' + anchor);
    await page.reload(); await back.click();
    await page.waitForFunction(({ anchor, scrollY }) => document.activeElement?.id === anchor && Math.abs(window.scrollY - scrollY) <= 2, { anchor, scrollY: position.scrollY });
    assert.equal(await page.locator(`[data-list-item="${anchor}"]`).getAttribute('aria-current'), 'true');
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, list);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await db.operationalEntry.count({ where: { title: { startsWith: marker }, status: 'CERRADO' } }), 65);
    results.push({ width, closedArchive: true, nativeDetail: true, queryAndPage: true, focusAndScroll: true, reportContract: true, noOperationalMutation: true });
    await context.close();
  }
} finally {
  writeFileSync('history-context-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close(); await db.$disconnect();
}
