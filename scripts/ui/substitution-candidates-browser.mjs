import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
try {
  const role = await db.role.findUniqueOrThrow({ where: { key: 'RECEPCIONISTA' } });
  const people = [];
  for (const name of ['QA Suplente Uno', 'QA Suplente Dos']) people.push(await db.user.create({ data: {
    name, username: `qa_sup_${randomUUID().slice(0, 8)}`, passwordHash: 'synthetic-no-login',
    roleId: role.id, departmentId: fixture.areaId, mustChangePassword: false,
  } }));
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: 'lor_session', value: fixture.users.admin.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto('http://localhost:3000/coordinacion/automatizaciones');
    await page.getByText('Nueva política de suplencias', { exact: true }).click();
    const form = page.locator('form').filter({ has: page.locator('input[name="kind"][value="SUBSTITUTION"]') });
    const name = `QA política pausada ${width} ${randomUUID().slice(0, 6)}`;
    await form.getByLabel('Nombre', { exact: true }).fill(name);
    await form.getByLabel('Área de suplencias', { exact: true }).selectOption(fixture.areaId);
    await form.getByLabel('Agregar suplente', { exact: true }).selectOption(people[0].id);
    await form.getByRole('button', { name: 'Agregar suplente', exact: true }).click();
    await form.getByLabel('Agregar suplente', { exact: true }).selectOption(people[1].id);
    await form.getByRole('button', { name: 'Agregar suplente', exact: true }).click();
    await form.getByRole('button', { name: 'Bajar a QA Suplente Uno', exact: true }).click();
    assert.equal(await form.locator('input[name="candidateIds"]').inputValue(), `${people[1].id},${people[0].id}`);
    assert.equal(await form.getByLabel('Agregar suplente', { exact: true }).locator(`option[value="${people[0].id}"]`).count(), 0, 'No duplicate candidate');
    await form.getByLabel('Motivo y siguiente acción', { exact: true }).fill('QA: revisar el original y confirmar recepción antes de trabajar');
    await form.getByLabel('Autorización válida hasta', { exact: true }).fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    const before = await db.task.count();
    await form.getByRole('button', { name: 'Guardar versión en pausa', exact: true }).click();
    // Native API wrapper performs a document navigation after persistence.
    await page.locator('h3').filter({ hasText: name }).waitFor({ state: 'attached' });
    await page.getByText('Tus últimas 50 políticas', { exact: true }).click();
    await page.getByRole('heading', { name: `${name} · versión 1`, exact: true }).waitFor();
    const policy = await db.operationalAutomation.findFirstOrThrow({ where: { name, ownerId: fixture.users.admin.id } });
    assert.equal(policy.enabled, false);
    assert.deepEqual(policy.configuration.candidateIds, [people[1].id, people[0].id]);
    assert.equal(await db.task.count(), before, 'Saving paused configuration creates no operational work');
    await page.goto(`http://localhost:3000/coordinacion/automatizaciones?editar=${policy.id}`);
    const edit = page.locator('form').filter({ has: page.locator('input[name="kind"][value="SUBSTITUTION"]') });
    assert.equal(await edit.locator('input[name="candidateIds"]').inputValue(), `${people[1].id},${people[0].id}`);
    await edit.getByLabel('Trabajo', { exact: true }).selectOption('housekeeping');
    await edit.getByRole('alert').filter({ hasText: 'selecciones anteriores' }).waitFor();
    assert.equal(await edit.getByRole('button', { name: 'Guardar versión en pausa', exact: true }).isEnabled(), false);
    assert.equal(await edit.locator('input[name="candidateIds"]').inputValue(), `${people[1].id},${people[0].id}`, 'Incompatible context never silently replaces identity');
    assert.equal((await db.operationalAutomation.findUniqueOrThrow({ where: { id: policy.id } })).enabled, false);
    await edit.getByLabel('Trabajo', { exact: true }).selectOption('task');
    await edit.getByRole('button', { name: 'Quitar a QA Suplente Dos', exact: true }).click();
    assert.equal(await edit.locator('input[name="candidateIds"]').inputValue(), people[0].id);
    assert.equal(await edit.getByRole('button', { name: 'Guardar versión en pausa', exact: true }).isEnabled(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    mkdirSync('/tmp/aroh-ui-evidence', { recursive: true });
    await page.screenshot({ path: `/tmp/aroh-ui-evidence/substitution-${width}.png`, fullPage: true });
    results.push({ width, orderedIdentity: true, noDuplicates: true, pausedPersistence: true, incompatibleSelectionVisible: true, noOperationalWorkCreated: true, overflow: false });
    await context.close();
  }
} finally {
  writeFileSync('substitution-candidates-browser-results.json', JSON.stringify(results, null, 2));
  await browser.close(); await db.$disconnect();
}
