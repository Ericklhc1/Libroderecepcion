import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type BackupValue = null | string | number | boolean | BackupValue[] | { [key: string]: BackupValue };
export type ClosureBackupData = {
  schemaVersion: 1;
  scope: 'cierres-libro-caja-custodia';
  tables: Record<string, BackupValue[]>;
};

// Only operational entities are eligible: authentication, mail credentials,
// assistant memory and the backup's own control records are never exported.
const AUDIT_ENTITIES = [
  'Shift', 'ShiftAssignment', 'ShiftHandover', 'HandoverItem', 'ShiftCashClosure',
  'OperationalEntry', 'Task', 'TaskAssignment', 'TaskChecklistItem', 'FollowUp', 'Alert', 'Comment', 'Attachment',
  'CashCount', 'CashCountLine', 'CashTransfer', 'CashMovement', 'CashAudit', 'CashFund', 'CashDenomination',
  'HandoverElement', 'HandoverElementType', 'Guarantee', 'GuaranteeSettlement', 'GymPass',
  'RoomKey', 'KeyMovement', 'KeyInventoryCount', 'KeyInventoryItem', 'KeyArea',
  'SupervisorKey', 'SupervisorKeyMovement', 'KeyStaffLoan', 'KeyStaffLoanItem',
  'LostFoundItem', 'LostFoundEvent', 'HousekeepingRequest', 'HousekeepingWork', 'HousekeepingEvent', 'SubjectAreaAttention',
  'SupervisionShift', 'SupervisionShiftHandover', 'SupervisionAuditImport', 'SupervisionNote',
  'HousekeepingHandover', 'HousekeepingDelegation', 'ChecklistRun', 'ChecklistRunItem', 'AuditFinding', 'CorrectiveMeasure',
];
const SECRET_FIELD = /password|secret|token|sessionid|credential|api.?key|authorization|cookie/i;

/** Stable JSON scalars, with defensive redaction inside legacy audit snapshots. */
function plain(value: unknown): BackupValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const result: Record<string, BackupValue> = {};
    for (const key of Object.keys(value).sort()) {
      if (!SECRET_FIELD.test(key)) result[key] = plain((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  throw new TypeError('El respaldo contiene un valor no serializable.');
}

/** Canonical fingerprint contains operational data only, never generation metadata. */
export function closureBackupFingerprint(data: ClosureBackupData): string {
  return createHash('sha256').update(JSON.stringify(plain(data))).digest('hex');
}

/**
 * Read-only collection. The caller must provide one stable transaction for
 * preconditions and data. The closure service drains writes with SHARE locks,
 * then reads under READ COMMITTED so it includes writes committed during drain.
 * Setting RepeatableRead before acquiring those locks would retain older rows.
 * Includes historical,
 * archived and logically deleted originals; no cap, summaries or inferred data.
 */
export async function collectClosureBackup(tx: Prisma.TransactionClient): Promise<ClosureBackupData> {
  const tables: Record<string, unknown[]> = {};
  const byId = { id: 'asc' as const };
  tables.users = await tx.user.findMany({
    select: { id: true, username: true, name: true, roleId: true, departmentId: true, active: true, deletedAt: true },
    orderBy: byId,
  });
  tables.roles = await tx.role.findMany({ select: { id: true, key: true, name: true }, orderBy: byId });
  tables.departments = await tx.department.findMany({ orderBy: byId });
  tables.shifts = await tx.shift.findMany({ orderBy: byId });
  tables.supervisionShifts = await tx.supervisionShift.findMany({ orderBy: byId });
  tables.supervisionHandovers = await tx.supervisionShiftHandover.findMany({ orderBy: byId });
  tables.supervisionNotes = await tx.supervisionNote.findMany({ orderBy: byId });
  tables.supervisionAuditImports = await tx.supervisionAuditImport.findMany({ orderBy: byId });
  tables.shiftAssignments = await tx.shiftAssignment.findMany({ orderBy: byId });
  tables.handovers = await tx.shiftHandover.findMany({ orderBy: byId });
  tables.handoverItems = await tx.handoverItem.findMany({ orderBy: byId });
  tables.cashClosures = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "humanId", "shiftId", "closedById", "closedAt", "snapshot", "notes",
           "reopenedAt", "reopenedById", "reopenReason"
    FROM "ShiftCashClosure" ORDER BY "id" ASC
  `;
  tables.entries = await tx.operationalEntry.findMany({
    include: { hiddenFromDepartments: { select: { id: true }, orderBy: byId } }, orderBy: byId,
  });
  tables.tasks = await tx.task.findMany({ orderBy: byId });
  tables.taskAssignments = await tx.taskAssignment.findMany({ orderBy: byId });
  tables.taskChecklistItems = await tx.taskChecklistItem.findMany({ orderBy: byId });
  tables.followUps = await tx.followUp.findMany({ orderBy: byId });
  tables.alerts = await tx.alert.findMany({ orderBy: byId });
  tables.comments = await tx.comment.findMany({ orderBy: byId });
  tables.attachments = await tx.attachment.findMany({
    where: { OR: [{ entryId: { not: null } }, { taskId: { not: null } }] },
    select: { id: true, fileName: true, mimeType: true, size: true, storageKey: true, uploadedById: true, entryId: true, taskId: true, createdAt: true, deletedAt: true, deletedById: true, isDemo: true },
    orderBy: byId,
  });
  tables.auditLogs = await tx.auditLog.findMany({
    where: { entity: { in: AUDIT_ENTITIES, notIn: ['SystemMaintenance', 'SystemClosure'] } }, orderBy: byId,
  });
  tables.cashFunds = await tx.cashFund.findMany({ orderBy: byId });
  tables.cashDenominations = await tx.cashDenomination.findMany({ orderBy: byId });
  tables.cashCounts = await tx.cashCount.findMany({ orderBy: byId });
  tables.cashCountLines = await tx.cashCountLine.findMany({ orderBy: byId });
  tables.cashTransfers = await tx.cashTransfer.findMany({ orderBy: byId });
  tables.cashMovements = await tx.cashMovement.findMany({ orderBy: byId });
  // Explicit empty field filters bypass the application's default live-only view.
  tables.cashAudits = await tx.cashAudit.findMany({ where: { deletedAt: {} }, orderBy: byId });
  tables.handoverElementTypes = await tx.handoverElementType.findMany({ orderBy: byId });
  tables.handoverElements = await tx.handoverElement.findMany({ orderBy: byId });
  tables.guarantees = await tx.guarantee.findMany({ orderBy: byId });
  tables.guaranteeSettlements = await tx.guaranteeSettlement.findMany({ orderBy: byId });
  tables.gymPasses = await tx.gymPass.findMany({ orderBy: byId });
  tables.rooms = await tx.room.findMany({ orderBy: byId });
  tables.roomKeys = await tx.roomKey.findMany({ orderBy: byId });
  tables.keyAreas = await tx.keyArea.findMany({ orderBy: byId });
  tables.keyMovements = await tx.keyMovement.findMany({ orderBy: byId });
  tables.keyInventoryCounts = await tx.keyInventoryCount.findMany({ orderBy: byId });
  tables.keyInventoryItems = await tx.keyInventoryItem.findMany({ orderBy: byId });
  tables.supervisorKeys = await tx.supervisorKey.findMany({ orderBy: byId });
  tables.supervisorKeyMovements = await tx.supervisorKeyMovement.findMany({ orderBy: byId });
  tables.keyStaffLoans = await tx.keyStaffLoan.findMany({ orderBy: byId });
  tables.keyStaffLoanItems = await tx.keyStaffLoanItem.findMany({ orderBy: byId });
  tables.lostFoundItems = await tx.lostFoundItem.findMany({ orderBy: byId });
  tables.lostFoundEvents = await tx.lostFoundEvent.findMany({ orderBy: byId });
  tables.housekeepingRequests = await tx.housekeepingRequest.findMany({ where: { deletedAt: {} }, orderBy: byId });
  tables.housekeepingEvents = await tx.housekeepingEvent.findMany({ orderBy: byId });
  tables.housekeepingHandovers = await tx.housekeepingHandover.findMany({ orderBy: byId });
  tables.housekeepingDayMembers = await tx.housekeepingDayMember.findMany({ orderBy: byId });
  tables.housekeepingDelegations = await tx.housekeepingDelegation.findMany({ orderBy: byId });
  tables.checklistTemplates = await tx.checklistTemplate.findMany({ orderBy: byId });
  tables.checklistTemplateItems = await tx.checklistTemplateItem.findMany({ orderBy: byId });
  tables.checklistRuns = await tx.checklistRun.findMany({ orderBy: byId });
  tables.checklistRunItems = await tx.checklistRunItem.findMany({ orderBy: byId });
  tables.auditFindings = await tx.auditFinding.findMany({ orderBy: byId });
  tables.correctiveMeasures = await tx.correctiveMeasure.findMany({ orderBy: byId });
  tables.guestReferences = await tx.guestReference.findMany({ orderBy: byId });
  tables.reservationReferences = await tx.reservationReference.findMany({ orderBy: byId });
  tables.roomStays = await tx.roomStay.findMany({ orderBy: byId });
  tables.areaAttentions = await tx.subjectAreaAttention.findMany({ orderBy: byId });
  // Provenance views resolve both current and historical chained sources.
  tables.taskSourceEntries = await tx.taskSourceEntry.findMany({ orderBy: [{ taskId: 'asc' }, { entryId: 'asc' }] });
  tables.alertSourceEntries = await tx.alertSourceEntry.findMany({ orderBy: [{ alertId: 'asc' }, { entryId: 'asc' }] });
  tables.followUpSourceEntries = await tx.followUpSourceEntry.findMany({ orderBy: [{ followUpId: 'asc' }, { entryId: 'asc' }] });
  tables.taskSourceFollowUps = await tx.taskSourceFollowUp.findMany({ orderBy: [{ taskId: 'asc' }, { followUpId: 'asc' }] });
  tables.alertSourceFollowUps = await tx.alertSourceFollowUp.findMany({ orderBy: [{ alertId: 'asc' }, { followUpId: 'asc' }] });
  tables.followUpSourceFollowUps = await tx.followUpSourceFollowUp.findMany({ orderBy: [{ descendantId: 'asc' }, { followUpId: 'asc' }] });
  tables.auditSourceFollowUps = await tx.auditSourceFollowUp.findMany({ orderBy: [{ auditLogId: 'asc' }, { followUpId: 'asc' }] });
  return plain({ schemaVersion: 1, scope: 'cierres-libro-caja-custodia', tables }) as ClosureBackupData;
}
