import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { watchSyntheticNavigation } from './navigation-diagnostics.mjs';

// Guarded CI PostgreSQL and synthetic sessions only. Fixture writes happen before
// the browser journey; the browser never submits a schedule/account mutation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const base = 'http://localhost:3000';
const marker = `SCHEDULE_QA_${Date.now()}`;
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const part = kind => parts.find(p => p.type === kind).value;
const today = `${part('year')}-${part('month')}-${part('day')}`;
const plus = (date, days) => { const result = new Date(`${date}T00:00:00Z`); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };
const display = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('es-CL', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
const monday = plus(today, -(weekday === 0 ? 6 : weekday - 1));
const results = [];

async function assertContext(page, area, plan, section = 'calendario') {
  await page.waitForURL(url => url.pathname === '/equipo' && url.searchParams.get('area') === area && url.searchParams.get('malla') === (plan ?? null) && (url.searchParams.get('seccion') || 'calendario') === section);
  await page.waitForFunction(area => document.querySelector('select[name="area"]')?.value === area, area);
  assert.equal(await page.locator('select[name="area"]').first().inputValue(), area, 'URL, rendered selector and target area agree');
  if (plan) assert.ok((await page.getByRole('navigation', { name: 'Secciones de Equipo y horarios' }).locator('a').evaluateAll(links => links.map(link => new URL(link.href).searchParams.get('malla')))).every(id => id === plan), 'Every tab preserves the selected plan');
}

async function secondaryNavigation(page, width, label) {
  let panel;
  if (width >= 1024) {
    await page.getByRole('navigation', { name: 'Módulos', exact: true }).getByRole('button', { name: 'Equipo', exact: true }).click();
    panel = page.locator('[aria-label="Accesos de Equipo"]');
  } else {
    await page.getByRole('navigation', { name: 'Navegación rápida', exact: true }).getByRole('button', { name: 'Más', exact: true }).click();
    panel = page.getByRole('dialog', { name: 'Todo el menú', exact: true });
    const group = panel.getByRole('button', { name: 'Equipo', exact: true });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  }
  await panel.waitFor();
  const views = panel.getByRole('button', { name: 'Vistas de Equipo y horarios', exact: true });
  if (await views.getAttribute('aria-expanded') !== 'true') await views.click();
  const link = panel.getByRole('link', { name: label, exact: true });
  const current = new URL(page.url()); const destination = new URL(await link.getAttribute('href'), base);
  assert.equal(destination.searchParams.get('area'), current.searchParams.get('area'));
  assert.equal(destination.searchParams.get('malla'), current.searchParams.get('malla'));
  await link.click();
  await panel.waitFor({ state: 'hidden' });
}

try {
  const role = await db.role.findUniqueOrThrow({ where: { key: 'RECEPCIONISTA' } });
  const areas = [];
  const people = [];
  const plans = [];
  for (let i = 0; i < 3; i++) {
    const area = await db.department.create({ data: { key: `${marker}_${i}`, name: `Área sintética Equipo ${i + 1}`, order: 900 + i } });
    areas.push(area);
    if (i === 2) continue;
    const account = await db.user.create({ data: { name: `Persona Equipo ${i + 1}`, username: `${marker.toLowerCase()}_${i}`, passwordHash: 'synthetic-no-login', roleId: role.id, departmentId: area.id } });
    people.push(await db.scheduleCollaborator.create({ data: { employeeCode: `QA${Date.now()}_${i}`, name: account.name, functionName: 'Operación de prueba', userId: account.id, memberships: { create: { departmentId: area.id } } }, include: { user: true } }));
    await db.scheduleTemplate.create({ data: { departmentId: area.id, code: 'QA_DIA', label: 'Día sintético', startTime: '08:00', endTime: '19:00', crossesMidnight: false, revision: 1 } });
    const current = await db.schedulePlan.create({ data: { departmentId: area.id, startDate: new Date(plus(today, -10)), endDate: new Date(plus(today, 3)) } });
    const future = await db.schedulePlan.create({ data: { departmentId: area.id, startDate: new Date(plus(today, 4)), endDate: new Date(plus(today, 12)) } });
    plans.push({ current, future });
  }
  const before = { slots: await db.scheduleSlot.count(), events: await db.scheduleEvent.count(), users: await db.user.count() };
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue(); });
    const page = await context.newPage();
    const diagnostic = await watchSyntheticNavigation(page);
    const errors = []; const writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && (new URL(request.url()).pathname === '/equipo' || new URL(request.url()).pathname.startsWith('/api/operational-actions/'))) writes.push(new URL(request.url()).pathname); });
    page.setDefaultTimeout(12000);
    try {
      await page.goto(`${base}/equipo?area=${areas[0].id}`);
      await assertContext(page, areas[0].id, plans[0].current.id);
      const calendar = page.getByRole('region', { name: 'Calendario del equipo' });
      await calendar.getByRole('heading', { name: `${display(monday)}–${display(plus(monday, 6))}`, exact: true }).waitFor();
      assert.ok((await calendar.innerText()).includes(people[0].name));
      assert.ok(!(await calendar.innerText()).includes(people[1].name));
      await page.locator(`a[href="/equipo?area=${areas[0].id}&malla=${plans[0].future.id}"]`).click();
      await assertContext(page, areas[0].id, plans[0].future.id);
      await calendar.getByText(/Malla futura/).waitFor();
      const tabs = page.getByRole('navigation', { name: 'Secciones de Equipo y horarios' });
      await tabs.getByRole('link', { name: 'Colaboradores', exact: true }).click();
      await assertContext(page, areas[0].id, plans[0].future.id, 'colaboradores');
      await page.getByRole('heading', { name: 'Colaboradores del área', exact: true }).waitFor();
      assert.ok((await page.locator('main').innerText()).includes(people[0].user.username));
      assert.ok(!(await page.locator('main').innerText()).includes(people[1].user.username));
      await secondaryNavigation(page, width, 'Cobertura mínima');
      await assertContext(page, areas[0].id, plans[0].future.id, 'cobertura');
      await page.goBack(); await assertContext(page, areas[0].id, plans[0].future.id, 'colaboradores');
      await page.goForward(); await assertContext(page, areas[0].id, plans[0].future.id, 'cobertura');
      await tabs.getByRole('link', { name: 'Calendario', exact: true }).click();
      await assertContext(page, areas[0].id, plans[0].future.id);
      await page.locator('select[name="area"]').first().selectOption(areas[1].id);
      await assertContext(page, areas[1].id, plans[1].current.id);
      assert.ok((await calendar.innerText()).includes(people[1].name));
      await page.goBack(); await assertContext(page, areas[0].id, plans[0].future.id);
      await page.goForward(); await assertContext(page, areas[1].id, plans[1].current.id);
      await page.locator('select[name="area"]').first().selectOption(areas[2].id);
      await assertContext(page, areas[2].id, null);
      assert.equal(await calendar.count(), 0);
      assert.ok((await page.locator('main').innerText()).includes('Crea una malla'));
      await page.goBack(); await assertContext(page, areas[1].id, plans[1].current.id);
      await page.goForward(); await assertContext(page, areas[2].id, null);
      await page.goto(`${base}/equipo?area=${areas[0].id}&malla=${plans[0].current.id}`);
      await assertContext(page, areas[0].id, plans[0].current.id);
      await calendar.getByRole('button', { name: 'Periodo anterior', exact: true }).click();
      const pastButtons = calendar.getByRole('button', { name: /^Programar a / });
      assert.ok(await pastButtons.count());
      assert.ok((await pastButtons.evaluateAll(buttons => buttons.map(button => button.disabled))).every(Boolean), 'Past cells cannot open an assignment form');
      await calendar.getByRole('button', { name: 'Ir a hoy', exact: true }).click();
      await calendar.getByRole('button', { name: `Programar a ${people[0].name} el ${display(today)}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Programar colaborador', exact: true });
      await dialog.waitFor();
      await dialog.locator('select[name="kind"]').selectOption('LIBRE');
      await dialog.locator('input[name="date"]').fill(plus(today, -1));
      assert.equal(await dialog.getByRole('button', { name: 'Guardar asignación', exact: true }).isDisabled(), true);
      await dialog.getByText('No se puede programar en una fecha pasada.', { exact: true }).waitFor();
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      const response = await context.request.get(`${base}/api/equipo/plantilla?area=${areas[0].id}&malla=${plans[0].current.id}`);
      assert.equal(response.status(), 200); const csv = await response.text();
      assert.ok(csv.includes(people[0].user.username)); assert.ok(!csv.includes(people[1].user.username));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Table scroll stays inside the calendar at this viewport');
      assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      results.push({ width, context: 'passed', history: 'passed', currentWeek: 'passed', pastActions: 'blocked', csvArea: 'passed', mutations: 0 });
    } catch (error) { await diagnostic('schedule-audit'); throw error; }
    finally { await context.close(); }
  }
  assert.deepEqual({ slots: await db.scheduleSlot.count(), events: await db.scheduleEvent.count(), users: await db.user.count() }, before, 'Read-only browser journeys preserve fixture records');
  console.log('Equipo audit journeys passed:', JSON.stringify(results));
} finally {
  writeFileSync('/tmp/schedule-audit-browser-results.json', JSON.stringify({ results }, null, 2));
  await browser.close(); await db.$disconnect();
}
