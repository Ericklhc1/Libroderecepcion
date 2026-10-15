import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { handoverElementPending } from '@/domain/handover-custody';
import {
  MAINTENANCE_DEFAULT, MAINTENANCE_SETTING_KEY, REQUIRED_CLOSURE_HUMAN_IDS,
  SYSTEM_CLOSED_MESSAGE, SYSTEM_CLOSURE_CONFIRMATION, SYSTEM_CLOSURE_MESSAGE,
  type MaintenanceState, type SystemClosureState,
} from '@/domain/system-maintenance';
import type { CurrentUser } from '@/server/auth/current-user';
import { requestMeta } from '@/server/auth/session';
import { ForbiddenError, RuleError } from '@/server/errors';
import { isCashEnabled } from './cash';
import { getMaintenanceState, maintenanceStateFromRow } from './system-maintenance';
import { collectClosureBackup, closureBackupFingerprint, getClosureBinaryInventory, type ClosureBackupData } from './closure-backup';

type Tx = Prisma.TransactionClient;
type SettingRow = { id?: string; value: Prisma.JsonValue; updatedAt: Date } | null;
type RequestMeta = Awaited<ReturnType<typeof requestMeta>>;

export type SystemClosureBlocker = { code: string; message: string; count: number; ids: string[] };
export type SystemClosureChecklist = {
  ready: boolean;
  lockReady: boolean;
  blockers: SystemClosureBlocker[];
  lockBlockers: SystemClosureBlocker[];
  warnings: SystemClosureBlocker[];
  requiredClosureHumanIds: readonly number[];
  counts: {
    startedShifts: number; closedShifts: number; cancelledShifts: number;
    pendingHandovers: number; activeParticipants: number;
    openSupervisionShifts: number; pendingSupervisionHandovers: number; pendingHousekeepingHandovers: number;
  };
};

function assertSysadmin(user: CurrentUser) {
  if (!user.isSystemAdmin) throw new ForbiddenError('Sólo el Administrador de sistema puede controlar el cierre ordenado.');
}

function assertRevision(state: MaintenanceState, expectedRevision: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedRevision) || state.revision !== expectedRevision) {
    throw new RuleError('El cierre ordenado cambió. Recarga la página y vuelve a confirmar.');
  }
}

function assertClosing(state: MaintenanceState): SystemClosureState {
  if (!state.valid || state.closure?.phase !== 'CLOSING') throw new RuleError('Primero activa el aviso de despedida y completa el cierre operativo.');
  return state.closure;
}

async function lockedSetting(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'setting:' + MAINTENANCE_SETTING_KEY}))::text`;
  const row = await tx.systemSetting.findUnique({ where: { key: MAINTENANCE_SETTING_KEY }, select: { id: true, value: true, updatedAt: true } });
  return { row, state: maintenanceStateFromRow(row) };
}

/**
 * Protect the complete source snapshot, including raw-SQL tables and audit evidence.
 * SHARE conflicts with operational writes, while allowing reads and this transaction's
 * own control/audit writes. Taking every table in one fixed order also covers sources
 * added to the canonical backup without silently weakening the final check.
 */
async function lockBackupSources(tx: Tx) {
  const tables = await tx.$queryRaw<Array<{ name: string }>>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  if (tables.length === 0) throw new RuleError('No se pudieron comprobar las fuentes del respaldo.');
  await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.join(tables.map(({ name }) => Prisma.raw(`"${name.replaceAll('"', '""')}"`)))} IN SHARE MODE`);
}

async function writeClosureState(tx: Tx, user: CurrentUser, previous: SettingRow, closure: SystemClosureState | null, summary: string, meta: RequestMeta) {
  const locked = closure?.phase === 'LOCKED';
  const value = closure ? {
    enabled: locked,
    message: locked ? SYSTEM_CLOSED_MESSAGE : SYSTEM_CLOSURE_MESSAGE,
    startedAt: locked ? closure.lockedAt : null,
    closure,
  } : { ...MAINTENANCE_DEFAULT };
  const data = {
    value: value as Prisma.InputJsonValue, updatedById: user.id, category: 'mantenimiento',
    description: 'Disponibilidad y cierre ordenado auditados; control exclusivo del Administrador de sistema.',
  };
  const row = await tx.systemSetting.upsert({ where: { key: MAINTENANCE_SETTING_KEY }, create: { key: MAINTENANCE_SETTING_KEY, ...data }, update: data });
  await tx.auditLog.create({ data: {
    entity: 'SystemClosure', entityId: row.id, action: AuditAction.CONFIGURAR, summary,
    userId: user.id, sessionId: user.sessionId || null,
    before: previous ? previous.value === null ? Prisma.JsonNull : previous.value : MAINTENANCE_DEFAULT,
    after: value as Prisma.InputJsonValue, ip: meta.ip, userAgent: meta.userAgent,
  } });
  return maintenanceStateFromRow(row);
}

async function collectChecklist(tx: Tx): Promise<SystemClosureChecklist> {
  const control = await getMaintenanceState(tx);
  const [shifts, participants, handovers, cashEnabled, cashClosures, supervision, supervisionHandovers, housekeepingHandovers, binaryInventory] = await Promise.all([
    tx.shift.findMany({ where: { isDemo: false }, select: { id: true, humanId: true, status: true, actualStart: true, actualEnd: true, handoverOut: { select: { id: true, status: true } } }, orderBy: { id: 'asc' } }),
    tx.shiftAssignment.findMany({ where: { shift: { isDemo: false }, activatedAt: { not: null }, leftAt: null }, select: { id: true, shiftId: true }, orderBy: { id: 'asc' } }),
    tx.shiftHandover.findMany({ where: { isDemo: false, fromShift: { isDemo: false }, status: { in: ['ENVIADA', 'RECIBIDA'] } }, select: { id: true, fromShiftId: true, status: true, receivedAt: true, receivedById: true, elements: { select: { id: true, declared: true, confirmed: true, missingReason: true, missingApprovedAt: true } }, cashCounts: { select: { kind: true } } }, orderBy: { id: 'asc' } }),
    isCashEnabled(tx),
    tx.$queryRaw<Array<{ shiftId: string; reopenedAt: Date | null }>>`SELECT c."shiftId", c."reopenedAt" FROM "ShiftCashClosure" c JOIN "Shift" s ON s.id = c."shiftId" WHERE s."isDemo" = false ORDER BY c."shiftId"`,
    tx.supervisionShift.findMany({ where: { status: { in: ['PREPARACION', 'ACTIVO', 'ENTREGADO'] } }, select: { id: true }, orderBy: { id: 'asc' } }),
    tx.supervisionShiftHandover.findMany({ where: { OR: [{ receivedAt: null }, { receivedById: null }] }, select: { id: true }, orderBy: { id: 'asc' } }),
    tx.housekeepingHandover.findMany({ where: { OR: [{ receivedAt: null }, { receivedById: null }, { acceptedAt: null }, { acceptedById: null }] }, select: { id: true }, orderBy: { id: 'asc' } }),
    getClosureBinaryInventory(tx),
  ]);
  const started = shifts.filter(shift => shift.actualStart !== null || !['PROGRAMADO', 'ANULADO'].includes(shift.status));
  const open = started.filter(shift => !['CERRADO', 'ANULADO'].includes(shift.status));
  const closed = shifts.filter(shift => shift.status === 'CERRADO');
  const pendingHandovers = handovers.filter(handover => handover.status !== 'RECIBIDA' || !handover.receivedAt || !handover.receivedById);
  const blockers: SystemClosureBlocker[] = [];
  const warnings: SystemClosureBlocker[] = [];
  const beganAt = control.closure ? new Date(control.closure.startedAt) : null;
  // Preserve historical records as they are. Only current/final closures must meet
  // the current cash contract; no invented backfill is required for old shifts.
  const applicableClosed = closed.filter(shift => control.closure?.pendingShiftIds.includes(shift.id) || (beganAt && shift.actualEnd && shift.actualEnd >= beganAt));
  const add = (code: string, message: string, ids: string[]) => { if (ids.length) blockers.push({ code, message, count: ids.length, ids }); };
  add('OPEN_SHIFTS', 'Quedan turnos de Recepción iniciados sin cerrar o anular.', open.map(shift => String(shift.humanId)));
  add('ACTIVE_PARTICIPANTS', 'Quedan participaciones operativas sin finalizar.', participants.map(participant => participant.id));
  add('INCOMPLETE_CLOSURES', 'Hay turnos del cierre actual sin fecha final o entrega válida; requieren revisión administrativa.', applicableClosed.filter(shift => !shift.actualEnd || !shift.handoverOut || !['ENVIADA', 'RECIBIDA'].includes(shift.handoverOut.status)).map(shift => String(shift.humanId)));
  add('PENDING_HANDOVERS', 'Quedan entregas de Recepción sin recepción real confirmada.', pendingHandovers.map(handover => handover.id));
  add('PENDING_CUSTODY', 'Quedan elementos de custodia sin recibir ni excepción autorizada según las reglas vigentes.', handovers.flatMap(handover => handover.elements.filter(handoverElementPending).map(element => element.id)));
  add('CASH_REOPENED', 'Hay cajas reabiertas que requieren un cierre formal vigente.', cashClosures.filter(closure => closure.reopenedAt).map(closure => closure.shiftId));
  if (cashEnabled) {
    const byShift = new Map(cashClosures.map(closure => [closure.shiftId, closure]));
    add('CASH_NOT_CLOSED', 'Hay cajas del cierre actual sin cierre formal vigente.', applicableClosed.filter(shift => !byShift.has(shift.id)).map(shift => String(shift.humanId)));
    const applicableIds = new Set(applicableClosed.map(shift => shift.id));
    add('MISSING_CASH_COUNTS', 'Faltan arqueos declarados o confirmados en las entregas del cierre actual.', handovers.filter(handover => applicableIds.has(handover.fromShiftId) && (!handover.cashCounts.some(count => count.kind === 'DECLARADO') || !handover.cashCounts.some(count => count.kind === 'CONFIRMADO'))).map(handover => handover.id));
    const legacy = closed.filter(shift => !applicableIds.has(shift.id) && !byShift.has(shift.id));
    if (legacy.length) warnings.push({ code: 'LEGACY_CASH_CLOSURE_MISSING', message: 'Cierres históricos sin cierre formal de Caja; se conservan íntegros, sin reconstruir evidencias.', count: legacy.length, ids: legacy.map(shift => String(shift.humanId)) });
  }
  add('REQUIRED_CLOSURES_MISSING', 'El respaldo debe conservar los seis cierres previamente entregados como turnos cerrados.', REQUIRED_CLOSURE_HUMAN_IDS.filter(humanId => !closed.some(shift => shift.humanId === humanId)).map(String));
  add('OPEN_SUPERVISION_SHIFTS', 'Quedan jornadas de Supervisión o de área sin finalizar o cancelar.', supervision.map(shift => shift.id));
  add('PENDING_SUPERVISION_HANDOVERS', 'Quedan entregas de Supervisión o de área sin recepción real.', supervisionHandovers.map(handover => handover.id));
  add('PENDING_HOUSEKEEPING_HANDOVERS', 'Quedan relevos de Housekeeping sin recepción real o aceptación de pendientes y custodia.', housekeepingHandovers.map(handover => handover.id));
  // A metadata export never proves that storage objects were downloaded or
  // preserved. This candidate has no binary verification path or override.
  const lockBlockers: SystemClosureBlocker[] = binaryInventory.total ? [{
    code: 'BINARY_BACKUP_UNVERIFIED',
    message: 'El JSON contiene registros y referencias, no los archivos binarios. Hay archivos sin respaldo binario verificable; el bloqueo final no está disponible en este candidato.',
    count: binaryInventory.total,
    ids: binaryInventory.sources.flatMap(source => source.ids.map(id => `${source.source}:${id}`)),
  }] : [];
  return {
    ready: blockers.length === 0, lockReady: blockers.length === 0 && lockBlockers.length === 0,
    blockers, lockBlockers, warnings, requiredClosureHumanIds: [...REQUIRED_CLOSURE_HUMAN_IDS],
    counts: { startedShifts: started.length, closedShifts: closed.length, cancelledShifts: shifts.filter(shift => shift.status === 'ANULADO').length,
      pendingHandovers: pendingHandovers.length, activeParticipants: participants.length,
      openSupervisionShifts: supervision.length, pendingSupervisionHandovers: supervisionHandovers.length, pendingHousekeepingHandovers: housekeepingHandovers.length },
  };
}

/** Planning/availability rows do not represent started shifts and never block closure. */
export async function getSystemClosureChecklist(tx?: Tx): Promise<SystemClosureChecklist> {
  return tx ? collectChecklist(tx) : prisma.$transaction(collectChecklist, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

function assertReady(checklist: SystemClosureChecklist) {
  if (!checklist.ready) throw new RuleError(`No se puede avanzar: ${checklist.blockers.map(blocker => `${blocker.message} (${blocker.count})`).join(' ')}`);
}

function assertLockReady(checklist: SystemClosureChecklist) {
  assertReady(checklist);
  if (!checklist.lockReady) throw new RuleError(`No se puede bloquear: ${checklist.lockBlockers.map(blocker => `${blocker.message} (${blocker.count})`).join(' ')}`);
}

// READ COMMITTED is intentional: lockedSetting can run before in-flight writes
// drain. Once all SHARE locks are held, subsequent reads see those commits and
// every source remains stable until this control/audit transaction commits.
const transactionOptions = { maxWait: 10_000, timeout: 60_000 };

/** The downloaded bytes must be exactly reproducible for the saved-file challenge. */
export function encodeClosureBackup(data: ClosureBackupData, metadata: { createdAt: string; closureStartedAt: string; fingerprint: string }): string {
  return JSON.stringify({ format: 'AROH_SYSTEM_CLOSURE_BACKUP', schemaVersion: 1, ...metadata, data }, null, 2) + '\n';
}

export async function beginSystemClosure(user: CurrentUser, input: { expectedRevision: string }): Promise<MaintenanceState> {
  assertSysadmin(user);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const { row, state } = await lockedSetting(tx);
    assertRevision(state, input.expectedRevision);
    if (state.closure?.phase === 'CLOSING') return state;
    if (!state.valid || state.enabled || state.closure) throw new RuleError('Recupera primero el estado de disponibilidad antes de iniciar una despedida.');
    // Drain existing writes before publishing the restricted operation state.
    await lockBackupSources(tx);
    const pendingShifts = await tx.shift.findMany({ where: { isDemo: false, status: { notIn: ['CERRADO', 'ANULADO'] }, OR: [{ actualStart: { not: null } }, { status: { not: 'PROGRAMADO' } }] }, select: { id: true }, orderBy: { id: 'asc' } });
    return writeClosureState(tx, user, row, { phase: 'CLOSING', startedAt: new Date().toISOString(), startedById: user.id, pendingShiftIds: pendingShifts.map(shift => shift.id), backup: null, lockedAt: null, lockedById: null },
      'Despedida iniciada; sólo continúa el cierre operativo. El acceso exclusivo de sysadmin todavía no está activado.', meta);
  }, transactionOptions);
}

export async function recoverSystemClosure(user: CurrentUser, input: { expectedRevision: string }): Promise<MaintenanceState> {
  assertSysadmin(user);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const { row, state } = await lockedSetting(tx);
    assertRevision(state, input.expectedRevision);
    if (!state.valid || !state.closure) throw new RuleError('No existe un cierre ordenado válido para recuperar.');
    return writeClosureState(tx, user, row, null, 'Recuperación explícita del cierre ordenado; acceso ordinario restablecido sin modificar cuentas ni datos operativos.', meta);
  }, transactionOptions);
}

export async function createClosureBackup(user: CurrentUser): Promise<{ body: string; filename: string; digest: string }> {
  assertSysadmin(user);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const { row, state } = await lockedSetting(tx);
    const closure = assertClosing(state);
    await lockBackupSources(tx);
    assertReady(await collectChecklist(tx));
    const data = await collectClosureBackup(tx);
    const fingerprint = closureBackupFingerprint(data);
    const createdAt = new Date().toISOString();
    const body = encodeClosureBackup(data, { createdAt, closureStartedAt: closure.startedAt, fingerprint });
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    const filename = `aroh-respaldo-cierre-${createdAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
    await writeClosureState(tx, user, row, { ...closure, backup: { filename, digest, fingerprint, verificationNonce: randomBytes(32).toString('hex'), createdAt, createdById: user.id, verifiedAt: null, verifiedById: null } },
      'Respaldo JSON de registros y referencias generado; no incluye archivos binarios. Requiere descargar y seleccionar el archivo local para comprobar su SHA-256; aún no autoriza el bloqueo.', meta);
    return { body, filename, digest };
  }, transactionOptions);
}

export async function verifyClosureBackup(user: CurrentUser, input: { expectedRevision: string; uploadedDigest: string; fileProof: string }): Promise<MaintenanceState> {
  assertSysadmin(user);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const { row, state } = await lockedSetting(tx);
    assertRevision(state, input.expectedRevision);
    const closure = assertClosing(state);
    if (!closure.backup) throw new RuleError('Genera y descarga primero el respaldo actualizado.');
    if (!/^[a-f0-9]{64}$/.test(input.uploadedDigest) || !timingSafeEqual(Buffer.from(input.uploadedDigest, 'hex'), Buffer.from(closure.backup.digest, 'hex'))) throw new RuleError('El archivo local seleccionado no coincide íntegramente con el último respaldo generado.');
    if (!/^[a-f0-9]{64}$/.test(input.fileProof)) throw new RuleError('Selecciona el archivo local guardado para comprobar su contenido. La huella pública por sí sola no verifica el respaldo.');
    await lockBackupSources(tx);
    assertReady(await collectChecklist(tx));
    const data = await collectClosureBackup(tx);
    const fingerprint = closureBackupFingerprint(data);
    if (fingerprint !== closure.backup.fingerprint) throw new RuleError('La operación cambió desde el respaldo. Descarga y verifica uno nuevo antes de bloquear.');
    const expectedBody = encodeClosureBackup(data, { createdAt: closure.backup.createdAt, closureStartedAt: closure.startedAt, fingerprint });
    const expectedProof = createHash('sha256').update(closure.backup.verificationNonce, 'utf8').update(expectedBody, 'utf8').digest();
    if (!timingSafeEqual(expectedProof, Buffer.from(input.fileProof, 'hex'))) throw new RuleError('No se pudo comprobar el contenido del archivo local. Selecciona el respaldo guardado correcto.');
    return writeClosureState(tx, user, row, { ...closure, backup: { ...closure.backup, verifiedAt: new Date().toISOString(), verifiedById: user.id } },
      'Archivo JSON local comprobado por SHA-256; registros y referencias vigentes verificados. Esto no acredita respaldo de archivos binarios. El bloqueo final sigue sujeto a precondiciones y confirmación explícita.', meta);
  }, transactionOptions);
}

export async function lockSystemClosure(user: CurrentUser, input: { expectedRevision: string; confirmation: string }): Promise<MaintenanceState> {
  assertSysadmin(user);
  if (input.confirmation !== SYSTEM_CLOSURE_CONFIRMATION) throw new RuleError(`Para bloquear el acceso confirma exactamente: ${SYSTEM_CLOSURE_CONFIRMATION}.`);
  const meta = await requestMeta();
  return prisma.$transaction(async tx => {
    const { row, state } = await lockedSetting(tx);
    assertRevision(state, input.expectedRevision);
    const closure = assertClosing(state);
    if (!closure.backup?.verifiedAt || !closure.backup.verifiedById) throw new RuleError('El JSON de registros y referencias debe estar descargado y verificado seleccionando el archivo local antes de bloquear. Esto no acredita respaldo de archivos binarios.');
    await lockBackupSources(tx);
    assertLockReady(await collectChecklist(tx));
    if (closureBackupFingerprint(await collectClosureBackup(tx)) !== closure.backup.fingerprint) throw new RuleError('La operación cambió después de verificar el respaldo. Genera, descarga y verifica un respaldo nuevo.');
    return writeClosureState(tx, user, row, { ...closure, phase: 'LOCKED', lockedAt: new Date().toISOString(), lockedById: user.id },
      'Acceso exclusivo de sysadmin activado por confirmación explícita, con turnos finalizados, JSON de registros y referencias verificado e inventario de archivos binarios vacío. Cuentas, roles y datos conservados.', meta);
  }, transactionOptions);
}
