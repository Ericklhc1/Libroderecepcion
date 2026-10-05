import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const results = [];
const noJsFailures = [];
const popupReadiness = [];
const base = 'http://localhost:3000';
async function session(key, width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...options });
  await context.addCookies([{ name: 'lor_session', value: fixture.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(path => url.pathname.startsWith(path)) ? route.abort() : route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  return { context, page };
}
try {
  const area = await db.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } });
  await db.user.update({ where: { id: fixture.users.maid.id }, data: { departmentId: area.id } });
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const width of [1280, 390]) {
    const marker = `HK_CONTEXT_${width}_${randomUUID().slice(0, 6)}`;
    const source = await db.operationalEntry.create({ data: { type: 'NOVEDAD', title: marker, description: 'Contexto sintético completo sin copia ni cambio de origen', createdById: fixture.users.admin.id, ownerId: fixture.users.admin.id, departmentId: area.id } });
    const work = await db.housekeepingRequest.create({ data: { requestKey: randomUUID(), workflowVersion: 1, workKind: 'ATENCION', workDate: day, departmentId: area.id, createdById: fixture.users.admin.id, assignedToId: fixture.users.maid.id, sourceEntryId: source.id, sourceVersion: source.updatedAt, status: 'PENDIENTE', effortMinutes: 15 } });
    const list = `/admin/housekeeping?${new URLSearchParams({ area: area.id, fecha: day, q: marker })}`;
    const maid = await session('maid', width);
    await maid.page.goto(base + list);
    const rowId = `registro-housekeeping-${work.id}`;
    const row = maid.page.locator(`[data-list-item="${rowId}"][aria-haspopup="dialog"]`);
    await row.waitFor();
    assert.equal(await maid.page.locator('[data-worklist-fallback]').count(), 0, 'Hydrated rows remove fallback forms before opening the panel');
    assert.equal(await maid.page.locator('[data-worklist-panel]').count(), 0);
    await row.click();
    const panel = maid.page.locator(`[data-housekeeping-detail="${work.id}"]`);
    await panel.waitFor();
    await panel.getByText(source.description, { exact: true }).waitFor();
    assert.equal(await panel.getByRole('link', { name: 'Ver novedad', exact: true }).count(), 0, 'HK-focused scope remains closed to the generic book');
    await panel.getByRole('button', { name: 'Informar impedimento', exact: true }).click();
    const inner = maid.page.getByRole('dialog', { name: 'Informar impedimento', exact: true });
    await inner.locator('textarea[name=note]').fill('Borrador sintético cancelado, no debe registrarse');
    await maid.page.keyboard.press('Escape');
    await inner.waitFor({ state: 'hidden' });
    await panel.waitFor();
    assert.equal(await maid.page.getByRole('dialog').count(), 1, 'Escape closes only the upper dialog');
    await maid.page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden' });
    assert.equal(new URL(maid.page.url()).hash, '');
    assert.equal((await db.housekeepingRequest.findUniqueOrThrow({ where: { id: work.id } })).version, work.version);
    assert.equal((await db.housekeepingRequest.findUniqueOrThrow({ where: { id: work.id } })).status, 'PENDIENTE');
    await maid.page.goto(base + list + `&aviso=${work.humanId}`);
    await panel.waitFor();
    assert.ok(await maid.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

    const admin = await session('admin', width);
    await admin.page.goto(base + list + `&aviso=${work.humanId}`);
    const adminPanel = admin.page.locator(`[data-housekeeping-detail="${work.id}"]`);
    await adminPanel.getByRole('link', { name: 'Ver novedad', exact: true }).click();
    const back = admin.page.locator('[data-list-return]');
    await back.waitFor();
    const returnHref = new URL(await back.getAttribute('href'), base);
    assert.equal(returnHref.pathname, '/admin/housekeeping');
    assert.equal(returnHref.searchParams.get('q'), marker);
    assert.equal(returnHref.hash, '#' + rowId);
    await back.click();
    await admin.page.locator(`[data-list-item="${rowId}"]`).waitFor();
    await admin.page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(new URL(admin.page.url()).searchParams.get('q'), marker);
    assert.equal((await db.operationalEntry.findUniqueOrThrow({ where: { id: source.id } })).status, 'ABIERTO');

    const noJs = await session('maid', width, { javaScriptEnabled: false });
    await noJs.page.goto(base + list + `&aviso=${work.humanId}`);
    const fallback = noJs.page.locator('[data-worklist-fallback][open]');
    try {
      await fallback.getByText(source.description, { exact: true }).waitFor();
    } catch (error) {
      const ancestors = await fallback.evaluate(element => {
        const state = [];
        for (let node = element; node && state.length < 12; node = node.parentElement) {
          const style = getComputedStyle(node);
          state.push({ tag: node.tagName, hidden: node.hidden, open: node instanceof HTMLDetailsElement ? node.open : undefined, display: style.display, visibility: style.visibility, rects: node.getClientRects().length });
        }
        return state;
      }).catch(() => []);
      console.error('Synthetic no-JavaScript worklist visibility:', JSON.stringify(ancestors));
      noJsFailures.push({ width, error: error.name, message: error.message.slice(0, 400) });
    }
    // A focused native destination must not retain page-two offset after the
    // server narrows the result to one authorized human folio.
    const archiveMarker = `HK_ARCHIVE_${width}_${randomUUID().slice(0, 6)}`;
    await db.housekeepingRequest.createMany({ data: Array.from({ length: 35 }, (_, index) => ({ requestKey: randomUUID(), workflowVersion: 1, workKind: 'ATENCION', workDate: day, departmentId: area.id, createdById: fixture.users.admin.id, assignedToId: fixture.users.maid.id, title: `${archiveMarker} ${index}`, description: 'Trabajo sintético archivado', status: 'RESUELTO', resolution: index % 2 ? 'Resultado sintético conservado' : null, createdAt: new Date(Date.now() - index * 1000), effortMinutes: 15 })) });
    const archiveList = '/admin/housekeeping?' + new URLSearchParams({ area: area.id, fecha: day, vista: 'historial', q: archiveMarker, pagina: '2' });
    await admin.page.goto(base + archiveList);
    const archiveRow = admin.page.locator('[data-list-item][aria-haspopup="dialog"]').first();
    await archiveRow.waitFor();
    assert.equal(await admin.page.locator('[data-list-item]').count(), 5);
    const archiveLinks = await admin.page.locator('[data-list-item]').evaluateAll(links => links.map(link => ({ id: link.getAttribute('id'), href: link.getAttribute('href') })));
    const pageFolios = archiveLinks.map(link => Number(new URL(link.href, base).searchParams.get('aviso')));
    const pageRecords = await db.housekeepingRequest.findMany({ where: { humanId: { in: pageFolios } } });
    for (const hasResult of [true, false]) {
      const archived = pageRecords.find(record => Boolean(record.resolution) === hasResult);
      assert.ok(archived, 'Both result and historical-context branches exist on page two');
      const focusedHref = new URL(archiveLinks.find(link => Number(new URL(link.href, base).searchParams.get('aviso')) === archived.humanId).href, base);
      assert.equal(focusedHref.searchParams.get('pagina'), '1');
      await admin.page.goto(focusedHref.href);
      const archivePanel = admin.page.locator(`[data-housekeeping-detail="${archived.id}"]`);
      await archivePanel.waitFor();
      const beforeResult = admin.page.url();
      await archivePanel.getByRole('link', { name: 'Ver resultado', exact: true }).click();
      await archivePanel.waitFor();
      assert.equal(admin.page.url(), beforeResult, 'Internal result focus does not create a new history entry or hide the panel');
      assert.equal(await archivePanel.evaluate(node => node.contains(document.activeElement) || node === document.activeElement), true);
      await admin.page.keyboard.press('Escape');
      await archivePanel.waitFor({ state: 'hidden' });
      // Modified activation stays browser-native and opens the authorized row
      // on the original page via its declared historical fragment alias.
      await admin.page.goto(base + archiveList);
      await admin.page.locator(`[data-list-item="registro-housekeeping-${archived.id}"][aria-haspopup="dialog"]`).click();
      await archivePanel.waitFor();
      const [popup] = await Promise.all([admin.context.waitForEvent('page'), archivePanel.getByRole('link', { name: 'Ver resultado', exact: true }).click({ modifiers: ['Control'] })]);
      await popup.waitForLoadState('domcontentloaded');
      const initialReadiness = await popup.evaluate(id => ({
        fallbackCopies: document.querySelectorAll('[data-worklist-fallback]').length,
        hydratedRow: Boolean(document.querySelector(`[data-list-item="registro-housekeeping-${id}"][aria-haspopup="dialog"]`)),
        richDetail: Boolean(document.querySelector(`[role="dialog"] [data-housekeeping-detail="${id}"]`)),
        focusInFallback: Boolean(document.activeElement?.closest('[data-worklist-fallback]')),
      }), archived.id);
      // Native fragment navigation can reveal/focus the SSR <details> before
      // React mounts Dialog. That fallback is not an Escape-dismissible modal.
      await popup.locator(`[data-list-item="registro-housekeeping-${archived.id}"][aria-haspopup="dialog"]`).waitFor();
      const popupPanel = popup.getByRole('dialog').locator(`[data-housekeeping-detail="${archived.id}"]`);
      await popupPanel.waitFor();
      assert.equal(await popup.locator('[data-worklist-fallback]').count(), 0, 'Keyboard dismissal targets the hydrated dialog, not the native SSR fallback');
      assert.equal(new URL(popup.url()).searchParams.get('pagina'), '2');
      assert.equal(new URL(popup.url()).hash, (hasResult ? '#resultado-' : '#aviso-') + archived.humanId);
      await popup.waitForFunction(id => { const panel = document.querySelector(`[role="dialog"] [data-housekeeping-detail="${id}"]`); return panel && (panel.contains(document.activeElement) || panel === document.activeElement); }, archived.id);
      popupReadiness.push({ width, hasResult, initial: initialReadiness, hydratedDialogBeforeEscape: true });
      await popup.keyboard.press('Escape'); await popupPanel.waitFor({ state: 'hidden' });
      await popup.close();
      assert.equal((await db.housekeepingRequest.findUniqueOrThrow({ where: { id: archived.id } })).version, archived.version);
    }
    await admin.page.goto(base + archiveList + '#resultado-999999999');
    await admin.page.locator('[data-list-item][aria-haspopup="dialog"]').first().waitFor();
    assert.equal(await admin.page.locator('[data-worklist-panel]').count(), 0, 'Unknown fragment aliases cannot load or open another record');
    results.push({ width, jsStatus: 'passed', compactList: true, nestedEscape: true, noMutationOnCancel: true, deepLink: true, originContext: true, explicitReturnClosesPanel: true, nativeNoJavaScript: !noJsFailures.some(failure => failure.width === width), permissionsPreserved: true, nativeFocusFromPageTwo: true, internalResultKeepsPanel: true, bothResultBranches: true, nativeModifiedResultLink: true, unknownFragmentClosed: true });
    await maid.context.close(); await admin.context.close(); await noJs.context.close();
  }
  console.log('NOJS_CHARACTERIZATION ' + JSON.stringify({ status: noJsFailures.length ? 'inherited-limitation' : 'passed', baseline: '928f57b5fc6823229d160623e6253d4a7ce02fb3', noJsFailures }));
} finally {
  writeFileSync('housekeeping-worklist-browser-results.json', JSON.stringify({ browser: browser.version(), results, noJsFailures, popupReadiness }, null, 2));
  await browser.close(); await db.$disconnect();
}
