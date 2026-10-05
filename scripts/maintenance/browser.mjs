import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

// Same disposable PostgreSQL, signed sessions and isolated server as the Etapa journeys.
// Only test setup adds a synthetic unread announcement or pending tutorial, restored below.
// No real login, hotel operations, external requests, screenshots or persisted artifacts.
const ORIGIN = 'http://localhost:3000';
const CONTROL = '/admin/mantenimiento';
const MESSAGE = 'Trabajos de mantenimiento programados por actualizaciones importantes.';
const SETTING = 'system.maintenance';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const results = [];
let browser;
let admin;
let guest;
let interruption;
let activePhase = 'startup';
let failure;

function evidence(data) { console.log(JSON.stringify({ suite: 'system-maintenance', ...data })); }
function failureDetails(error) {
  // Playwright transport errors can contain request headers. Never print them.
  return { error: error instanceof Error ? error.name : 'Unknown failure',
    ...(error instanceof assert.AssertionError ? { assertion: error.message } : {}),
    location: error instanceof Error ? error.stack?.split('\n').find(line => line.includes('/scripts/maintenance/browser.mjs:'))?.trim() : undefined };
}

async function actor(name, width) {
  if (name) assert.ok(fixture.users[name]?.token && fixture.users[name]?.id, 'Synthetic session fixture is required');
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  if (name) await context.addCookies([{ name: 'lor_session', value: fixture.users[name].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    // Do not let shell widgets, telemetry or Next prefetch perform incidental work.
    const backgroundApi = url.pathname.startsWith('/api/') && url.pathname !== '/api/maintenance';
    const unrelatedWrite = !['GET', 'HEAD'].includes(request.method()) && url.pathname !== CONTROL;
    const prefetch = request.headers()['next-router-prefetch'] === '1' || request.headers().purpose === 'prefetch'
      || (request.headers().rsc === '1' && url.pathname !== CONTROL);
    return url.origin !== ORIGIN || backgroundApi || unrelatedWrite || prefetch ? route.abort() : route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  let maintenancePosts = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === CONTROL) maintenancePosts++;
  });
  return { context, page, maintenancePosts: () => maintenancePosts };
}

async function request(context, path, method = 'GET') {
  // APIRequestContext does not use browser routing; pin its destination and forbid redirects.
  assert.ok(path.startsWith('/api/'), 'Only explicit local API probes are supported');
  return context.request.fetch(`${ORIGIN}${path}`, {
    method, maxRedirects: 0, timeout: 15000,
    headers: { Origin: ORIGIN },
    ...(method === 'POST' ? { data: {} } : {}),
  });
}

async function availability(context, enabled) {
  const response = await request(context, '/api/maintenance');
  assert.equal(response.status(), 200, 'Public maintenance status stays available');
  assert.equal(response.headers()['cache-control'], 'no-store');
  assert.deepEqual(await response.json(), { enabled, message: enabled ? MESSAGE : null });
}

async function version(context) {
  const response = await request(context, '/api/health/version');
  assert.equal(response.status(), 200, 'Version endpoint stays available');
  assert.equal(response.headers()['cache-control'], 'no-store');
  assert.equal((await response.json()).maintenanceControl, 'v1');
}

async function controlState(page, enabled) {
  assert.equal(new URL(page.url()).pathname, CONTROL, 'SysAdmin retains the maintenance console');
  await page.getByRole('heading', { name: 'Modo mantenimiento', exact: true }).waitFor();
  await page.getByText(`Estado: ${enabled ? 'Activado' : 'Desactivado'}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Confirmar lectura y continuar', exact: true }).count(), 0, 'Unread announcements cannot obstruct the recovery console');
  assert.equal(await page.locator('[data-tutorial-ui="true"]').count(), 0, 'Pending tutorial cannot take over the recovery console');
}

async function toggle(enabled) {
  const { page } = admin;
  const label = enabled ? 'Activar mantenimiento' : 'Desactivar mantenimiento y reabrir';
  const confirmation = page.getByRole('checkbox', { name: enabled
    ? 'Confirmo que se pausará la operación del personal hasta que desactive este modo.'
    : 'Confirmo que la actualización terminó y se puede reabrir la operación.', exact: true });
  await confirmation.check();
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === CONTROL),
    page.getByRole('button', { name: label, exact: true }).click(),
  ]);
  assert.ok(response.ok() || response.status() === 303, 'Confirmed maintenance action succeeds');
  await controlState(page, enabled);
  await availability(admin.context, enabled);
}

async function blockedPage(page, path) {
  await page.goto(`${ORIGIN}${path}`);
  await page.waitForURL(`${ORIGIN}/mantenimiento`);
  await page.getByRole('heading', { name: 'Mantenimiento programado', exact: true }).waitFor();
  assert.equal(await page.getByRole('status').innerText(), MESSAGE);
  assert.equal(await page.getByRole('button', { name: 'Desactivar mantenimiento y reabrir', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Abrir control de mantenimiento', exact: true }).count(), 0);
  assert.equal(await page.locator('input[name="revision"], input[name="enabled"]').count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Maintenance page fits viewport');
}

async function blockedApi(context, method, path) {
  const response = await request(context, path, method);
  assert.equal(response.status(), 503, `${method} is stopped by maintenance before the handler`);
  assert.equal(response.headers()['cache-control'], 'no-store');
  assert.equal(response.headers()['retry-after'], '60');
  assert.deepEqual(await response.json(), { ok: false, code: 'MAINTENANCE', error: MESSAGE });
}

async function auditCount() { return db.auditLog.count({ where: { entity: 'SystemMaintenance' } }); }

async function auditedState(enabled, expectedCount) {
  const row = await db.systemSetting.findUniqueOrThrow({ where: { key: SETTING } });
  assert.equal(row.value.enabled, enabled);
  assert.equal(row.value.message, MESSAGE);
  assert.equal(row.updatedById, fixture.users.admin.id);
  assert.equal(enabled ? Number.isFinite(Date.parse(row.value.startedAt)) : row.value.startedAt === null, true);
  const audit = await db.auditLog.findFirstOrThrow({ where: { entity: 'SystemMaintenance', entityId: row.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(audit.action, 'CONFIGURAR');
  assert.equal(audit.userId, fixture.users.admin.id);
  assert.ok(audit.sessionId, 'Maintenance change has its authenticated session');
  assert.equal(audit.before.enabled, !enabled);
  assert.equal(audit.after.enabled, enabled);
  assert.equal(await auditCount(), expectedCount, 'Exactly one audit entry per confirmed transition');
  await assertInterruptionUnchanged();
}

const tutorialSelect = { tutorialDoneAt: true, tutorialKnownModules: true };

async function pendingAnnouncements() {
  return db.announcement.count({ where: {
    active: true, deletedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    AND: [{ OR: [{ scope: 'TODOS' }, { scope: 'USUARIO', targetUserId: fixture.users.admin.id }] },
      { reads: { none: { userId: fixture.users.admin.id } } }],
  } });
}

async function seedInterruption(width) {
  assert.equal(await pendingAnnouncements(), 0, 'Isolated fixture starts without unrelated blocking announcements');
  const original = await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id }, select: { ...tutorialSelect, updatedAt: true } });
  if (width === 1280) {
    assert.ok(original.tutorialDoneAt, 'Announcement case uses the fixture with tutorial already complete');
    const announcement = await db.announcement.create({ data: {
      title: 'SYNTHETIC MAINTENANCE RECOVERY · unread personal announcement',
      body: 'Disposable UI recovery fixture. Keep this announcement unread throughout the maintenance test.',
      scope: 'USUARIO', targetUserId: fixture.users.admin.id, createdById: fixture.users.worker.id,
      active: true, expiresAt: null, isDemo: true,
    }, select: { id: true } });
    interruption = { kind: 'unread-announcement', announcementId: announcement.id, original,
      expectedTutorial: { tutorialDoneAt: original.tutorialDoneAt, tutorialKnownModules: original.tutorialKnownModules } };
  } else {
    const pending = await db.user.update({ where: { id: fixture.users.admin.id },
      data: { tutorialDoneAt: null, tutorialKnownModules: { set: [] } }, select: tutorialSelect });
    interruption = { kind: 'pending-tutorial', original, expectedTutorial: pending };
  }
  await assertInterruptionUnchanged();
}

async function assertInterruptionUnchanged() {
  assert.ok(interruption, 'An independent interruption fixture is prepared');
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id }, select: tutorialSelect }),
    interruption.expectedTutorial, 'Recovery never completes, dismisses or changes tutorial progress');
  assert.equal(await pendingAnnouncements(), interruption.announcementId ? 1 : 0,
    'Each case retains only its own pending interruption');
  if (interruption.announcementId) {
    assert.equal(await db.announcementRead.count({ where: { announcementId: interruption.announcementId, userId: fixture.users.admin.id } }),
      0, 'Recovery never confirms an unread announcement for the administrator');
  } else {
    assert.equal(interruption.expectedTutorial.tutorialDoneAt, null);
    assert.deepEqual(interruption.expectedTutorial.tutorialKnownModules, []);
  }
}

async function restoreInterruption() {
  if (!interruption) return;
  const prepared = interruption;
  await db.$transaction(async tx => {
    if (prepared.announcementId) {
      // Only this disposable announcement, including any unexpected synthetic read, is removed.
      await tx.announcement.delete({ where: { id: prepared.announcementId } });
    } else {
      await tx.user.update({ where: { id: fixture.users.admin.id }, data: {
        tutorialDoneAt: prepared.original.tutorialDoneAt,
        tutorialKnownModules: { set: prepared.original.tutorialKnownModules },
        updatedAt: prepared.original.updatedAt,
      } });
    }
  });
  interruption = undefined;
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id }, select: tutorialSelect }),
    { tutorialDoneAt: prepared.original.tutorialDoneAt, tutorialKnownModules: prepared.original.tutorialKnownModules },
    'Original synthetic tutorial state restored');
  assert.equal(await pendingAnnouncements(), 0, 'Synthetic blocking announcement removed');
  evidence({ phase: 'fixture-restored', interruption: prepared.kind });
}

async function reopenIfActive() {
  // Read committed state even if activation succeeded before a response/DOM assertion failed.
  const row = await db.systemSetting.findUnique({ where: { key: SETTING }, select: { value: true } });
  if (row?.value?.enabled) {
    assert.ok(admin, 'An administrator browser session is required to reopen');
    await admin.page.goto(`${ORIGIN}${CONTROL}`);
    await controlState(admin.page, true);
    await toggle(false);
    evidence({ phase: 'cleanup', maintenance: 'disabled-through-admin-ui' });
  }
  if (admin) await availability(admin.context, false);
}

// Read-only fingerprints cover all business rows and permissions, including updates,
// not merely row counts. No row content, credentials or fingerprints are logged.
async function businessSnapshot() {
  const tables = await db.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('SystemSetting', 'AuditLog', 'Session', 'LoginAttempt', '_prisma_migrations')
    ORDER BY table_name`;
  const snapshot = new Map();
  const sources = tables.map(({ table_name }) => [table_name, Prisma.raw(`SELECT * FROM "${table_name.replaceAll('"', '""')}"`)]);
  sources.push(['otherSettings', Prisma.sql`SELECT * FROM "SystemSetting" WHERE key <> ${SETTING}`]);
  sources.push(['otherAudit', Prisma.sql`SELECT * FROM "AuditLog" WHERE entity <> 'SystemMaintenance'`]);
  for (const [name, source] of sources) {
    const [row] = await db.$queryRaw(Prisma.sql`
      SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb)::text) AS fingerprint
      FROM (${source}) t`);
    snapshot.set(name, row.fingerprint);
  }
  return snapshot;
}

async function assertUnchanged(before) {
  const after = await businessSnapshot();
  assert.equal(after.size, before.size, 'No business tables were added or removed');
  for (const [name, fingerprint] of before) assert.ok(after.get(name) === fingerprint, `Unrelated database rows changed: ${name}`);
}

try {
  browser = await chromium.launch({ headless: true });
  admin = await actor('admin', 1280);
  guest = await actor(null, 1280);
  const adminUser = await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id }, select: { role: { select: { key: true } } } });
  const workerUser = await db.user.findUniqueOrThrow({ where: { id: fixture.users.worker.id }, select: { role: { select: { key: true } } } });
  assert.equal(adminUser.role.key, 'ADMINISTRADOR_SISTEMA');
  assert.notEqual(workerUser.role.key, 'ADMINISTRADOR_SISTEMA');
  evidence({ phase: 'started', browser: browser.version(), viewports: [1280, 390] });

  for (const width of [1280, 390]) {
    activePhase = `viewport-${width}`;
    await admin.page.setViewportSize({ width, height: 900 });
    const worker = await actor('worker', width);
    try {
      await seedInterruption(width);
      await availability(worker.context, false);
      await version(worker.context);
      await admin.page.goto(`${ORIGIN}${CONTROL}`);
      await controlState(admin.page, false);
      const initialAuditCount = await auditCount();
      await worker.page.goto(`${ORIGIN}/perfil`);
      assert.equal(new URL(worker.page.url()).pathname, '/perfil', 'Ordinary fixture session authenticates');
      await worker.page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
      assert.equal((await request(worker.context, '/api/chat/saved')).status(), 200);
      const before = await businessSnapshot();

      activePhase = `confirmation-${width}`;
      const confirmation = admin.page.getByRole('checkbox', { name: 'Confirmo que se pausará la operación del personal hasta que desactive este modo.', exact: true });
      assert.equal(await confirmation.isChecked(), false);
      assert.equal(await confirmation.evaluate(input => input.required), true);
      const postsBefore = admin.maintenancePosts();
      await admin.page.getByRole('button', { name: 'Activar mantenimiento', exact: true }).click();
      assert.equal(await confirmation.evaluate(input => input.validity.valueMissing), true);
      assert.equal(admin.maintenancePosts(), postsBefore, 'Unchecked confirmation cannot submit');
      await availability(worker.context, false);
      assert.equal(await auditCount(), initialAuditCount);

      activePhase = `activate-${width}`;
      await toggle(true);
      await auditedState(true, initialAuditCount + 1);
      activePhase = `blocked-access-${width}`;
      await blockedPage(worker.page, '/');
      await blockedPage(worker.page, CONTROL);
      await blockedApi(worker.context, 'GET', '/api/chat/saved');
      // Intentionally invalid, non-writing input also proves the gate runs before validation.
      await blockedApi(worker.context, 'POST', '/api/operational-actions/task-status');
      await availability(worker.context, true);
      await version(guest.context);
      await availability(guest.context, true);
      if (width === 1280) await blockedPage(guest.page, '/mantenimiento');
      assert.equal((await request(admin.context, '/api/chat/saved')).status(), 200, 'SysAdmin API exemption remains usable');
      activePhase = `reload-persistence-${width}`;
      await admin.page.reload();
      await controlState(admin.page, true);
      await worker.page.reload();
      await worker.page.getByRole('status').waitFor();
      assert.equal(await worker.page.getByRole('status').innerText(), MESSAGE);
      assert.equal(new URL(worker.page.url()).pathname, '/mantenimiento');
      assert.ok(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Admin maintenance control fits viewport');
      await auditedState(true, initialAuditCount + 1);
      await assertUnchanged(before);

      activePhase = `reopen-${width}`;
      await toggle(false);
      await auditedState(false, initialAuditCount + 2);
      await worker.page.goto(`${ORIGIN}/perfil`);
      await worker.page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
      assert.equal(new URL(worker.page.url()).pathname, '/perfil');
      assert.equal((await request(worker.context, '/api/chat/saved')).status(), 200, 'Ordinary reads resume');
      const invalidPost = await request(worker.context, '/api/operational-actions/task-status', 'POST');
      assert.equal(invalidPost.status(), 400, 'Ordinary POST reaches native validation without writing');
      assert.notEqual((await invalidPost.json()).code, 'MAINTENANCE');
      await availability(worker.context, false);
      activePhase = `non-admin-control-${width}`;
      await worker.page.goto(`${ORIGIN}${CONTROL}`);
      await worker.page.waitForURL(`${ORIGIN}/sin-permisos`);
      await worker.page.getByRole('heading', { name: 'No tienes acceso a esta sección', exact: true }).waitFor();
      assert.equal(await worker.page.getByRole('button', { name: /mantenimiento/ }).count(), 0);
      await assertUnchanged(before);
      const result = { width, interruption: interruption.kind, pendingInterruptionPreserved: true, confirmationRequired: true, auditedUiTransitions: 2, exactNotice: true, ordinaryGetPost503: true, noStore: true, adminExemption: true, reloadPersistence: true, nonAdminControlDenied: true, operationReopened: true, publicReadOnlyStatus: true, unrelatedRowsUnchanged: true };
      results.push(result);
      evidence({ phase: 'passed', ...result });
    } finally {
      try {
        await reopenIfActive();
        await restoreInterruption();
      } finally { await worker.context.close(); }
    }
  }
} catch (error) {
  failure = error;
  evidence({ phase: 'failed', at: activePhase, ...failureDetails(error) });
} finally {
  // Always reopen through the authenticated UI before restoring test-only setup.
  // No direct maintenance reset, acknowledgement or tutorial completion is used.
  try {
    await reopenIfActive();
    await restoreInterruption();
  } catch (error) {
    evidence({ phase: 'cleanup-failed', ...failureDetails(error) });
    failure ??= error;
  } finally {
    await browser?.close();
    await db.$disconnect();
    evidence({ phase: 'finished', passed: !failure, completedViewports: results.length, artifacts: false });
  }
}
if (failure) process.exitCode = 1;
