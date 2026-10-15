import { createHash, randomUUID } from 'node:crypto';
import { ShiftStatus, ShiftType, type Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma as applicationPrisma } from '@/lib/prisma';
import {
  MAINTENANCE_DEFAULT, REQUIRED_CLOSURE_HUMAN_IDS, SYSTEM_CLOSURE_CONFIRMATION, SYSTEM_CLOSED_MESSAGE,
} from '@/domain/system-maintenance';
import type { CurrentUser } from '@/server/auth/current-user';
import type * as CurrentUserModule from '@/server/auth/current-user';
import { requirePageUser, requirePermission, requireUser } from '@/server/auth/guard';
import { withMaintenance } from '@/server/api/maintenance';
import { assertClosureOperation } from '@/server/services/closure-access';
import { approveMissingElementAction } from '@/server/actions/cash';
import { markHandoverElements } from '@/server/services/cash';
import { reportHandoverElementMissing } from '@/server/services/handover-elements';
import {
  assertMaintenanceAccess, getMaintenanceState, maintenanceBlocksBackground, maintenanceStateFromRow, setSystemMaintenance,
} from '@/server/services/system-maintenance';
import {
  beginSystemClosure, createClosureBackup, getSystemClosureChecklist, lockSystemClosure,
  recoverSystemClosure, verifyClosureBackup,
} from '@/server/services/system-closure';
import {
  closeShift, confirmHandoverReviewStep, confirmReceptionReviewStep, openShift,
  prepareHandover, receiveHandover, sendHandover, startFinalHandoverReception,
} from '@/server/services/shifts';
import { acceptHkHandover, receiveHkHandover, saveHkHandover } from '@/server/services/housekeeping-work';
import { createShift, createUser, prisma, resetOperationalData, ROLE_KEYS, seedCatalog } from './helpers';

const mocks = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock('@/server/auth/current-user', async importOriginal => ({
  ...await importOriginal<typeof CurrentUserModule>(), getCurrentUserFresh: mocks.currentUser,
}));
vi.mock('@/server/services/legal-acceptance', () => ({ hasAcceptedCurrentTerms: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let sysadmin: CurrentUser;
let outgoing: CurrentUser;
let incoming: CurrentUser;

beforeAll(async () => { await seedCatalog(); });
beforeEach(async () => {
  await resetOperationalData();
  sysadmin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administración sintética' });
  outgoing = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Entrega sintética' });
  incoming = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Recepción sintética' });
  mocks.currentUser.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await resetOperationalData(); await prisma.$disconnect(); });

async function begin() {
  return beginSystemClosure(sysadmin, { expectedRevision: (await getMaintenanceState()).revision });
}

/** Historical fixtures are local synthetic evidence, not mutations of real closures. */
async function historicalClosures() {
  for (const humanId of REQUIRED_CLOSURE_HUMAN_IDS) {
    await prisma.shift.create({ data: {
      humanId, date: new Date('2026-09-01T00:00:00Z'), type: 'DIA', status: 'CERRADO',
      plannedStart: new Date('2026-09-01T08:00:00Z'), plannedEnd: new Date('2026-09-01T20:00:00Z'),
      actualStart: new Date('2026-09-01T08:00:00Z'), actualEnd: new Date('2026-09-01T20:00:00Z'),
      startedById: outgoing.id, closedById: outgoing.id,
      handoverOut: { create: {
        issuedById: outgoing.id, issuedAt: new Date('2026-09-01T20:00:00Z'), status: 'RECIBIDA',
        receivedById: incoming.id, receivedAt: new Date('2026-09-01T20:15:00Z'), notes: `Cierre histórico ficticio ${humanId}`,
      } },
    } });
  }
}

async function readyBackup() {
  await historicalClosures();
  await begin();
  return createClosureBackup(sysadmin);
}

async function verifiedBackup() {
  const backup = await readyBackup();
  const verified = await verifyClosureBackup(sysadmin, await verificationInput(backup));
  return { backup, verified };
}

async function verificationInput(backup: { body: string; digest: string }) {
  const state = await getMaintenanceState();
  return {
    expectedRevision: state.revision, uploadedDigest: createHash('sha256').update(backup.body).digest('hex'),
    fileProof: createHash('sha256').update(state.closure!.backup!.verificationNonce, 'utf8').update(backup.body, 'utf8').digest('hex'),
  };
}

type BinaryFixtureKind = 'entry-active' | 'entry-deleted' | 'entry-demo' | 'task' | 'chat' | 'orphan' | 'support' | 'sticker-deleted';

/** Only storage references are created; no fixture pretends a binary was backed up. */
async function binaryFixture(kind: BinaryFixtureKind): Promise<{ source: string; id: string }> {
  const file = { fileName: 'evidencia-sintetica.pdf', mimeType: 'application/pdf', size: 123, storageKey: `synthetic/reference-only/${randomUUID()}.pdf` };
  if (kind === 'support') {
    const request = await prisma.supportRequest.create({ data: {
      correlationId: randomUUID(), kind: 'ERROR', subject: 'Soporte sintético con archivo', description: 'Referencia sin copia binaria verificada.',
      requestedById: outgoing.id, requesterName: outgoing.name, requesterUser: 'synthetic', requesterRole: outgoing.roleKey, context: {},
      attachments: { create: { ...file, kind: 'ARCHIVO' } },
    }, include: { attachments: true } });
    return { source: 'SupportRequestAttachment', id: request.attachments[0]!.id };
  }
  if (kind === 'sticker-deleted') {
    const sticker = await prisma.chatSticker.create({ data: { ...file, ownerId: outgoing.id, deletedAt: new Date() } });
    return { source: 'ChatSticker', id: sticker.id };
  }
  const data: Prisma.AttachmentUncheckedCreateInput = { ...file, uploadedById: outgoing.id };
  if (kind.startsWith('entry-')) {
    const entry = await prisma.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Novedad sintética con referencia de archivo', description: 'El JSON conserva la referencia, no los bytes del archivo.', createdById: outgoing.id } });
    data.entryId = entry.id;
    if (kind === 'entry-deleted') data.deletedAt = new Date();
    if (kind === 'entry-demo') data.isDemo = true;
  } else if (kind === 'task') {
    const task = await prisma.task.create({ data: { title: 'Tarea sintética con archivo', createdById: outgoing.id } });
    data.taskId = task.id;
  } else if (kind === 'chat') {
    const conversation = await prisma.chatConversation.create({ data: { type: 'GRUPO', createdById: outgoing.id } });
    const message = await prisma.chatMessage.create({ data: { conversationId: conversation.id, senderId: outgoing.id, kind: 'ARCHIVO' } });
    data.chatMessageId = message.id;
  }
  const attachment = await prisma.attachment.create({ data });
  return { source: 'Attachment', id: attachment.id };
}

describe('cierre ordenado · transiciones explícitas', () => {
  it('mantiene compatible el mantenimiento anterior y comienza sin despedida', async () => {
    expect(await getMaintenanceState()).toMatchObject({ ...MAINTENANCE_DEFAULT, closure: null, valid: true });
    expect(maintenanceStateFromRow({ value: { enabled: false, message: 'Mantenimiento anterior', startedAt: null }, updatedAt: new Date() })).toMatchObject({ closure: null, valid: true });
    const state = await setSystemMaintenance(sysadmin, { enabled: true, expectedRevision: (await getMaintenanceState()).revision });
    await expect(begin()).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await getMaintenanceState()).toEqual(state);
  });

  it('activa despedida sin bloquear a todos ni modificar cuentas, sesiones o turnos', async () => {
    const shift = await createShift({ userId: outgoing.id, status: ShiftStatus.ACTIVO, type: ShiftType.DIA });
    await prisma.session.create({ data: { userId: outgoing.id, expiresAt: new Date(Date.now() + 60_000) } });
    const before = { users: await prisma.user.findMany({ orderBy: { id: 'asc' } }), sessions: await prisma.session.findMany(), shift: await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } }) };
    const state = await begin();
    expect(state).toMatchObject({ enabled: false, closure: { phase: 'CLOSING', backup: null, pendingShiftIds: [shift.id] } });
    expect(await maintenanceBlocksBackground()).toBe(true);
    expect(await prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(before.users);
    expect(await prisma.session.findMany()).toEqual(before.sessions);
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).toEqual(before.shift);
    await expect(setSystemMaintenance(sysadmin, { enabled: false, expectedRevision: state.revision })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await getMaintenanceState()).toEqual(state);
  });

  it('rechaza control por otro rol incluso con permiso genérico de configuración', async () => {
    const state = await getMaintenanceState();
    const actor = { ...outgoing, permissions: [...outgoing.permissions, 'system.configure' as const] };
    const operations = [
      () => beginSystemClosure(actor, { expectedRevision: state.revision }),
      () => recoverSystemClosure(actor, { expectedRevision: state.revision }),
      () => createClosureBackup(actor),
      () => verifyClosureBackup(actor, { expectedRevision: state.revision, uploadedDigest: 'a'.repeat(64), fileProof: 'a'.repeat(64) }),
      () => lockSystemClosure(actor, { expectedRevision: state.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION }),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await getMaintenanceState()).toEqual(state);
  });

  it('serializa activaciones concurrentes y rechaza la revisión obsoleta', async () => {
    const state = await getMaintenanceState();
    const results = await Promise.allSettled([
      beginSystemClosure(sysadmin, { expectedRevision: state.revision }),
      beginSystemClosure(sysadmin, { expectedRevision: state.revision }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemClosure' } })).toBe(1);
  });

  it('revierte estado y auditoría juntos si la auditoría no se puede escribir', async () => {
    const initial = await getMaintenanceState();
    const realTransaction = applicationPrisma.$transaction.bind(applicationPrisma);
    const spy = vi.spyOn(applicationPrisma, '$transaction');
    spy.mockImplementation((async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => realTransaction(async tx => {
      const audit = vi.spyOn(tx.auditLog, 'create').mockRejectedValueOnce(new Error('Fallo sintético de auditoría'));
      try { return await run(tx); } finally { audit.mockRestore(); }
    })) as typeof applicationPrisma.$transaction);
    await expect(begin()).rejects.toThrow('Fallo sintético de auditoría');
    spy.mockRestore();
    expect(await getMaintenanceState()).toEqual(initial);
    expect(await prisma.auditLog.count({ where: { entity: 'SystemClosure' } })).toBe(0);
  });
});

describe('cierre ordenado · precondiciones y respaldo', () => {
  it('comprueba los seis históricos, excluye planificación futura y pruebas demo', async () => {
    await begin();
    expect((await getSystemClosureChecklist()).blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REQUIRED_CLOSURES_MISSING', count: 6 })]));
    await historicalClosures();
    await createShift({ userId: outgoing.id, type: ShiftType.DIA });
    const demo = await createShift({ type: ShiftType.NOCHE, status: ShiftStatus.ACTIVO });
    await prisma.shift.update({ where: { id: demo.id }, data: { isDemo: true } });
    expect(await getSystemClosureChecklist()).toMatchObject({ ready: true, counts: { closedShifts: 6, activeParticipants: 0 } });
  });

  it('un turno sin finalizar y una participación vigente impiden exportar y bloquear', async () => {
    await historicalClosures();
    const active = await createShift({ userId: outgoing.id, type: ShiftType.DIA, status: ShiftStatus.ACTIVO });
    await prisma.shiftAssignment.update({ where: { shiftId_userId: { shiftId: active.id, userId: outgoing.id } }, data: { activatedAt: new Date() } });
    const state = await begin();
    expect((await getSystemClosureChecklist()).blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['OPEN_SHIFTS', 'ACTIVE_PARTICIPANTS']));
    await expect(createClosureBackup(sysadmin)).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(lockSystemClosure(sysadmin, { expectedRevision: state.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await getMaintenanceState()).enabled).toBe(false);
  });

  it('preserva los históricos sin inventar caja y exige caja formal del turno final', async () => {
    await historicalClosures();
    await begin();
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 10000 } });
    const initial = await getSystemClosureChecklist();
    expect(initial.ready).toBe(true);
    expect(initial.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LEGACY_CASH_CLOSURE_MISSING', count: 6 })]));
    // Deliberately inconsistent local fixture proves the final check catches a missing closure.
    const final = await prisma.shift.create({ data: {
      date: new Date(), type: 'DIA', status: 'CERRADO', plannedStart: new Date(), plannedEnd: new Date(), actualStart: new Date(), actualEnd: new Date(),
      handoverOut: { create: { issuedById: outgoing.id, status: 'RECIBIDA', receivedAt: new Date(), receivedById: incoming.id } },
    }, include: { handoverOut: true } });
    expect((await getSystemClosureChecklist()).blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['CASH_NOT_CLOSED', 'MISSING_CASH_COUNTS']));
    await prisma.$executeRaw`INSERT INTO "ShiftCashClosure" (id, "shiftId", "closedById", snapshot) VALUES (${randomUUID()}, ${final.id}, ${outgoing.id}, '{}'::jsonb)`;
    for (const kind of ['DECLARADO', 'CONFIRMADO'] as const) await prisma.cashCount.create({ data: { handoverId: final.handoverOut!.id, countedById: kind === 'DECLARADO' ? outgoing.id : incoming.id, kind } });
    expect((await getSystemClosureChecklist()).ready).toBe(true);
    await prisma.$executeRaw`UPDATE "ShiftCashClosure" SET "reopenedAt"=NOW() WHERE "shiftId"=${final.id}`;
    expect((await getSystemClosureChecklist()).blockers.map(blocker => blocker.code)).toContain('CASH_REOPENED');
  });

  it('detecta custodia pendiente y admite únicamente la excepción canónica autorizada', async () => {
    await historicalClosures();
    await begin();
    const handover = await prisma.shiftHandover.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const type = await prisma.handoverElementType.create({ data: { name: 'Bolsa de custodia sintética' } });
    const element = await prisma.handoverElement.create({ data: { handoverId: handover.id, elementTypeId: type.id, declared: true } });
    expect((await getSystemClosureChecklist()).blockers.map(blocker => blocker.code)).toContain('PENDING_CUSTODY');
    await prisma.handoverElement.update({ where: { id: element.id }, data: { missingReason: 'Excepción sintética revisada', missingReportedById: incoming.id, missingReportedAt: new Date(), missingApprovedAt: new Date(), missingApprovedById: sysadmin.id, missingApprovedByName: sysadmin.name, missingApprovalNote: 'Excepción revisada por administración sintética' } });
    expect((await getSystemClosureChecklist()).ready).toBe(true);
  });

  it('permite a otra persona de Supervisión autorizar una ausencia mediante la acción real durante CLOSING, sin confirmar posesión ni ampliar shift.manage', async () => {
    const reporter = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisor receptor ficticio' });
    const reviewer = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR, name: 'Supervisora revisora ficticia' });
    expect(reviewer.isSystemAdmin).toBe(false);
    expect(reviewer.permissions).toContain('shift.manage');
    const { shift } = await openShift(outgoing, { type: ShiftType.DIA });
    await begin();
    await prisma.handoverElementType.create({ data: { name: 'Bolsa sintética pendiente de localizar', required: true } });
    const handover = await prepareHandover(outgoing, shift.id);
    const element = await prisma.handoverElement.findFirstOrThrow({ where: { handoverId: handover.id } });
    await markHandoverElements(outgoing, { handoverId: handover.id, field: 'declared', marks: { [element.id]: true } });
    await confirmHandoverReviewStep(outgoing, { handoverId: handover.id, step: 'PENDINGS' });
    await confirmHandoverReviewStep(outgoing, { handoverId: handover.id, step: 'FINAL', urgentAcknowledged: true });
    await sendHandover(outgoing, { shiftId: shift.id });
    await closeShift(outgoing, { shiftId: shift.id });
    await startFinalHandoverReception(reporter, { handoverId: handover.id });
    await confirmReceptionReviewStep(reporter, { handoverId: handover.id, step: 'BRIEFING' });
    const declared = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    const missing = await reportHandoverElementMissing(reporter, {
      handoverId: handover.id, elementId: element.id,
      reason: 'Bolsa ficticia no recibida; debe localizarse mediante revisión independiente.',
      revision: declared.updatedAt.toISOString(),
    });
    const form = new FormData();
    form.set('handoverId', handover.id); form.set('elementId', element.id);
    form.set('reason', 'Ausencia revisada por otra supervisora; continuar con diferencia registrada sin acreditar posesión.');
    form.set('revision', missing.updatedAt.toISOString());

    mocks.currentUser.mockResolvedValue(reporter);
    await expect(approveMissingElementAction(null, form)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Otra persona de Supervisión/i) });
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(missing);
    mocks.currentUser.mockResolvedValue({ ...reviewer, permissions: reviewer.permissions.filter(permission => permission !== 'shift.manage') });
    await expect(approveMissingElementAction(null, form)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('shift.manage') });
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(missing);

    mocks.currentUser.mockResolvedValue(reviewer);
    await expect(requirePermission('shift.manage')).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(approveMissingElementAction(null, form)).resolves.toMatchObject({ ok: true });
    const approved = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    expect(approved).toMatchObject({ confirmed: false, missingReason: missing.missingReason, missingReportedById: reporter.id, missingApprovedById: reviewer.id, missingApprovedByName: reviewer.name });
    expect(approved.missingApprovedAt).not.toBeNull();
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ status: 'ENVIADA', receivedAt: null, receivedById: reporter.id, toShiftId: null });
    await confirmReceptionReviewStep(reporter, { handoverId: handover.id, step: 'CUSTODY' });
    await expect(requirePermission('shift.manage')).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await prisma.shift.count()).toBe(1);
  });

  it('incluye jornadas y relevos de Supervisión pendientes, sin inventar una jornada receptora', async () => {
    await historicalClosures();
    await begin();
    const shift = await prisma.supervisionShift.create({ data: { supervisorId: sysadmin.id, status: 'ACTIVO' } });
    const handover = await prisma.supervisionShiftHandover.create({ data: { supervisionShiftId: shift.id, issuedById: sysadmin.id, snapshot: {} } });
    expect((await getSystemClosureChecklist()).blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['OPEN_SUPERVISION_SHIFTS', 'PENDING_SUPERVISION_HANDOVERS']));
    await prisma.supervisionShift.update({ where: { id: shift.id }, data: { status: 'CERRADO', finishedAt: new Date() } });
    expect((await getSystemClosureChecklist()).ready).toBe(false);
    await prisma.supervisionShiftHandover.update({ where: { id: handover.id }, data: { receivedById: incoming.id, receivedAt: new Date() } });
    expect((await getSystemClosureChecklist()).ready).toBe(true);
  });

  it.each([ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.HK_SUPERVISOR])('exige recepción y aceptación nativas de pendientes y custodia de Housekeeping por %s', async roleKey => {
    await historicalClosures();
    const area = await prisma.department.findUniqueOrThrow({ where: { key: 'HOUSEKEEPING' } });
    const sender = await createUser({ roleKey: ROLE_KEYS.HK_SUPERVISOR });
    await prisma.user.update({ where: { id: sender.id }, data: { departmentId: area.id } });
    sender.departmentId = area.id;
    const receiver = roleKey === ROLE_KEYS.SYSTEM_ADMIN ? sysadmin : await createUser({ roleKey });
    if (!receiver.isSystemAdmin) {
      await prisma.user.update({ where: { id: receiver.id }, data: { departmentId: area.id } });
      receiver.departmentId = area.id;
    }
    const handover = await saveHkHandover(sender, { requestKey: randomUUID(), departmentId: area.id, workDate: '2026-10-15', note: 'Relevo final ficticio: revisar pendientes y custodia con el flujo existente.' });
    await begin();
    expect((await getSystemClosureChecklist()).blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PENDING_HOUSEKEEPING_HANDOVERS', count: 1, ids: [handover.id] })]));
    await receiveHkHandover(receiver, handover.id);
    expect((await getSystemClosureChecklist()).ready).toBe(false);
    await expect(createClosureBackup(sysadmin)).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(acceptHkHandover(sender, handover.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await acceptHkHandover(receiver, handover.id);
    expect(await getSystemClosureChecklist()).toMatchObject({ ready: true, counts: { pendingHousekeepingHandovers: 0 } });
    expect(await prisma.housekeepingHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: receiver.id, receivedAt: expect.any(Date), acceptedById: receiver.id, acceptedAt: expect.any(Date) });
    expect(await prisma.shift.count()).toBe(6);
    expect(await prisma.supervisionShift.count()).toBe(0);
  });

  it('generar o iniciar una descarga nunca verifica el respaldo ni activa bloqueo', async () => {
    const backup = await readyBackup();
    const state = await getMaintenanceState();
    expect(backup.digest).toBe(createHash('sha256').update(backup.body).digest('hex'));
    expect(state).toMatchObject({ enabled: false, closure: { phase: 'CLOSING', backup: { verifiedAt: null, digest: backup.digest } } });
    await expect(lockSystemClosure(sysadmin, { expectedRevision: state.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(verifyClosureBackup(sysadmin, { expectedRevision: state.revision, uploadedDigest: '0'.repeat(64), fileProof: '0'.repeat(64) })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(verifyClosureBackup(sysadmin, { expectedRevision: state.revision, uploadedDigest: backup.digest, fileProof: '0'.repeat(64) })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await getMaintenanceState()).toEqual(state);
  });

  it.each<BinaryFixtureKind>(['entry-active', 'entry-deleted', 'entry-demo', 'task', 'chat', 'orphan', 'support', 'sticker-deleted'])('exporta y verifica registros pero impide bloquear con archivo binario sin verificar: %s', async kind => {
    const binary = await binaryFixture(kind);
    const backup = await readyBackup();
    const checklist = await getSystemClosureChecklist();
    expect(checklist).toMatchObject({ ready: true, blockers: [], lockReady: false, lockBlockers: [{ code: 'BINARY_BACKUP_UNVERIFIED', count: 1, ids: [`${binary.source}:${binary.id}`] }] });
    const verified = await verifyClosureBackup(sysadmin, await verificationInput(backup));
    expect(verified.closure?.backup?.verifiedAt).not.toBeNull();
    expect((await getSystemClosureChecklist()).lockReady).toBe(false);
    await expect(lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION })).rejects.toMatchObject({ code: 'RULE_VIOLATION', message: expect.stringContaining('archivos binarios') });
    expect(await getMaintenanceState()).toEqual(verified);
    expect(verified.enabled).toBe(false);
  });

  it('recomprueba el inventario bajo el bloqueo final aunque el adjunto aparezca después de verificar el JSON', async () => {
    const { verified } = await verifiedBackup();
    expect(await getSystemClosureChecklist()).toMatchObject({ ready: true, lockReady: true, lockBlockers: [] });
    const binary = await binaryFixture('orphan');
    expect((await getSystemClosureChecklist()).lockBlockers).toEqual([expect.objectContaining({ code: 'BINARY_BACKUP_UNVERIFIED', count: 1, ids: [`${binary.source}:${binary.id}`] })]);
    await expect(lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION })).rejects.toMatchObject({ code: 'RULE_VIOLATION', message: expect.stringContaining('archivos binarios') });
    expect(await getMaintenanceState()).toEqual(verified);
  });

  it('rechaza cambios operativos posteriores al archivo durante verificación y bloqueo', async () => {
    const backup = await readyBackup();
    const state = await getMaintenanceState();
    const entry = await prisma.operationalEntry.create({ data: { title: 'Novedad sintética posterior al respaldo', description: 'Texto completo pendiente de nueva exportación', type: 'NOVEDAD', createdById: outgoing.id } });
    await expect(verifyClosureBackup(sysadmin, { ...await verificationInput(backup), expectedRevision: state.revision })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    const updated = await createClosureBackup(sysadmin);
    const verified = await verifyClosureBackup(sysadmin, await verificationInput(updated));
    await prisma.operationalEntry.update({ where: { id: entry.id }, data: { description: 'Edición real sintética después de verificar' } });
    await expect(lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect((await getMaintenanceState()).enabled).toBe(false);
  });

  it('recorre cierre existente, recepción final sin jornada, respaldo, verificación, bloqueo y recuperación', async () => {
    await historicalClosures();
    const { shift } = await openShift(outgoing, { type: ShiftType.DIA });
    await begin();
    const draft = await prepareHandover(outgoing, shift.id);
    await confirmHandoverReviewStep(outgoing, { handoverId: draft.id, step: 'PENDINGS' });
    await confirmHandoverReviewStep(outgoing, { handoverId: draft.id, step: 'FINAL', urgentAcknowledged: true });
    await sendHandover(outgoing, { shiftId: shift.id, notes: 'Entrega final sintética con texto íntegro.' });
    await closeShift(outgoing, { shiftId: shift.id });
    expect((await getMaintenanceState()).enabled).toBe(false);
    await expect(createClosureBackup(sysadmin)).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await startFinalHandoverReception(incoming, { handoverId: draft.id });
    for (const step of ['BRIEFING', 'CUSTODY', 'FINAL'] as const) await confirmReceptionReviewStep(incoming, { handoverId: draft.id, step, urgentAcknowledged: true });
    await receiveHandover(incoming, { handoverId: draft.id, observations: 'Recepción final real en datos ficticios.' });
    expect(await prisma.shift.count()).toBe(7);
    const backup = await createClosureBackup(sysadmin);
    const data = JSON.parse(backup.body).data as { tables: { shifts: Array<{ id: string }>; handovers: Array<{ id: string; receivedById: string }> } };
    expect(data.tables.shifts.some(row => row.id === shift.id)).toBe(true);
    expect(data.tables.handovers.find(row => row.id === draft.id)?.receivedById).toBe(incoming.id);
    const verified = await verifyClosureBackup(sysadmin, await verificationInput(backup));
    expect(await getSystemClosureChecklist()).toMatchObject({ ready: true, lockReady: true, lockBlockers: [] });
    await expect(lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: 'bloquear' })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    const locked = await lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION });
    expect(locked).toMatchObject({ enabled: true, message: SYSTEM_CLOSED_MESSAGE, closure: { phase: 'LOCKED', lockedById: sysadmin.id } });
    expect(await prisma.user.findMany({ orderBy: { id: 'asc' } })).toEqual(users);
    await expect(assertMaintenanceAccess(outgoing)).rejects.toMatchObject({ code: 'MAINTENANCE' });
    await expect(assertMaintenanceAccess(sysadmin)).resolves.toBeUndefined();
    await expect(setSystemMaintenance(sysadmin, { expectedRevision: locked.revision, enabled: false })).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    expect(await recoverSystemClosure(sysadmin, { expectedRevision: locked.revision })).toMatchObject({ ...MAINTENANCE_DEFAULT, valid: true });
    expect(await prisma.shift.count()).toBe(7);
    await expect(assertMaintenanceAccess(outgoing)).resolves.toBeUndefined();
  });
});

describe('cierre ordenado · rutas y sesiones existentes', () => {
  it('despedida rechaza acción genérica, conserva permiso de recepción y no concede permisos nuevos', async () => {
    await begin();
    mocks.currentUser.mockResolvedValue(incoming);
    await expect(requireUser()).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(requirePermission('entry.create')).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(assertClosureOperation(incoming)).rejects.toMatchObject({ code: 'RULE_VIOLATION' });
    await expect(requirePermission('shift.receive')).resolves.toBe(incoming);
    mocks.currentUser.mockResolvedValue({ ...incoming, permissions: [] });
    await expect(requirePermission('shift.receive')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(requirePageUser()).rejects.toMatchObject({ digest: expect.stringContaining('/turno') });
    await expect(requirePageUser({ allowClosure: true })).resolves.toMatchObject({ id: incoming.id });
  });

  it('API directa rechaza métodos generales durante despedida y sólo permite la excepción explícita', async () => {
    await begin();
    mocks.currentUser.mockResolvedValue(incoming);
    const handler = vi.fn(async (_request: Request) => new Response('operación sintética'));
    const blocked = await withMaintenance(handler)(new Request('https://synthetic.invalid/api/entries', { method: 'POST', body: 'cuerpo que no debe procesarse' }));
    expect(blocked.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect((await withMaintenance(handler, { allowClosure: true })(new Request('https://synthetic.invalid/api/session/heartbeat'))).status).toBe(200);
    mocks.currentUser.mockResolvedValue(sysadmin);
    expect((await withMaintenance(handler)(new Request('https://synthetic.invalid/api/admin'))).status).toBe(200);
  });

  it('bloqueo cubre sesiones de todos los demás roles y sysadmin conserva página, acciones y API', async () => {
    const { verified } = await verifiedBackup();
    await lockSystemClosure(sysadmin, { expectedRevision: verified.revision, confirmation: SYSTEM_CLOSURE_CONFIRMATION });
    for (const roleKey of Object.values(ROLE_KEYS).filter(key => key !== ROLE_KEYS.SYSTEM_ADMIN)) {
      const actor = await createUser({ roleKey });
      mocks.currentUser.mockResolvedValue(actor);
      await expect(requireUser({ allowClosure: true })).rejects.toMatchObject({ code: 'MAINTENANCE' });
      await expect(requirePageUser({ allowClosure: true })).rejects.toMatchObject({ digest: expect.stringContaining('/mantenimiento') });
      const handler = vi.fn(async () => new Response('No permitido'));
      expect((await withMaintenance(handler, { allowClosure: true })()).status).toBe(503);
      expect(handler).not.toHaveBeenCalled();
    }
    mocks.currentUser.mockResolvedValue(sysadmin);
    await expect(requireUser()).resolves.toBe(sysadmin);
    await expect(requirePageUser()).resolves.toBe(sysadmin);
    const handler = vi.fn(async () => new Response('Administración disponible'));
    expect((await withMaintenance(handler)()).status).toBe(200);
  });
});
