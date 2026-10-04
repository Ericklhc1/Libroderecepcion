import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient(), browser = await chromium.launch({ headless: true }), results = [];
try {
  const room = await db.room.findUniqueOrThrow({ where: { number: '512' } });
  for (const width of [1280, 390]) {
    const title = `QA contexto habitación ${width} ${randomUUID().slice(0, 6)}`;
    const source = await db.operationalEntry.create({ data: { title, description: 'Contexto sintético preservado', type: 'NOVEDAD', createdById: fixture.users.admin.id, ownerId: fixture.users.admin.id, roomId: room.id } });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto('http://localhost:3000/novedades/habitacion');
    assert.equal(await page.locator('[data-room-number]').count(), 89);
    await page.getByRole('navigation', { name: 'Pisos del hotel' }).getByRole('link', { name: 'Piso 5', exact: true }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('piso') === '5' && document.querySelectorAll('[data-room-number]').length === 30);
    assert.equal(await page.locator('[data-room-number]').count(), 30);
    await page.locator('[data-room-number="512"]').click();
    await page.getByRole('heading', { name: 'Habitación 512', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('piso'), '5');
    await page.getByRole('link').filter({ hasText: title }).click();
    const back = page.locator('[data-list-return]'); await back.waitFor();
    const href = new URL(await back.getAttribute('href'), 'http://localhost:3000');
    assert.equal(href.pathname, '/novedades/habitacion');
    assert.equal(href.searchParams.get('habitacion'), '512');
    assert.equal(href.searchParams.get('piso'), '5');
    await back.click();
    await page.getByRole('heading', { name: 'Habitación 512', exact: true }).waitFor();
    assert.equal(await page.locator('[data-room-number="512"]').getAttribute('aria-current'), 'page');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole('link', { name: 'Cerrar', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/novedades/habitacion' && !url.searchParams.has('habitacion') && url.searchParams.get('piso') === '5');
    await page.waitForFunction(() => document.querySelectorAll('[data-room-number]').length === 30);
    assert.equal(new URL(page.url()).searchParams.get('habitacion'), null);
    assert.equal(new URL(page.url()).searchParams.get('piso'), '5');
    assert.equal(await page.locator('[data-room-number]').count(), 30);
    assert.equal((await db.operationalEntry.findUniqueOrThrow({ where: { id: source.id } })).status, 'ABIERTO');
    assert.deepEqual(await db.room.findUniqueOrThrow({ where: { id: room.id } }), room);
    results.push({ width, fullMap: 89, filteredFloor: 30, roomPreserved: true, floorPreserved: true, nativeOrigin: true, noOperationalMutation: true });
    await context.close();
  }
} finally {
  writeFileSync('room-context-browser-results.json', JSON.stringify({ browser: browser.version(), results }, null, 2));
  await browser.close(); await db.$disconnect();
}
