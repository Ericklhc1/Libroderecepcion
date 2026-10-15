import { writeFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { assertClosureQaEnvironment } from './guard.mjs';
import { resetOperationalData, seedCatalog, prisma } from '../../tests/helpers';
import { TUTORIAL_MODULE_KEYS } from '../../src/domain/tutorial-tour';
import { TERMS_DOCUMENT, TERMS_VERSION } from '../../src/domain/legal';
import { hotelCalendarDate } from '../../src/domain/time';

assertClosureQaEnvironment();

// Only initial synthetic states are seeded. Every final cash count, custody
// declaration, send, close and receipt is performed by the native browser flow.
const requiredClosureHumanIds = [1725, 1715, 1700, 1693, 1680, 1673];
const users: Record<string, { id: string; token: string }> = {};
try {
  await resetOperationalData();
  await seedCatalog();
  const department = await prisma.department.findUniqueOrThrow({ where: { key: 'RECEPCION' } });
  for (const [key, roleKey] of Object.entries({ admin: 'ADMINISTRADOR_SISTEMA', worker: 'RECEPCIONISTA', coworker: 'RECEPCIONISTA', receiver: 'RECEPCIONISTA' })) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await prisma.user.create({ data: {
      username: `closure_qa_${key}`, name: `SYNTHETIC CLOSURE ${key}`, passwordHash: 'synthetic-no-login',
      roleId: role.id, departmentId: department.id, mustChangePassword: false,
      tutorialDoneAt: new Date(), tutorialKnownModules: [...TUTORIAL_MODULE_KEYS],
    } });
    await prisma.legalAcceptance.create({ data: { userId: user.id, document: TERMS_DOCUMENT, version: TERMS_VERSION } });
    const expiresAt = new Date(Date.now() + 3 * 3600_000);
    const session = await prisma.session.create({ data: { userId: user.id, expiresAt } });
    const token = await new SignJWT({ sub: user.id, sid: session.id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    users[key] = { id: user.id, token };
  }

  const date = hotelCalendarDate(new Date());
  // Historical placeholders contain no invented cash count, handover, receipt
  // or signature. The checklist must preserve these historical gaps as warnings.
  for (const [index, humanId] of requiredClosureHumanIds.entries()) {
    const historicDate = new Date(date.getTime() - (index + 2) * 86400_000);
    await prisma.shift.create({ data: {
      humanId, date: historicDate, type: 'DIA', status: 'CERRADO',
      plannedStart: historicDate, plannedEnd: new Date(historicDate.getTime() + 3600_000),
      actualStart: historicDate, actualEnd: new Date(historicDate.getTime() + 3600_000),
      createdById: users.admin.id, closedById: users.admin.id, notes: 'SYNTHETIC historical closure; no reconstructed handover or physical evidence.',
    } });
  }
  await prisma.$queryRaw`SELECT setval('human_operational_id_seq', GREATEST((SELECT last_value FROM human_operational_id_seq), 2000))`;
  const shifts: Array<{ id: string; humanId: number; actor: string }> = [];
  for (const [index, key] of ['worker', 'coworker'].entries()) {
    const startedAt = new Date(Date.now() - (index + 1) * 3600_000);
    const shift = await prisma.shift.create({ data: {
      date, type: index ? 'NOCHE' : 'DIA', status: 'ACTIVO', actualStart: startedAt,
      plannedStart: startedAt, plannedEnd: new Date(Date.now() + 3600_000), createdById: users[key].id,
      startedById: users[key].id, assignments: { create: { userId: users[key].id, activatedAt: startedAt } },
    } });
    shifts.push({ id: shift.id, humanId: shift.humanId, actor: key });
  }
  // Preserve the current catalog permissions; enable only synthetic cash and
  // one explicitly named custody item after creating historical rows.
  await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000, updatedById: users.admin.id } });
  await prisma.handoverElementType.updateMany({ data: { active: false } });
  const elementType = await prisma.handoverElementType.upsert({ where: { name: 'SYNTHETIC CLOSURE · Llaves de custodia' },
    create: { name: 'SYNTHETIC CLOSURE · Llaves de custodia', active: true, required: true }, update: { active: true, required: true } });
  const denomination = await prisma.cashDenomination.findFirstOrThrow({ where: { currency: 'CLP', value: 20_000, active: true } });
  const guarantee = await prisma.guarantee.create({ data: { kind: 'EFECTIVO', state: 'VIGENTE', amount: 50_000,
    currency: 'CLP', guestName: 'SYNTHETIC CLOSURE guarantee', createdById: users.worker.id } });
  const fullDescription = 'SYNTHETIC FULL DESCRIPTION\n' + 'Texto íntegro después del antiguo límite de ciento ochenta caracteres. '.repeat(18) + '\nEND OF COMPLETE DESCRIPTION';
  const fullComment = 'SYNTHETIC FULL COMMENT\n' + 'Comentario con trazabilidad, acentos y saltos de línea. '.repeat(18) + '\nEND OF COMPLETE COMMENT';
  const entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'SYNTHETIC CLOSURE complete source',
    description: fullDescription, createdById: users.worker.id, shiftId: shifts[0].id, departmentId: department.id, priority: 'BAJA' } });
  const comment = await prisma.comment.create({ data: { entryId: entry.id, authorId: users.coworker.id, body: fullComment } });
  await prisma.auditLog.create({ data: { entity: 'OperationalEntry', entityId: entry.id, action: 'CREAR', userId: users.worker.id,
    summary: 'SYNTHETIC CLOSURE source trace', after: { description: fullDescription, commentId: comment.id } } });
  // The final record lies beyond the old 2,000-record report limit. These are
  // closed synthetic sources, so the real handover stays human-reviewable.
  await prisma.operationalEntry.createMany({ data: Array.from({ length: 2005 }, (_, index) => ({
    type: 'NOVEDAD' as const, title: `SYNTHETIC CLOSURE history ${String(index).padStart(4, '0')}`,
    description: `Complete historical source ${index}; final marker ${index === 2004 ? 'BEYOND_2000_LIMIT' : 'synthetic'}`,
    status: 'CERRADO' as const, closedAt: new Date(), closedById: users.worker.id, createdById: users.worker.id, departmentId: department.id,
  })) });
  const expectedEntries = await prisma.operationalEntry.count();
  writeFileSync('/tmp/aroh-closure-fixture.json', JSON.stringify({ users, shifts, requiredClosureHumanIds,
    elementTypeId: elementType.id, denominationId: denomination.id, guaranteeId: guarantee.id,
    source: { entryId: entry.id, commentId: comment.id, fullDescription, fullComment }, expectedEntries }), { mode: 0o600 });
  console.log(JSON.stringify({ suite: 'ordered-closure', phase: 'fixture-prepared', shifts: shifts.length, historicalClosures: requiredClosureHumanIds.length, entries: expectedEntries, credentialsPrinted: false }));
} finally { await prisma.$disconnect(); }
