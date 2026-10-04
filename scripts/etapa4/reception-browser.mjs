import '../etapa1/guard.cjs';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const f = JSON.parse(readFileSync('/tmp/etapa1-fixture.json', 'utf8'));
const db = new PrismaClient(), browser = await chromium.launch({ headless: true }), results = [];
async function actor(key, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: 'lor_session', value: f.users[key].token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', route => { const u = new URL(route.request().url()); return u.hostname !== 'localhost' || ['/api/notifications/stream', '/api/alarms', '/api/auth/pulse'].some(p => u.pathname.startsWith(p)) ? route.abort() : route.continue(); });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  return { context, page };
}
try {
  await db.cashFund.updateMany({ data: { active: false } });
  const type = await db.handoverElementType.upsert({ where: { name: 'PRUEBA AUTOMÁTICO DE IA · Llave UI' }, create: { name: 'PRUEBA AUTOMÁTICO DE IA · Llave UI' }, update: { active: true } });
  for (const width of [1280, 390]) {
    const outgoing = await db.shift.create({ data: { type: 'DIA', date: new Date(), status: 'CERRADO', createdById: f.users.admin.id, plannedStart: new Date(Date.now()-86400000), plannedEnd: new Date(Date.now()-43200000), actualEnd: new Date() } });
    const incoming = await db.shift.create({ data: { type: 'NOCHE', date: new Date(), status: 'INICIADO', createdById: f.users.worker.id, plannedStart: new Date(), plannedEnd: new Date(Date.now()+43200000), actualStart: new Date() } });
    await db.shiftAssignment.create({ data: { shiftId: incoming.id, userId: f.users.worker.id, activatedAt: new Date() } });
    if (width === 390) await db.shiftAssignment.create({ data: { shiftId: incoming.id, userId: f.users.admin.id, activatedAt: new Date() } });
    const handover = await db.shiftHandover.create({ data: { fromShiftId: outgoing.id, toShiftId: incoming.id, issuedById: f.users.admin.id, status: 'ENVIADA', issuedAt: new Date(), receiverBriefingReviewedAt: new Date() } });
    const element = await db.handoverElement.create({ data: { handoverId: handover.id, elementTypeId: type.id, declared: true } });
    const receiver = await actor('worker', width), supervisor = await actor('admin', width);
    const path = `http://localhost:3000/turno/entrega/${handover.id}`;
    await receiver.page.goto(path);
    await receiver.page.getByText('No recibido', { exact: true }).click();
    const form = receiver.page.locator('form').filter({ has: receiver.page.locator(`input[name=elementId][value="${element.id}"]`) });
    await form.locator('textarea[name=reason]').fill('PRUEBA AUTOMÁTICO DE IA · llave no recibida; localizar con saliente '+ 'x'.repeat(300));
    await form.getByRole('button', { name: 'Registrar no recibido', exact: true }).click();
    await receiver.page.getByText('Supervisión debe revisar esta diferencia antes de continuar.', { exact: true }).waitFor();
    await supervisor.page.goto(path);
    await supervisor.page.getByText('Revisar excepción', { exact: true }).click();
    const approval = supervisor.page.locator('form').filter({ has: supervisor.page.getByRole('button', { name: 'Autorizar continuidad con diferencia', exact: true }) });
    await approval.locator('textarea[name=reason]').fill('Supervisión localiza con saliente; se permite continuidad con diferencia registrada');
    await approval.getByRole('button', { name: 'Autorizar continuidad con diferencia', exact: true }).click();
    await supervisor.page.getByText(/Continuidad autorizada por/).first().waitFor();
    await receiver.page.reload();
    await receiver.page.getByText(/No acredita posesión física/).first().waitFor();
    assert.ok(await receiver.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.equal(await receiver.page.getByText('Revisar excepción', { exact: true }).count(), 0);
    await receiver.page.getByText('Corregir no recibido', { exact: true }).click();
    const correction = receiver.page.locator('form').filter({ has: receiver.page.getByRole('button', { name: 'Registrar no recibido', exact: true }) });
    await correction.locator('textarea[name=reason]').fill('PRUEBA AUTOMÁTICO DE IA · diferencia corregida, localizar llave con Supervisor');
    await correction.getByRole('button', { name: 'Registrar no recibido', exact: true }).click();
    await receiver.page.getByText('Supervisión debe revisar esta diferencia antes de continuar.', { exact: true }).waitFor();
    assert.equal((await db.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).missingApprovedAt, null);
    await supervisor.page.reload();
    await supervisor.page.getByText('Revisar excepción', { exact: true }).click();
    const updatedApproval = supervisor.page.locator('form').filter({ has: supervisor.page.getByRole('button', { name: 'Autorizar continuidad con diferencia', exact: true }) });
    await updatedApproval.locator('textarea[name=reason]').fill('Supervisor responsable de localizar y registrar devolución física');
    await updatedApproval.getByRole('button', { name: 'Autorizar continuidad con diferencia', exact: true }).click();
    await supervisor.page.getByText(/Continuidad autorizada por/).first().waitFor();
    assert.ok(await receiver.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const stored = await db.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    assert.equal(stored.confirmed, false); assert.equal(stored.missingApprovedById, f.users.admin.id);
    await db.shiftAssignment.updateMany({ where: { shiftId: incoming.id }, data: { leftAt: new Date() } });
    await db.shift.update({ where: { id: incoming.id }, data: { status: 'CERRADO', actualEnd: new Date() } });
    results.push({ width, reportedMissing: true, independentApproval: true, physicalConfirmation: false, correctionInvalidatesApproval: true, supervisorInReceivingShift: width === 390, overflow: false });
    await receiver.context.close(); await supervisor.context.close();
  }
} finally {
  writeFileSync('etapa4-reception-browser-results.json', JSON.stringify({ results }, null, 2));
  await browser.close(); await db.$disconnect();
}
console.log('Recepción veraz comprobada en escritorio y móvil sintéticos.');
