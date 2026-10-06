import 'server-only';
import { EntryType, Priority, Severity, type Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { metricPeriod, signedMoney, type MetricRange } from '@/domain/operational-metrics';
import { taskFollowUpReadWhere } from './followup-access';

export const sharedMetricTasks = taskFollowUpReadWhere({ id: '', permissions: [] }, true);
export const overdueTasksWhere = (now: Date): Prisma.TaskWhereInput => ({ deletedAt: null, AND: [sharedMetricTasks], status: { in: TASK_OPEN_STATUSES }, dueAt: { lt: now } });
export const criticalIncidentsWhere = (): Prisma.OperationalEntryWhereInput => ({ deletedAt: null, type: EntryType.INCIDENCIA, status: { in: ENTRY_OPEN_STATUSES }, priority: Priority.CRITICA });
export const criticalFindingsWhere = (): Prisma.AuditFindingWhereInput => ({ deletedAt: null, confirmed: true, severity: Severity.CRITICA, OR: [{ correctiveMeasures: { none: { deletedAt: null } } }, { correctiveMeasures: { some: { deletedAt: null, status: { notIn: ['VALIDADA', 'CANCELADA'] } } } }] });
export const overdueCorrectivesWhere = (now: Date): Prisma.CorrectiveMeasureWhereInput => ({ deletedAt: null, status: { notIn: ['VALIDADA', 'CANCELADA'] }, dueAt: { lt: now } });
export const cashDifferencesWhere = (range: MetricRange): Prisma.CashAuditWhereInput => ({ createdAt: { gte: range.from, lte: range.to }, difference: { not: 0 } });

export type ManagementEvidenceKind = 'tasks-overdue' | 'critical-incidents' | 'critical-findings' | 'corrective-overdue' | 'cash-differences';
const TITLES: Record<ManagementEvidenceKind, string> = {
  'tasks-overdue': 'Tareas vencidas', 'critical-incidents': 'Incidencias críticas abiertas',
  'critical-findings': 'Hallazgos críticos confirmados', 'corrective-overdue': 'Correctivas vencidas',
  'cash-differences': 'Arqueos con diferencia',
};
export function managementEvidenceHref(kind: ManagementEvidenceKind | 'keys-risk', days: number, extra?: { floor?: number; countId?: string }) {
  const params = new URLSearchParams({ tipo: kind, dias: String(days) });
  if (extra?.floor !== undefined) params.set('piso', String(extra.floor));
  if (extra?.countId) params.set('conteo', extra.countId);
  return `/gerencia/evidencia?${params}`;
}
function assertManagementReader(user: CurrentUser) {
  if (!user.permissions.includes('management.dashboard.view')) throw new Error('No tienes permiso para consultar Gerencia.');
}

export async function getManagementEvidence(user: CurrentUser, input: { kind: string; days?: number; page?: number }) {
  assertManagementReader(user);
  if (!Object.hasOwn(TITLES, input.kind)) return null;
  const kind = input.kind as ManagementEvidenceKind;
  const now = new Date();
  const period = metricPeriod(input.days, now);
  const requestedPage = Number(input.page ?? 1);
  const pageSize = 30;
  const page = Number.isFinite(requestedPage) ? Math.min(Math.floor(2147483647 / pageSize), Math.max(1, Math.floor(requestedPage))) : 1;
  const pagination = { skip: (page - 1) * pageSize, take: pageSize };
  type EvidenceRow = { id: string; label: string; detail: string; at: Date | null; href: string | null };
  let rows: EvidenceRow[] = [];
  let total = 0;
  if (kind === 'tasks-overdue') {
    const where = overdueTasksWhere(now);
    const [count, items] = await Promise.all([prisma.task.count({ where }), prisma.task.findMany({ where, ...pagination, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], select: { id: true, humanId: true, title: true, dueAt: true, assignee: { select: { name: true } } } })]);
    total = count; rows = items.map(r => ({ id: r.id, label: `Tarea #${r.humanId} · ${r.title}`, detail: r.assignee?.name ?? 'Sin responsable', at: r.dueAt, href: `/tareas/${r.id}` }));
  } else if (kind === 'critical-incidents') {
    const where = criticalIncidentsWhere();
    const [count, items] = await Promise.all([prisma.operationalEntry.count({ where }), prisma.operationalEntry.findMany({ where, ...pagination, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { id: true, humanId: true, title: true, occurredAt: true, owner: { select: { name: true } } } })]);
    total = count; rows = items.map(r => ({ id: r.id, label: `Incidencia #${r.humanId} · ${r.title}`, detail: r.owner?.name ?? 'Sin responsable', at: r.occurredAt, href: `/libro/${r.id}` }));
  } else if (kind === 'critical-findings') {
    const where = criticalFindingsWhere();
    const [count, items] = await Promise.all([prisma.auditFinding.count({ where }), prisma.auditFinding.findMany({ where, ...pagination, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, humanId: true, title: true, createdAt: true, audit: { select: { humanId: true, templateName: true } } } })]);
    total = count; rows = items.map(r => ({ id: r.id, label: `Hallazgo #${r.humanId} · ${r.title}`, detail: `Auditoría #${r.audit.humanId} · ${r.audit.templateName}`, at: r.createdAt, href: user.permissions.includes('supervision.audit.reserved') ? `/supervision/auditorias?q=${r.audit.humanId}` : null }));
  } else if (kind === 'corrective-overdue') {
    const where = overdueCorrectivesWhere(now);
    const [count, items] = await Promise.all([prisma.correctiveMeasure.count({ where }), prisma.correctiveMeasure.findMany({ where, ...pagination, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], select: { id: true, humanId: true, title: true, dueAt: true, assignee: { select: { name: true } } } })]);
    total = count; rows = items.map(r => ({ id: r.id, label: `Correctiva #${r.humanId} · ${r.title}`, detail: r.assignee.name, at: r.dueAt, href: user.permissions.includes('supervision.audit.reserved') ? '/supervision/auditorias' : null }));
  } else {
    const where = cashDifferencesWhere(period.current);
    const [count, items] = await Promise.all([prisma.cashAudit.count({ where }), prisma.cashAudit.findMany({ where, ...pagination, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, humanId: true, currency: true, difference: true, expectedAmount: true, countedAmount: true, createdAt: true } })]);
    total = count; rows = items.map(r => ({ id: r.id, label: `Arqueo #${r.humanId} · ${signedMoney(r.currency, Number(r.difference))}`, detail: `Esperado ${signedMoney(r.currency, Number(r.expectedAmount))} · contado ${signedMoney(r.currency, Number(r.countedAmount))}. Causa no acreditada por esta cifra.`, at: r.createdAt, href: user.permissions.includes('cash.view') ? `/caja/arqueos/${r.id}` : null }));
  }
  return { title: TITLES[kind], kind, period, rows, total, page, pageSize, hasMore: page * pageSize < total, currentState: kind !== 'cash-differences' };
}

/** Read-only snapshot already summarized by the cockpit; never grants key operations. */
export async function getManagementKeyEvidence(user: CurrentUser, input: { floor?: number; countId?: string }) {
  assertManagementReader(user);
  const floors = input.floor === undefined ? [4, 5, 6] : [input.floor].filter(f => [4, 5, 6].includes(f));
  return Promise.all(floors.map(floor => prisma.keyInventoryCount.findFirst({
    where: { floor, ...(input.countId ? { id: input.countId } : {}) },
    orderBy: [{ countedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, humanId: true, floor: true, countedAt: true, items: { orderBy: { room: { number: 'asc' } }, select: { id: true, roomNumberSnapshot: true, room: { select: { number: true } }, expected: true, found: true, outOfService: true } } },
  })));
}
