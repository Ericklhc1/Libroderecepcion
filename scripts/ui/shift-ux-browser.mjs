import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SignJWT } from 'jose';

const base = 'http://localhost:3000';
const actionable = request => request.method() === 'POST' && Boolean(request.headers()['next-action']);
const specs = {
  cancel: { trigger: 'Cancelar cierre', title: '¿Estás seguro/a de que quieres cancelar el cierre?', confirm: 'SÍ, CANCELAR CIERRE', back: 'CONTINUAR CON EL CIERRE' },
  send: { trigger: 'REVISAR Y ENVIAR ENTREGA', title: '¿Estás seguro/a de que quieres enviar la entrega?', confirm: 'SÍ, ENVIAR ENTREGA', back: 'VOLVER A REVISAR' },
  close: { trigger: 'CERRAR MI TURNO', title: '¿Confirmas el cierre definitivo de tu turno?', confirm: 'SÍ, CERRAR TURNO', back: 'VOLVER' },
  guided: { trigger: 'Cerrar mi turno', title: 'Último paso: cerrar el turno', confirm: 'CERRAR TURNO', back: 'Volver' },
};
const cashError = 'Falta el arqueo de caja. Cuenta el efectivo por denominación antes de entregar el turno.';

// This helper is called by the existing guarded surfaces journey. It creates
// only synthetic fixtures, keeps its evidence in that journey's existing log,
// and never changes server responses to manufacture a result.
export async function exerciseShiftUx({ browser, db, results }) {
  assert.equal(Boolean(process.env.SMTP_HOST), false, 'Synthetic sends require no SMTP environment transport');
  for (const width of [1280, 390]) {
    const journeyStarted = Date.now();
    console.log('SHIFT_UX_STAGE', JSON.stringify({ width, step: 'reset-fixture', elapsedMs: 0 }));
    // Earlier journeys have deliberately left operational fixtures behind.
    // All their contexts are closed before this final surfaces helper starts.
    execFileSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), ['scripts/etapa1/fixture.mts'], { stdio: 'pipe' });
    const fixture = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
    assert.equal(await db.mailSettings.count(), 0, 'Synthetic sends require no database SMTP transport');
    await db.cashFund.updateMany({ data: { active: false } });
    await db.handoverElementType.updateMany({ data: { active: false } });
    const originalRole = await db.role.findUniqueOrThrow({ where: { key: 'RECEPCIONISTA' } });
    const deniedRole = await db.role.findUniqueOrThrow({ where: { key: 'MUCAMA' } });
    const terms = await db.legalAcceptance.findFirstOrThrow({ where: { userId: fixture.users.admin.id }, select: { document: true, version: true } });
    const tutorial = await db.user.findUniqueOrThrow({ where: { id: fixture.users.admin.id }, select: { tutorialKnownModules: true } });
    const contexts = [];
    let activePage;
    let step='setup';
    function mark(next) { step = next; console.log('SHIFT_UX_STAGE', JSON.stringify({ width, step, elapsedMs: Date.now() - journeyStarted })); }

    async function actor(label) {
      const user = await db.user.create({ data: {
        name: `SYNTHETIC SHIFT UX ${label} ${width}`, username: `shiftux_${randomUUID().slice(0, 12)}`,
        passwordHash: 'synthetic-no-login', roleId: originalRole.id, departmentId: fixture.areaId,
        mustChangePassword: false, frontiAccessEnabled: true, tutorialDoneAt: new Date(), tutorialKnownModules: tutorial.tutorialKnownModules,
      } });
      await db.legalAcceptance.create({ data: { userId: user.id, ...terms } });
      const expiresAt = new Date(Date.now() + 3600000);
      const session = await db.session.create({ data: { userId: user.id, expiresAt } });
      const token = await new SignJWT({ sub: user.id, sid: session.id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      contexts.push(context);
      await context.addCookies([{ name: 'lor_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(p => url.pathname.startsWith(p)) ? route.abort() : route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      const posts = [], frontiPosts = [], errors = [];
      page.on('request', request => {
        if (actionable(request)) posts.push(new URL(request.url()).pathname);
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/fronti') frontiPosts.push(true);
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && /hydration|did.n.t match|server rendered html/i.test(message.text())) errors.push(message.text()); });
      return { user, page, context, posts, frontiPosts, errors };
    }
    async function shiftFor(user, status = 'ACTIVO', sent = false) {
      const now = new Date();
      const shift = await db.shift.create({ data: { type: 'NOCHE', date: now, status, plannedStart: new Date(Date.now() - 3600000), plannedEnd: new Date(Date.now() + 3600000), actualStart: now, createdById: user.id } });
      await db.shiftAssignment.create({ data: { shiftId: shift.id, userId: user.id, activatedAt: now } });
      const handover = status === 'ACTIVO' ? null : await db.shiftHandover.create({ data: {
        fromShiftId: shift.id, issuedById: user.id, status: sent ? 'ENVIADA' : 'BORRADOR',
        issuedAt: sent ? now : null, pendingsReviewedAt: now, finalReviewAt: now, urgentAcknowledgedAt: now,
      } });
      return { shift, handover };
    }
    async function draft(page, marker) {
      await page.getByRole('button', { name: 'Abrir Fronti', exact: true }).click();
      const fronti = page.getByRole('region', { name: 'Fronti', exact: true });
      await fronti.getByRole('textbox', { name: 'Mensaje para Fronti', exact: true }).fill(marker);
      await fronti.getByRole('button', { name: 'Minimizar Fronti', exact: true }).click();
      return { marker, timeOrigin: await page.evaluate(() => performance.timeOrigin) };
    }
    async function preserved(actor, state) {
      assert.equal(await actor.page.evaluate(() => performance.timeOrigin), state.timeOrigin, 'The same document must retain the unsent global draft');
      await actor.page.getByRole('button', { name: 'Abrir Fronti', exact: true }).click();
      const fronti = actor.page.getByRole('region', { name: 'Fronti', exact: true });
      assert.equal(await fronti.getByRole('textbox', { name: 'Mensaje para Fronti', exact: true }).inputValue(), state.marker);
      await fronti.getByRole('button', { name: 'Minimizar Fronti', exact: true }).click();
      assert.deepEqual(actor.frontiPosts, [], 'Examining the draft must not send a prompt');
      assert.deepEqual(actor.errors, [], 'No client or hydration exceptions are permitted');
    }
    async function focused(page, locator) {
      await page.waitForFunction(element => element === document.activeElement, await locator.elementHandle());
    }
    async function inside(page, dialog) {
      await page.waitForFunction(element => element.contains(document.activeElement), await dialog.elementHandle());
    }
    async function openDialog(actor, spec) {
      activePage = actor.page;
      const trigger = actor.page.getByRole('button', { name: spec.trigger, exact: true });
      await trigger.click();
      const dialog = actor.page.getByRole('dialog', { name: spec.title, exact: true });
      await dialog.waitFor(); await inside(actor.page, dialog);
      return { trigger, dialog };
    }
    async function dismissals(actor, spec, shiftId) {
      const postCount = actor.posts.length;
      const overflow = await actor.page.evaluate(() => document.body.style.overflow);
      for (const method of ['escape', 'x', 'back']) {
        const { trigger, dialog } = await openDialog(actor, spec);
        assert.equal(await actor.page.evaluate(() => document.body.style.overflow), 'hidden');
        const form = dialog.locator('form');
        assert.equal(await form.locator('input[name=shiftId]').inputValue(), shiftId);
        assert.ok(await dialog.locator('button[type=submit]').evaluate(button => button.form === button.closest('[role=dialog]').querySelector('form')), 'Submit remains attached to the real form through its portal');
        await dialog.focus();
        await actor.page.keyboard.press('Shift+Tab'); await focused(actor.page, dialog.locator('button[type=submit]'));
        await actor.page.keyboard.press('Tab'); await focused(actor.page, dialog.getByRole('button', { name: 'Cerrar', exact: true }));
        if (method === 'escape') await actor.page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: method === 'x' ? 'Cerrar' : spec.back, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' }); await focused(actor.page, trigger);
        assert.equal(await actor.page.evaluate(() => document.body.style.overflow), overflow);
      }
      assert.equal(actor.posts.length, postCount, 'Dismissal must not send an operational action');
    }
    async function whileUserLocked(work) {
      let acquired, unlock;
      const locked = new Promise(resolve => { acquired = resolve; });
      const release = new Promise(resolve => { unlock = resolve; });
      const transaction = db.$transaction(async tx => {
        await tx.$executeRawUnsafe('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
        acquired(); await release;
      }, { timeout: 20000, maxWait: 3000 });
      await Promise.race([locked, transaction.then(() => { throw new Error('Synthetic lock ended before acquisition'); })]);
      try { return await work(); }
      finally { unlock(); await transaction; }
    }
    async function submitPending(actor, spec, dialog) {
      const before = actor.posts.length;
      const route = new URL(actor.page.url()).pathname;
      const response = actor.page.waitForResponse(value => actionable(value.request()) && new URL(value.url()).pathname === route);
      await whileUserLocked(async () => {
        await dialog.getByRole('button', { name: spec.confirm, exact: true }).dblclick();
        await dialog.getByRole('status').filter({ hasText: 'La operación ya está en curso.' }).waitFor();
        assert.ok(await dialog.locator('button[type=submit]').isDisabled());
        assert.ok(await dialog.getByRole('button', { name: spec.back, exact: true }).isDisabled());
        assert.equal(await dialog.getByRole('button', { name: 'Cerrar', exact: true }).count(), 0);
        await actor.page.keyboard.press('Escape'); await actor.page.mouse.click(4, 4);
        assert.ok(await dialog.isVisible(), 'Pending cannot pretend to cancel an already submitted operation');
        await dialog.locator('button[type=submit]').evaluate(button => button.click());
        assert.equal(actor.posts.length - before, 1, 'One server action despite a double click and disabled resubmission');
      });
      const actual = await response; await actual.finished();
      assert.equal(actor.posts.length - before, 1);
      return actual;
    }
    async function assertError(dialog, text, response) {
      await dialog.getByRole('alert').filter({ hasText: text }).waitFor();
      assert.ok(await dialog.isVisible());
      assert.ok((await response.text()).includes(text), 'The visible error came from the real Server Action response');
      assert.equal(await dialog.locator('button[type=submit]').isDisabled(), false);
    }
    async function cash(active) {
      await db.cashFund.upsert({ where: { currency: 'CLP' }, create: { currency: 'CLP', amount: 1, active }, update: { active } });
    }
    async function closed(shiftId, actor) {
      const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId } });
      assert.equal(shift.status, 'CERRADO'); assert.ok(shift.actualEnd); assert.equal(shift.closedById, actor.user.id);
      const assignment = await db.shiftAssignment.findUniqueOrThrow({ where: { shiftId_userId: { shiftId, userId: actor.user.id } } });
      assert.ok(assignment.leftAt);
      assert.equal(await db.auditLog.count({ where: { entity: 'Shift', entityId: shiftId, action: 'TURNO_CERRAR' } }), 1);
    }
    async function startPreparation(actor, shiftId) {
      activePage = actor.page;
      await actor.page.getByText('Entregar turno', { exact: true }).click();
      await actor.page.getByRole('button', { name: 'INICIAR CIERRE DE TURNO', exact: true }).dblclick();
      const guide = actor.page.getByRole('dialog', { name: 'Vas a iniciar el cierre', exact: true });
      if (width === 390) {
        await guide.waitFor();
        await guide.getByRole('button', { name: 'SÍ, INICIAR CIERRE', exact: true }).dblclick();
      }
      await actor.page.waitForURL(url => /^\/turno\/entrega\/[^/]+$/.test(url.pathname) && url.searchParams.get('paso') === '1');
      const handover = await db.shiftHandover.findUniqueOrThrow({ where: { fromShiftId: shiftId } });
      assert.equal(new URL(actor.page.url()).pathname, `/turno/entrega/${handover.id}`);
      assert.equal(await db.shiftHandover.count({ where: { fromShiftId: shiftId } }), 1);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: shiftId } })).status, 'PREPARANDO_ENTREGA');
      return handover;
    }

    try {
      // Automatic start plus native cancellation of the same prepared draft.
      const outgoing = await actor('outgoing');
      const outgoingFixture = await shiftFor(outgoing.user);
      if (width === 1280) {
        for (let index = 0; index < 5; index++) {
          const ended = new Date(Date.now() - (index + 1) * 86400000);
          const historical = await db.shift.create({ data: { type: 'DIA', date: ended, status: 'CERRADO', plannedStart: new Date(ended.getTime() - 3600000), plannedEnd: ended, actualStart: new Date(ended.getTime() - 3600000), actualEnd: ended, createdById: outgoing.user.id } });
          await db.shiftAssignment.create({ data: { shiftId: historical.id, userId: outgoing.user.id, activatedAt: ended, leftAt: ended } });
        }
      }
      activePage = outgoing.page; mark('prepare-auto-navigation');
      await outgoing.page.goto(base + '/turno');
      const outgoingDraft = await draft(outgoing.page, `UNSENT_SHIFT_PREPARE_${width}`);
      const beforePreparePosts = outgoing.posts.length;
      let handover = await startPreparation(outgoing, outgoingFixture.shift.id);
      assert.equal(outgoing.posts.length - beforePreparePosts, 1);
      assert.equal(await db.auditLog.count({ where: { entity: 'Shift', entityId: outgoingFixture.shift.id, summary: 'Turno en preparación de entrega' } }), 1);
      await preserved(outgoing, outgoingDraft);
      await outgoing.page.goBack(); await outgoing.page.waitForURL(url => url.pathname === '/turno');
      await outgoing.page.goForward(); await outgoing.page.waitForURL(url => url.pathname === `/turno/entrega/${handover.id}`);
      await preserved(outgoing, outgoingDraft);
      mark('cancel-dismissal-and-native-rejection');
      await dismissals(outgoing, specs.cancel, outgoingFixture.shift.id);
      const beforeCancelOverflow = await outgoing.page.evaluate(() => document.body.style.overflow);
      let opened = await openDialog(outgoing, specs.cancel);
      await db.user.update({ where: { id: outgoing.user.id }, data: { roleId: deniedRole.id } });
      let response;
      try { response = await submitPending(outgoing, specs.cancel, opened.dialog); }
      finally { await db.user.update({ where: { id: outgoing.user.id }, data: { roleId: originalRole.id } }); }
      await assertError(opened.dialog, 'No tienes el permiso necesario (shift.handover) para esta acción.', response);
      assert.equal((await db.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).status, 'BORRADOR');
      await opened.dialog.getByRole('button', { name: specs.cancel.back, exact: true }).click();
      await opened.dialog.waitFor({ state: 'hidden' }); await focused(outgoing.page, opened.trigger);
      assert.equal(await outgoing.page.evaluate(() => document.body.style.overflow), beforeCancelOverflow, 'Pending-to-error must not recapture the original trigger or scroll state');
      await preserved(outgoing, outgoingDraft);
      mark('cancel-explicit-retry');
      opened = await openDialog(outgoing, specs.cancel);
      await submitPending(outgoing, specs.cancel, opened.dialog);
      await outgoing.page.waitForURL(url => url.pathname === '/turno');
      await opened.dialog.waitFor({ state: 'hidden' });
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: outgoingFixture.shift.id } })).status, 'ACTIVO');
      assert.equal((await db.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).status, 'ANULADA');
      await preserved(outgoing, outgoingDraft);

      // Prepare again through the real start action; then fixture the review
      // prerequisites so this suite can target Send's own real server gate.
      mark('prepare-after-cancel');
      if (width === 1280) {
        // A deliberate newer Link wins even while both its GET and the action
        // wait for the real database. Never drag the user back after saving.
        mark('new-navigation-supersedes-late-result');
        await outgoing.page.getByText('Entregar turno', { exact: true }).click();
        const before = outgoing.posts.length, navigations = [];
        const navigated = frame => { if (frame === outgoing.page.mainFrame()) navigations.push(new URL(frame.url()).pathname); };
        outgoing.page.on('framenavigated', navigated);
        const response = outgoing.page.waitForResponse(value => actionable(value.request()) && new URL(value.url()).pathname === '/turno');
        try {
          await whileUserLocked(async () => {
            await outgoing.page.getByRole('button', { name: 'INICIAR CIERRE DE TURNO', exact: true }).dblclick();
            await outgoing.page.getByRole('button', { name: 'Iniciando cierre…', exact: true }).waitFor();
            await outgoing.page.getByRole('link', { name: 'Continuar operación', exact: true }).click({ noWaitAfter: true });
          });
          await (await response).finished();
          await outgoing.page.waitForURL(url => url.pathname === '/coordinacion');
          assert.equal(outgoing.posts.length - before, 1);
          assert.ok(navigations.every(value => !value.startsWith('/turno/entrega/')), 'The superseded callback must not navigate, even briefly');
          handover = await db.shiftHandover.findUniqueOrThrow({ where: { fromShiftId: outgoingFixture.shift.id } });
          assert.equal(handover.status, 'BORRADOR');
          assert.equal((await db.shift.findUniqueOrThrow({ where: { id: outgoingFixture.shift.id } })).status, 'PREPARANDO_ENTREGA');
          await preserved(outgoing, outgoingDraft);
        } finally { outgoing.page.off('framenavigated', navigated); }
      } else {
        handover = await startPreparation(outgoing, outgoingFixture.shift.id);
      }
      await db.shiftHandover.update({ where: { id: handover.id }, data: { pendingsReviewedAt: new Date(), finalReviewAt: new Date(), urgentAcknowledgedAt: new Date() } });
      await outgoing.page.goto(`${base}/turno/entrega/${handover.id}?paso=4`);
      const sendDraft = await draft(outgoing.page, `UNSENT_SHIFT_SEND_${width}`);
      mark('send-dismissal-and-native-rejection');
      await dismissals(outgoing, specs.send, outgoingFixture.shift.id);
      opened = await openDialog(outgoing, specs.send);
      await db.shiftHandover.update({ where: { id: handover.id }, data: { finalReviewAt: null } });
      response = await submitPending(outgoing, specs.send, opened.dialog);
      await assertError(opened.dialog, 'Antes de enviar, confirma la revisión final de la entrega.', response);
      assert.equal(await db.auditLog.count({ where: { entity: 'ShiftHandover', entityId: handover.id, action: 'TURNO_ENTREGAR' } }), 0);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: outgoingFixture.shift.id } })).status, 'PREPARANDO_ENTREGA');
      await db.shiftHandover.update({ where: { id: handover.id }, data: { finalReviewAt: new Date() } });
      mark('send-explicit-retry');
      await submitPending(outgoing, specs.send, opened.dialog);
      await outgoing.page.getByRole('button', { name: specs.close.trigger, exact: true }).waitFor();
      await opened.dialog.waitFor({ state: 'hidden' });
      const sent = await db.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
      assert.equal(sent.status, 'ENVIADA'); assert.ok(sent.issuedAt); assert.ok(sent.issuerSessionId);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: outgoingFixture.shift.id } })).status, 'ENTREGA_ENVIADA');
      assert.equal(await db.auditLog.count({ where: { entity: 'ShiftHandover', entityId: handover.id, action: 'TURNO_ENTREGAR' } }), 1);
      assert.equal(await db.operationalMailOutbox.count({ where: { eventKey: `handover-sent:${handover.id}` } }), 1);
      assert.equal(await db.operationalMailOutbox.count({ where: { sentAt: { not: null } } }), 0, 'No synthetic mail may reach an external recipient');
      await preserved(outgoing, sendDraft);

      mark('close-nonguided-native-rejection');
      await dismissals(outgoing, specs.close, outgoingFixture.shift.id);
      opened = await openDialog(outgoing, specs.close); await cash(true);
      response = await submitPending(outgoing, specs.close, opened.dialog);
      await assertError(opened.dialog, cashError, response);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: outgoingFixture.shift.id } })).status, 'ENTREGA_ENVIADA');
      assert.equal(await db.auditLog.count({ where: { entity: 'Shift', entityId: outgoingFixture.shift.id, action: 'TURNO_CERRAR' } }), 0);
      await cash(false); mark('close-nonguided-explicit-retry');
      await submitPending(outgoing, specs.close, opened.dialog);
      await outgoing.page.waitForURL(url => url.pathname === '/turno');
      await opened.dialog.waitFor({ state: 'hidden' });
      await closed(outgoingFixture.shift.id, outgoing); await preserved(outgoing, sendDraft);

      mark('close-guided-native-rejection');
      const guided = await actor('guided'); const guidedFixture = await shiftFor(guided.user, 'ENTREGA_ENVIADA', true);
      activePage = guided.page; await guided.page.goto(base + '/turno');
      const guidedDraft = await draft(guided.page, `UNSENT_SHIFT_GUIDED_${width}`);
      await dismissals(guided, specs.guided, guidedFixture.shift.id);
      opened = await openDialog(guided, specs.guided);
      assert.equal(await opened.dialog.locator('ol > li').count(), 4);
      await cash(true); response = await submitPending(guided, specs.guided, opened.dialog);
      await assertError(opened.dialog, cashError, response);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: guidedFixture.shift.id } })).status, 'ENTREGA_ENVIADA');
      assert.equal(await db.auditLog.count({ where: { entity: 'Shift', entityId: guidedFixture.shift.id, action: 'TURNO_CERRAR' } }), 0);
      await cash(false); mark('close-guided-explicit-retry');
      await submitPending(guided, specs.guided, opened.dialog);
      await opened.dialog.waitFor({ state: 'hidden' });
      await closed(guidedFixture.shift.id, guided); await preserved(guided, guidedDraft);

      mark('reception-auto-navigation');
      const receiver = await actor('receiver'); activePage = receiver.page;
      await receiver.page.goto(base + '/turno');
      const receiverDraft = await draft(receiver.page, `UNSENT_SHIFT_RECEPTION_${width}`);
      const beforeReception = receiver.posts.length;
      await receiver.page.getByRole('button', { name: 'INICIAR RECEPCIÓN DE TURNO', exact: true }).click();
      const guide = receiver.page.getByRole('dialog', { name: 'Vas a recibir el turno anterior', exact: true });
      await guide.getByRole('button', { name: 'SÍ, INICIAR RECEPCIÓN', exact: true }).dblclick();
      await receiver.page.waitForURL(url => url.pathname === `/turno/entrega/${handover.id}`);
      const receivedStart = await db.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
      assert.ok(receivedStart.toShiftId); assert.equal(receivedStart.status, 'ENVIADA'); assert.equal(receivedStart.receivedAt, null);
      assert.equal((await db.shift.findUniqueOrThrow({ where: { id: receivedStart.toShiftId } })).status, 'INICIADO', 'Starting reception must not falsely confirm receipt or enable operation');
      assert.equal(receiver.posts.length - beforeReception, 1);
      assert.equal(await db.auditLog.count({ where: { entity: 'Shift', entityId: receivedStart.toShiftId, action: 'TURNO_INICIAR' } }), 1);
      await preserved(receiver, receiverDraft);
      assert.equal(outgoing.posts.length, 8, 'No queued duplicate starts after the first response');
      assert.equal(guided.posts.length, 2, 'Guided rejection and explicit retry are the only actions');
      assert.equal(receiver.posts.length, 1, 'Reception is started exactly once');
      assert.ok(await receiver.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      results.push({ width, journey: 'shift-ux-targeted', durationMs: Date.now() - journeyStarted, prepareAutomatic: true, receptionAutomatic: true, noManualContinueFallback: true,
        nativeErrorsInsideDialog: ['cancel', 'send', 'close', 'guided-close'], pendingNonDismissible: true, singlePostPerAttempt: true,
        focusAndKeyboard: true, realDatabaseDelay: true, explicitRetry: true, newerNavigationWins: width === 1280 ? true : 'covered-on-desktop', frontiDraftPreserved: true, sameDocument: true,
        noFrontiSubmission: true, noExternalMail: true, noFalseReception: true });
    } catch (error) {
      const observed = activePage ? await activePage.evaluate(() => ({ path: location.pathname, dialogs: [...document.querySelectorAll('[role=dialog]')].map(d => ({ title: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'), alerts: [...d.querySelectorAll('[role=alert]')].map(a => a.textContent), buttons: [...d.querySelectorAll('button')].map(b => ({ text: b.textContent, disabled: b.disabled })) })), activeTag: document.activeElement?.tagName })).catch(() => null) : null;
      results.push({ width, journey: 'shift-ux-targeted', step, status: 'failed', observed });
      console.error('Synthetic shift UX failure', JSON.stringify({ width, step, observed }));
      throw error;
    } finally {
      await db.cashFund.updateMany({ data: { active: false } });
      for (const context of contexts) await context.close();
    }
  }
}
