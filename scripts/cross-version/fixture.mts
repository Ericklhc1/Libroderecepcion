import '../etapa1/guard.cjs';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { prisma, resetOperationalData, seedCatalog } from '../../tests/helpers';
import { TUTORIAL_MODULE_KEYS } from '../../src/domain/tutorial-tour';
import { TERMS_DOCUMENT, TERMS_VERSION } from '../../src/domain/legal';
import { hotelCalendarDate } from '../../src/domain/time';
import { plannedWindow } from '../../src/domain/shift';

// This destructive fixture is restricted by the existing loopback-CI guard.
// Starting state is synthetic; all transitions under test happen through UI.
const output = process.argv[2];
const scenario = process.argv[3] ?? 'normal';
if (!['normal', 'custody-exception'].includes(scenario)) throw new Error('Unknown synthetic scenario');
if (!output || !output.startsWith('/tmp/') && !output.startsWith(process.env.RUNNER_TEMP + '/')) {
  throw new Error('A private runner-temp fixture path is required');
}
if ((process.env.AUTH_SECRET ?? '').length < 32) throw new Error('Missing synthetic session key');
try {
  await resetOperationalData();
  await seedCatalog();
  const area = await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } });
  const users: Record<string, { id: string; sessionId: string; token: string }> = {};
  for (const [key, roleKey] of Object.entries({ outgoing: 'RECEPCIONISTA', incoming: 'RECEPCIONISTA', admin: 'ADMINISTRADOR_SISTEMA' })) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await prisma.user.create({ data: {
      name: `PRUEBA SINTÉTICA CONTINUIDAD ${key}`, username: `cross_version_${key}`,
      passwordHash: 'synthetic-no-login', roleId: role.id, departmentId: area.id,
      mustChangePassword: false, tutorialDoneAt: new Date(), tutorialKnownModules: [...TUTORIAL_MODULE_KEYS],
    } });
    await prisma.legalAcceptance.create({ data: { userId: user.id, document: TERMS_DOCUMENT, version: TERMS_VERSION } });
    const expiresAt = new Date(Date.now() + 12 * 3600_000);
    const session = await prisma.session.create({ data: { userId: user.id, expiresAt } });
    const token = await new SignJWT({ sub: user.id, sid: session.id }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    users[key] = { id: user.id, sessionId: session.id, token };
  }
  const date = hotelCalendarDate(), window = plannedWindow(date, 'NOCHE');
  const outgoing = users.outgoing!;
  const shift = await prisma.shift.create({ data: {
    type: 'NOCHE', date, status: 'ACTIVO', plannedStart: window.start, plannedEnd: window.end,
    actualStart: new Date(), createdById: outgoing.id, startedById: outgoing.id,
    assignments: { create: { userId: outgoing.id, activatedAt: new Date() } },
  } });
  await prisma.cashFund.createMany({ data: [{ currency: 'CLP', amount: 20000 }, { currency: 'USD', amount: 20 }] });
  const denominations = await prisma.cashDenomination.findMany({ where: { OR: [{ currency: 'CLP', value: 20000 }, { currency: 'USD', value: 20 }] } });
  if (denominations.length !== 2) throw new Error('Canonical denomination catalog changed');
  const type = await prisma.handoverElementType.create({ data: { name: 'PRUEBA SINTÉTICA · Llaves y teléfono', required: true } });
  const guarantee = await prisma.guarantee.create({ data: {
    kind: 'EFECTIVO', state: 'VIGENTE', currency: 'CLP', amount: 10000,
    reference: 'PRUEBA SINTÉTICA GARANTÍA', createdById: outgoing.id,
  } });
  await prisma.cashMovement.create({ data: {
    id: randomUUID(), kind: 'GARANTIA_INGRESO', direction: 'ENTRADA', currency: 'CLP', amount: 10000,
    guaranteeId: guarantee.id, shiftId: shift.id, createdById: outgoing.id, reference: guarantee.reference,
  } });
  const entry = await prisma.operationalEntry.create({ data: {
    type: 'NOVEDAD', title: 'PRUEBA SINTÉTICA · pendiente nocturno', description: 'Continuar al relevo sin duplicarlo',
    priority: 'MEDIA', createdById: outgoing.id, ownerId: outgoing.id, departmentId: area.id, shiftId: shift.id,
  } });
  const task = await prisma.task.create({ data: {
    title: 'PRUEBA SINTÉTICA · tarea pendiente', createdById: outgoing.id,
    departmentId: area.id, shiftId: shift.id, entryId: entry.id,
  } });
  const roomKeys = await prisma.roomKey.findMany({ orderBy: { id: 'asc' } });
  const keyInventoryDigest = createHash('sha256').update(JSON.stringify(roomKeys)).digest('hex');
  // Only the precondition is seeded for the custom-API assay. Reporting,
  // revision rejection, independent approval and corrections use native UI.
  let exception: { handoverId: string; elementId: string; incomingShiftId: string } | undefined;
  if (scenario === 'custody-exception') {
    const now = new Date();
    await prisma.shift.update({ where: { id: shift.id }, data: {
      status: 'CERRADO', actualEnd: now, closedById: outgoing.id,
    } });
    await prisma.shiftAssignment.updateMany({ where: { shiftId: shift.id }, data: { leftAt: now } });
    const incoming = await prisma.shift.create({ data: {
      type: 'DIA', date, status: 'INICIADO', plannedStart: now,
      plannedEnd: new Date(now.getTime() + 12 * 3600_000), actualStart: now,
      createdById: users.incoming!.id, startedById: users.incoming!.id,
      assignments: { create: { userId: users.incoming!.id, activatedAt: now } },
    } });
    const handover = await prisma.shiftHandover.create({ data: {
      fromShiftId: shift.id, toShiftId: incoming.id, status: 'ENVIADA',
      issuedById: outgoing.id, issuerSessionId: outgoing.sessionId, issuedAt: now,
      receiverBriefingReviewedAt: now,
    } });
    const element = await prisma.handoverElement.create({ data: {
      handoverId: handover.id, elementTypeId: type.id, declared: true,
    } });
    exception = { handoverId: handover.id, elementId: element.id, incomingShiftId: incoming.id };
  }
  writeFileSync(output, JSON.stringify({ users, shiftId: shift.id, plannedEnd: window.end.toISOString(),
    denominationIds: denominations.map(d => d.id), elementTypeId: type.id, guaranteeId: guarantee.id,
    entryId: entry.id, taskId: task.id, keyInventoryDigest, roomKeyCount: roomKeys.length, exception,
  }), { mode: 0o600 });
  console.log('Disposable cross-version fixture prepared; no tokens printed.');
} finally { await prisma.$disconnect(); }
