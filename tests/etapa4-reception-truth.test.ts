import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROLE_KEYS, createUser, prisma, resetOperationalData, seedCatalog, openShiftAs } from './helpers';
import { prepareHandover, receiveHandover, confirmHandoverReviewStep, sendHandover, closeShift, startReceptionShift, confirmReceptionReviewStep } from '@/server/services/shifts';
import { getHandoverCashState, markHandoverElements, cashBlockersForReceiving } from '@/server/services/cash';
import { reportHandoverElementMissing, approveHandoverElementException } from '@/server/services/handover-elements';
import { executeFrontiPageContextTool } from '@/server/ai/fronti-v2/page-context-tool';
import { resolveFrontiPageContext } from '@/server/ai/fronti-v2/page-context';
import type { RoleKey } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';

async function receivingFixture(receiverRole: RoleKey = ROLE_KEYS.RECEPTIONIST) {
  const outgoing = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  const receiver = await createUser({ roleKey: receiverRole });
  const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
  await prisma.handoverElementType.upsert({ where: { name: 'PRUEBA AUTOMÁTICO DE IA · Llave' },
    update: { required: true, active: true }, create: { name: 'PRUEBA AUTOMÁTICO DE IA · Llave', required: true } });
  const shift = await openShiftAs(outgoing, { type: 'DIA' });
  await receiveHandover(outgoing, { shiftId: shift.id });
  const handover = await prepareHandover(outgoing, shift.id);
  const element = (await getHandoverCashState(handover.id)).elements[0]!;
  await markHandoverElements(outgoing, { handoverId: handover.id, field: 'declared', marks: { [element.id]: true } });
  await confirmHandoverReviewStep(outgoing, { handoverId: handover.id, step: 'PENDINGS' });
  await confirmHandoverReviewStep(outgoing, { handoverId: handover.id, step: 'FINAL', urgentAcknowledged: true });
  await sendHandover(outgoing, { shiftId: shift.id });
  await closeShift(outgoing, { shiftId: shift.id });
  await startReceptionShift(receiver, { handoverId: handover.id, type: 'NOCHE' });
  await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
  return { outgoing, receiver, supervisor, handoverId: handover.id, elementId: element.id };
}
async function inputFor(f: { handoverId: string; elementId: string }, reason = 'PRUEBA AUTOMÁTICO DE IA · llave no entregada, localizar con saliente') {
  const element = await prisma.handoverElement.findUniqueOrThrow({ where: { id: f.elementId } });
  return { ...f, reason, revision: element.updatedAt.toISOString() };
}
async function finish(user: CurrentUser, handoverId: string) {
  await confirmReceptionReviewStep(user, { handoverId, step: 'CUSTODY' });
  await confirmReceptionReviewStep(user, { handoverId, step: 'FINAL', urgentAcknowledged: true });
  await receiveHandover(user, { handoverId });
}
describe('AROH Simple · recepción física veraz', () => {
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);
  it('reproduce el bloqueo sin posesión y permite continuar sólo tras revisión independiente, manteniendo No recibido', async () => {
    const f = await receivingFixture();
    await expect(confirmReceptionReviewStep(f.receiver, { handoverId: f.handoverId, step: 'CUSTODY' })).rejects.toThrow(/recibiste|recibidos/);
    const input = await inputFor(f);
    const context = await executeFrontiPageContextTool(f.receiver, resolveFrontiPageContext({ pathname: `/turno/entrega/${f.handoverId}` }));
    expect(JSON.stringify(context)).toContain(f.elementId);
    expect(JSON.stringify(context)).toContain(input.revision);
    await reportHandoverElementMissing(f.receiver, input);
    expect(await cashBlockersForReceiving(f.handoverId)).not.toEqual([]);
    await expect(finish(f.receiver, f.handoverId)).rejects.toThrow();
    const approval = await inputFor(f, 'Supervisión localiza llave con saliente; autoriza continuidad con diferencia registrada');
    await approveHandoverElementException(f.supervisor, approval);
    expect(await cashBlockersForReceiving(f.handoverId)).toEqual([]);
    await finish(f.receiver, f.handoverId);
    const element = await prisma.handoverElement.findUniqueOrThrow({ where: { id: f.elementId } });
    expect(element.confirmed).toBe(false);
    expect(element.missingReason).toBe(input.reason);
    expect(element.missingApprovedById).toBe(f.supervisor.id);
    expect((await prisma.shiftHandover.findUniqueOrThrow({ where: { id: f.handoverId } })).status).toBe('RECIBIDA');
    expect(await prisma.auditLog.count({ where: { entity: 'ShiftHandover', entityId: f.handoverId, summary: { contains: 'No recibido:' } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.supervisor.id, entityId: f.handoverId, title: 'Elemento no recibido en el relevo' } })).toBe(1);
  });
  it('rechaza terceros, ausencia de permiso y autoautorización incluso para Supervisor', async () => {
    const f = await receivingFixture(ROLE_KEYS.SUPERVISOR);
    const stranger = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(reportHandoverElementMissing(stranger, await inputFor(f))).rejects.toThrow(/Sólo quien/);
    await reportHandoverElementMissing(f.receiver, await inputFor(f));
    await expect(approveHandoverElementException(stranger, await inputFor(f))).rejects.toThrow(/permisos/);
    await expect(approveHandoverElementException(f.receiver, await inputFor(f))).rejects.toThrow(/Otra persona/);
  });
  it('serializa reintentos concurrentes y una diferencia corregida invalida una aprobación anterior', async () => {
    const f = await receivingFixture();
    const input = await inputFor(f);
    await Promise.all([reportHandoverElementMissing(f.receiver, input), reportHandoverElementMissing(f.receiver, input)]);
    expect(await prisma.auditLog.count({ where: { entityId: f.handoverId, summary: { contains: 'No recibido:' } } })).toBe(1);
    const approval = await inputFor(f, 'Localizar con saliente y conservar la diferencia');
    await reportHandoverElementMissing(f.receiver, await inputFor(f, 'PRUEBA AUTOMÁTICO DE IA · falta otra llave, requiere revisión nueva'));
    await expect(approveHandoverElementException(f.supervisor, approval)).rejects.toThrow(/cambió/);
    const current = await inputFor(f, 'Supervisión asume localización y continuidad');
    await Promise.all([approveHandoverElementException(f.supervisor, current), approveHandoverElementException(f.supervisor, current)]);
    expect(await prisma.auditLog.count({ where: { entityId: f.handoverId, summary: { startsWith: 'Continuidad autorizada con' } } })).toBe(1);
  });
  it('confirma recuperación física, conserva evidencia previa e invalida revisión final', async () => {
    const f = await receivingFixture();
    await reportHandoverElementMissing(f.receiver, await inputFor(f));
    await approveHandoverElementException(f.supervisor, await inputFor(f, 'Continuar y localizar llave con saliente'));
    await confirmReceptionReviewStep(f.receiver, { handoverId: f.handoverId, step: 'CUSTODY' });
    await confirmReceptionReviewStep(f.receiver, { handoverId: f.handoverId, step: 'FINAL', urgentAcknowledged: true });
    await markHandoverElements(f.receiver, { handoverId: f.handoverId, field: 'confirmed', marks: { [f.elementId]: true } });
    await expect(receiveHandover(f.receiver, { handoverId: f.handoverId })).rejects.toThrow(/custodia/);
    const element = await prisma.handoverElement.findUniqueOrThrow({ where: { id: f.elementId } });
    expect(element.confirmed).toBe(true); expect(element.missingReason).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: f.handoverId, summary: { contains: 'No recibido:' } } })).toBe(1);
    await finish(f.receiver, f.handoverId);
    await expect(markHandoverElements(f.receiver, { handoverId: f.handoverId, field: 'confirmed', marks: { [f.elementId]: false } })).rejects.toThrow(/ya no admite/);
  });
  it('no admite una declaración parcial sin motivo ni estados físicos contradictorios por SQL', async () => {
    const f = await receivingFixture();
    await expect(reportHandoverElementMissing(f.receiver, await inputFor(f, ''))).rejects.toThrow(/Explica/);
    await expect(prisma.handoverElement.update({ where: { id: f.elementId }, data: { missingReportedById: f.receiver.id, missingReportedAt: new Date() } })).rejects.toThrow();
    await reportHandoverElementMissing(f.receiver, await inputFor(f));
    await expect(prisma.handoverElement.update({ where: { id: f.elementId }, data: { confirmed: true } })).rejects.toThrow();
  });
});
