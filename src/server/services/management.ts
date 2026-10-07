import { entryReadWhere } from './entry-visibility';
import 'server-only';
import type {CurrentUser} from '@/server/auth/current-user';
import { managementMetricTasks, overdueTasksWhere, criticalIncidentsWhere, criticalFindingsWhere, overdueCorrectivesWhere, cashDifferencesWhere, managementEvidenceHref } from './management-evidence';

import {
  EntryType,
  HandoverStatus,
  ShiftStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ENTRY_RESOLVED_STATUSES, TASK_COMPLETED_STATUSES, metricPeriod, metricCalendarRange, incidentResolutionAt, signedMoney, SHARED_METRIC_SCOPE, TASK_COMPLETION_DEFINITION, INCIDENT_RESOLUTION_DEFINITION } from '@/domain/operational-metrics';
import { ENTRY_OPEN_STATUSES } from '@/domain/labels';
import { getRoomMonitorOverview } from '@/server/services/room-monitor';
export type ManagementDecisionSeverity = 'critica' | 'atencion' | 'seguimiento';

export type ManagementDecisionEvidence = {
  id: string;
  label: string;
  detail: string;
  href: string;
  at?: Date | null;
};

export type ManagementDecision = {
  id: string;
  severity: ManagementDecisionSeverity;
  title: string;
  fact: string;
  why: string;
  action: string;
  href: string;
  evidence: ManagementDecisionEvidence[];
  evidenceTotal?: number;
  evidenceHref?: string;
};

export type ManagementTrend = {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  unit: '%' | 'h' | 'n';
  better: 'higher' | 'lower';
  currentDenominator?: number;
  previousDenominator?: number;
};

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sortDecisions(items: ManagementDecision[]) {
  const order: Record<ManagementDecisionSeverity, number> = {
    critica: 0,
    atencion: 1,
    seguimiento: 2,
  };
  return items.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title, 'es'));
}

export async function getManagementDecisionAdvice(
  decisions: ManagementDecision[],
): Promise<Record<string, string>> {
  // A page read must not initiate paid inference or rewrite signed source facts.
  return Object.fromEntries(decisions.map(decision => [decision.id, decision.action]));
}

export async function getManagementCockpit(user: CurrentUser, inputDays = 30) {
  const sharedMetricTasks=managementMetricTasks(user);
  const visibleEntries=entryReadWhere(user);
  const now = new Date();
  const period = metricPeriod(inputDays, now);
  const days = period.days;
  const currentRange = { gte: period.current.from, lte: period.current.to };
  const previousRange = { gte: period.previous.from, lte: period.previous.to };

  const [
    currentTasksClosed,
    previousTasksClosed,
    overdueTaskRows,
    currentIncidentClosures,
    previousIncidentClosures,
    currentIncidentVolume,
    previousIncidentVolume,
    openIncidents,
    criticalOpenIncidentRows,
    currentHandoversSent,
    currentHandoversReceived,
    previousHandoversSent,
    previousHandoversReceived,
    currentShifts,
    currentShiftsClosed,
    previousShifts,
    previousShiftsClosed,
    cashAudits,
    roomMonitor,
    auditsOpen,
    criticalFindingRows,
    correctiveOpen,
    correctiveOverdueRows,
    floor4,
    floor5,
    floor6,
    overdueTasks, criticalOpenIncidents, criticalFindings, correctiveOverdue,
    cashAuditTotal, cashDifferenceTotal, cashPositive, cashNegative,
    incidentsWithoutDate, tasksWithoutDate,
  ] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,AND:[sharedMetricTasks],
        status: { in: TASK_COMPLETED_STATUSES },
        completedAt: currentRange,
      },
      select: { completedAt: true, dueAt: true },
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,AND:[sharedMetricTasks],
        status: { in: TASK_COMPLETED_STATUSES },
        completedAt: previousRange,
      },
      select: { completedAt: true, dueAt: true },
    }),
    prisma.task.findMany({
      where: overdueTasksWhere(now,user),
      select: {
        id: true,
        humanId: true,
        title: true,
        dueAt: true,
        assignee: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 5,
    }),
    prisma.operationalEntry.findMany({
      where: { AND:[visibleEntries],
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_RESOLVED_STATUSES },
        OR: [{ resolvedAt: currentRange }, { resolvedAt: null, closedAt: currentRange }],
      },
      select: { occurredAt: true, resolvedAt: true, closedAt: true },
    }),
    prisma.operationalEntry.findMany({
      where: { AND:[visibleEntries],
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_RESOLVED_STATUSES },
        OR: [{ resolvedAt: previousRange }, { resolvedAt: null, closedAt: previousRange }],
      },
      select: { occurredAt: true, resolvedAt: true, closedAt: true },
    }),
    prisma.operationalEntry.count({
      where: { AND:[visibleEntries],
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        occurredAt: currentRange,
      },
    }),
    prisma.operationalEntry.count({
      where: { AND:[visibleEntries],
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        occurredAt: previousRange,
      },
    }),
    prisma.operationalEntry.count({
      where: { AND:[visibleEntries],
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    prisma.operationalEntry.findMany({
      where: criticalIncidentsWhere(user),
      select: {
        id: true,
        humanId: true,
        title: true,
        occurredAt: true,
        owner: { select: { name: true } },
        room: { select: { number: true } },
      },
      orderBy: { occurredAt: 'asc' },
      take: 5,
    }),
    prisma.shiftHandover.count({
      where: {
        issuedAt: currentRange,
        status: { in: [HandoverStatus.ENVIADA, HandoverStatus.RECIBIDA] },
      },
    }),
    prisma.shiftHandover.count({
      where: { issuedAt: currentRange, status: HandoverStatus.RECIBIDA },
    }),
    prisma.shiftHandover.count({
      where: {
        issuedAt: previousRange,
        status: { in: [HandoverStatus.ENVIADA, HandoverStatus.RECIBIDA] },
      },
    }),
    prisma.shiftHandover.count({
      where: { issuedAt: previousRange, status: HandoverStatus.RECIBIDA },
    }),
    prisma.shift.count({
      where: {
        date: metricCalendarRange(period.current),
        status: { not: ShiftStatus.ANULADO },
      },
    }),
    prisma.shift.count({
      where: { date: metricCalendarRange(period.current), status: ShiftStatus.CERRADO },
    }),
    prisma.shift.count({
      where: {
        date: metricCalendarRange(period.previous),
        status: { not: ShiftStatus.ANULADO },
      },
    }),
    prisma.shift.count({
      where: { date: metricCalendarRange(period.previous), status: ShiftStatus.CERRADO },
    }),
    prisma.cashAudit.findMany({
      where: cashDifferencesWhere(period.current),
      select: {
        id: true,
        humanId: true,
        currency: true,
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        createdAt: true,
        countedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    getRoomMonitorOverview(user,now),
    prisma.checklistRun.count({
      where: { deletedAt: null, status: { not: 'CERRADA' } },
    }),
    prisma.auditFinding.findMany({
      where: criticalFindingsWhere(),
      select: {
        id: true,
        humanId: true,
        title: true,
        createdAt: true,
        audit: { select: { humanId: true, templateName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    }),
    prisma.correctiveMeasure.count({
      where: {
        deletedAt: null,
        status: { notIn: ['VALIDADA', 'CANCELADA'] },
      },
    }),
    prisma.correctiveMeasure.findMany({
      where: overdueCorrectivesWhere(now),
      select: {
        id: true,
        humanId: true,
        title: true,
        dueAt: true,
        taskId: true,
        assignee: { select: { name: true } },
        finding: {
          select: {
            audit: { select: { humanId: true } },
          },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: 5,
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 4 },
      orderBy: { countedAt: 'desc' },
      select: {
        id: true, humanId: true,
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 5 },
      orderBy: { countedAt: 'desc' },
      select: {
        id: true, humanId: true,
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 6 },
      orderBy: { countedAt: 'desc' },
      select: {
        id: true, humanId: true,
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
    prisma.task.count({ where: overdueTasksWhere(now,user) }),
    prisma.operationalEntry.count({ where: criticalIncidentsWhere(user) }),
    prisma.auditFinding.count({ where: criticalFindingsWhere() }),
    prisma.correctiveMeasure.count({ where: overdueCorrectivesWhere(now) }),
    prisma.cashAudit.count({ where: { createdAt: currentRange } }),
    prisma.cashAudit.count({ where: cashDifferencesWhere(period.current) }),
    prisma.cashAudit.groupBy({ by: ['currency'], where: { createdAt: currentRange, difference: { gt: 0 } }, _sum: { difference: true } }),
    prisma.cashAudit.groupBy({ by: ['currency'], where: { createdAt: currentRange, difference: { lt: 0 } }, _sum: { difference: true } }),
    prisma.operationalEntry.count({ where: { AND:[visibleEntries], deletedAt: null, type: EntryType.INCIDENCIA, status: { in: ENTRY_RESOLVED_STATUSES }, resolvedAt: null, closedAt: null } }),
    prisma.task.count({ where: { deletedAt: null, AND: [sharedMetricTasks], status: { in: TASK_COMPLETED_STATUSES }, completedAt: null } }),
  ]);

  const taskOnTime = (rows: typeof currentTasksClosed) =>
    rows.filter((row) => !row.dueAt || (row.completedAt && row.completedAt <= row.dueAt)).length;
  const incidentHours = (rows: typeof currentIncidentClosures) =>
    rows
      .map((row) => ({ start: row.occurredAt, end: incidentResolutionAt(row) }))
      .filter((row) => row.end && row.end >= row.start)
      .map((row) => (row.end!.getTime() - row.start.getTime()) / 3_600_000);

  const currentTaskRate = safeRate(taskOnTime(currentTasksClosed), currentTasksClosed.length);
  const previousTaskRate = safeRate(taskOnTime(previousTasksClosed), previousTasksClosed.length);
  const currentIncidentAvg = average(incidentHours(currentIncidentClosures));
  const previousIncidentAvg = average(incidentHours(previousIncidentClosures));
  const currentHandoverRate = safeRate(currentHandoversReceived, currentHandoversSent);
  const previousHandoverRate = safeRate(previousHandoversReceived, previousHandoversSent);
  const currentShiftClosureRate = safeRate(currentShiftsClosed, currentShifts);
  const previousShiftClosureRate = safeRate(previousShiftsClosed, previousShifts);

  const cashDifferences = cashAudits;
  const cashDifferenceByCurrency = Array.from(new Set([...cashPositive, ...cashNegative].map(row => row.currency))).map(currency => {
    const positive = Number(cashPositive.find(row => row.currency === currency)?._sum.difference ?? 0);
    const negative = Number(cashNegative.find(row => row.currency === currency)?._sum.difference ?? 0);
    return { currency, amount: positive - negative, netAmount: positive + negative };
  });

  type KeyTotals = {
    expected: number;
    found: number;
    missing: number;
    outOfService: number;
  };
  const emptyKeyTotals = (): KeyTotals => ({
    expected: 0,
    found: 0,
    missing: 0,
    outOfService: 0,
  });
  const keySnapshots = [
    { floor: 4, snapshot: floor4 },
    { floor: 5, snapshot: floor5 },
    { floor: 6, snapshot: floor6 },
  ].map(({ floor, snapshot }) => {
    const totals = snapshot
      ? snapshot.items.reduce<KeyTotals>((acc, item) => {
          acc.expected += item.expected;
          acc.found += item.found;
          acc.outOfService += item.outOfService;
          acc.missing += Math.max(item.expected - item.found, 0);
          return acc;
        }, emptyKeyTotals())
      : emptyKeyTotals();
    return { floor, id: snapshot?.id ?? null, humanId: snapshot?.humanId ?? null, countedAt: snapshot?.countedAt ?? null, ...totals };
  });
  const keysMissing = keySnapshots.reduce((sum, row) => sum + row.missing, 0);
  const keysOutOfService = keySnapshots.reduce((sum, row) => sum + row.outOfService, 0);

  const decisions: ManagementDecision[] = [];

  if (correctiveOverdue > 0) {
    decisions.push({
      id: 'corrective-overdue',
      evidenceTotal: correctiveOverdue, evidenceHref: managementEvidenceHref('corrective-overdue', days),
      severity: 'critica',
      title: 'Medidas correctivas vencidas',
      fact: `${correctiveOverdue} medida(s) correctiva(s) vencida(s) siguen abiertas.`,
      why: 'Un hallazgo con acción vencida mantiene el riesgo abierto aunque la auditoría ya haya terminado.',
      action: 'Definir responsable, nueva fecha o escalamiento.',
      href: '/supervision/auditorias',
      evidence: correctiveOverdueRows.slice(0, 5).map((row) => ({
        id: `corrective-${row.id}`,
        label: `Correctiva #${row.humanId} · ${row.title}`,
        detail: `${row.assignee.name}${row.dueAt ? ` · venció ${row.dueAt.toISOString()}` : ''}`,
        href: row.taskId
          ? `/tareas/${row.taskId}`
          : row.finding?.audit.humanId
            ? `/supervision/auditorias?q=${row.finding.audit.humanId}`
            : '/supervision/auditorias',
        at: row.dueAt,
      })),
    });
  }
  if (cashDifferenceTotal > 0) {
    decisions.push({
      id: 'cash-differences',
      evidenceTotal: cashDifferenceTotal, evidenceHref: managementEvidenceHref('cash-differences', days),
      severity: 'critica',
      title: 'Diferencias de Caja detectadas',
      fact: `${cashDifferenceTotal} arqueo(s) del período registraron diferencia física.`,
      why: 'El arqueo acredita una diferencia; no acredita su causa ni responsabilidad. Un ajuste requiere evidencia propia.',
      action: 'Revisar patrón, causa y correcciones antes del siguiente cierre.',
      href: '/caja?seccion=auditorias',
      evidence: cashDifferences.slice(0, 5).map((row) => {
        const difference = Number(row.difference);
        return {
          id: `cash-${row.id}`,
          label: `Arqueo #${row.humanId} · ${signedMoney(row.currency, difference)}`,
          detail:
            `Esperado ${signedMoney(row.currency, Number(row.expectedAmount))} · contado ${signedMoney(row.currency, Number(row.countedAmount))} · ${row.countedBy.name}`,
          href: `/caja/arqueos/${row.id}`,
          at: row.createdAt,
        };
      }),
    });
  }
  if (criticalOpenIncidents > 0) {
    decisions.push({
      id: 'critical-incidents',
      evidenceTotal: criticalOpenIncidents, evidenceHref: managementEvidenceHref('critical-incidents', days),
      severity: 'critica',
      title: 'Incidencias críticas abiertas',
      fact: `${criticalOpenIncidents} incidencia(s) crítica(s) continúan abiertas.`,
      why: 'Una incidencia crítica abierta concentra riesgo operativo y puede requerir coordinación entre áreas.',
      action: 'Confirmar contención, responsable y plazo de resolución.',
      href: '/libro?clase=entry&tipo=INCIDENCIA',
      evidence: criticalOpenIncidentRows.slice(0, 5).map((row) => ({
        id: `incident-${row.id}`,
        label: `Incidencia #${row.humanId} · ${row.title}`,
        detail: [row.room?.number ? `Hab. ${row.room.number}` : null, row.owner?.name ?? null]
          .filter(Boolean)
          .join(' · ') || 'Incidencia crítica sin contexto adicional',
        href: `/libro/${row.id}`,
        at: row.occurredAt,
      })),
    });
  }
  if (roomMonitor.summary.critical > 0) {
    decisions.push({
      id: 'room-focus-critical',
      severity: 'critica',
      title: 'Habitaciones con riesgo operativo concentrado',
      fact: `${roomMonitor.summary.critical} habitación(es) tienen incidencia crítica o tarea vencida asociada.`,
      why: 'Concentrar novedades, tareas y alertas por habitación permite detectar dónde se acumula riesgo sin modelar ocupación PMS.',
      action: 'Abrir el mapa y revisar primero las habitaciones críticas.',
      href: '/novedades/habitacion',
      evidence: roomMonitor.rooms
        .filter((room) => room.attention === 'critical')
        .slice(0, 6)
        .map((room) => ({
          id: `room-${room.id}`,
          label: `Habitación ${room.number}`,
          detail: [
            room.criticalIncidents > 0 ? `${room.criticalIncidents} incidencia(s) crítica(s)` : null,
            room.overdueTasks > 0 ? `${room.overdueTasks} tarea(s) vencida(s)` : null,
          ].filter(Boolean).join(' · '),
          href: `/novedades/habitacion?habitacion=${room.number}#detalle-habitacion`,
          at: room.lastActivityAt,
        })),
    });
  }
  if (keysMissing > 0 || keysOutOfService > 0) {
    decisions.push({
      id: 'keys-risk',
      severity: 'atencion',
      title: 'Cobertura de llaves incompleta',
      fact: `${keysMissing} faltante(s) y ${keysOutOfService} fuera de servicio según los últimos inventarios disponibles.`,
      why: 'La cobertura física insuficiente aumenta el riesgo de contingencia durante la operación diaria.',
      action: 'Validar reposición, recuperación o contingencia por piso.',
      href: managementEvidenceHref('keys-risk', days),
      evidence: keySnapshots
        .filter((row) => row.missing > 0 || row.outOfService > 0)
        .map((row) => ({
          id: `keys-floor-${row.floor}`,
          label: `Piso ${row.floor}`,
          detail: `${row.missing} faltante(s) · ${row.outOfService} fuera de servicio`,
          href: managementEvidenceHref('keys-risk', days, { floor: row.floor, countId: row.id ?? undefined }),
          at: row.countedAt,
        })),
    });
  }
  const handoversPending = Math.max(currentHandoversSent - currentHandoversReceived, 0);
  if (handoversPending > 0) {
    decisions.push({
      id: 'handover-pending',
      severity: 'atencion',
      title: 'Continuidad de turnos incompleta',
      fact: `${handoversPending} entrega(s) enviada(s) en el período no figuran como recibidas.`,
      why: 'Una entrega sin recepción confirmada rompe la trazabilidad de continuidad.',
      action: 'Revisar los relevos pendientes y su estado operativo.',
      href: '/supervision',
      evidence: [{
        id: 'handover-pending',
        label: `${handoversPending} entrega(s) sin recepción confirmada`,
        detail: 'La entrega fue emitida pero todavía no figura como recibida.',
        href: '/supervision#continuidad',
      }],
    });
  }
  if (overdueTasks > 0) {
    decisions.push({
      id: 'tasks-overdue',
      evidenceTotal: overdueTasks, evidenceHref: managementEvidenceHref('tasks-overdue', days),
      severity: 'seguimiento',
      title: 'Backlog vencido',
      fact: `${overdueTasks} tarea(s) abiertas superaron su fecha límite.`,
      why: 'El atraso sostenido puede señalar carga, dependencia o prioridades mal calibradas.',
      action: 'Reasignar, reprogramar o retirar bloqueos explícitamente.',
      href: '/tareas',
      evidence: overdueTaskRows.slice(0, 5).map((row) => ({
        id: `task-${row.id}`,
        label: `Tarea #${row.humanId} · ${row.title}`,
        detail: row.assignee?.name ? `Responsable: ${row.assignee.name}` : 'Sin responsable asignado',
        href: `/tareas/${row.id}`,
        at: row.dueAt,
      })),
    });
  }
  if (criticalFindings > 0) {
    decisions.push({
      id: 'critical-findings',
      evidenceTotal: criticalFindings, evidenceHref: managementEvidenceHref('critical-findings', days),
      severity: 'seguimiento',
      title: 'Hallazgos críticos confirmados',
      fact: `${criticalFindings} hallazgo(s) crítico(s) confirmado(s) no tienen cierre correctivo completo.`,
      why: 'Un hallazgo crítico sigue siendo riesgo mientras no exista una medida validada o un cierre explícito.',
      action: 'Asegurar medida, responsable, plazo y evidencia hasta validación.',
      href: '/supervision/auditorias',
      evidence: criticalFindingRows.slice(0, 5).map((row) => ({
        id: `finding-${row.id}`,
        label: `Hallazgo #${row.humanId} · ${row.title}`,
        detail: `Auditoría #${row.audit.humanId} · ${row.audit.templateName}`,
        href: `/supervision/auditorias?q=${row.audit.humanId}`,
        at: row.createdAt,
      })),
    });
  }

  const trends: ManagementTrend[] = [
    {
      key: 'task-on-time',
      currentDenominator: currentTasksClosed.length, previousDenominator: previousTasksClosed.length,
      label: 'Tareas completadas en plazo',
      current: currentTaskRate,
      previous: previousTaskRate,
      unit: '%',
      better: 'higher',
    },
    {
      key: 'incident-mttr',
      currentDenominator: incidentHours(currentIncidentClosures).length, previousDenominator: incidentHours(previousIncidentClosures).length,
      label: 'Tiempo medio de resolución de incidencias',
      current: currentIncidentAvg,
      previous: previousIncidentAvg,
      unit: 'h',
      better: 'lower',
    },
    {
      key: 'handover-compliance',
      currentDenominator: currentHandoversSent, previousDenominator: previousHandoversSent,
      label: 'Recepción de entregas de turno',
      current: currentHandoverRate,
      previous: previousHandoverRate,
      unit: '%',
      better: 'higher',
    },
    {
      key: 'shift-closure',
      currentDenominator: currentShifts, previousDenominator: previousShifts,
      label: 'Cierre formal de turnos',
      current: currentShiftClosureRate,
      previous: previousShiftClosureRate,
      unit: '%',
      better: 'higher',
    },
    {
      key: 'incident-volume',
      label: 'Incidencias registradas',
      current: currentIncidentVolume,
      previous: previousIncidentVolume,
      unit: 'n',
      better: 'lower',
    },
  ];

  return {
    generatedAt: now,
    period,
    decisions: sortDecisions(decisions),
    scope: SHARED_METRIC_SCOPE,
    definitions: { tasks: TASK_COMPLETION_DEFINITION, incidents: INCIDENT_RESOLUTION_DEFINITION },
    execution: {
      taskOnTimeRate: currentTaskRate,
      tasksCompleted: currentTasksClosed.length,
      tasksOnTime: taskOnTime(currentTasksClosed),
      tasksWithoutDate,
      incidentsResolved: currentIncidentClosures.length,
      incidentResolutionSamples: incidentHours(currentIncidentClosures).length,
      incidentHistoricalClosures: currentIncidentClosures.filter(row => !row.resolvedAt).length,
      incidentsWithoutDate,
      handoversSent: currentHandoversSent, handoversReceived: currentHandoversReceived,
      shiftsTotal: currentShifts, shiftsClosed: currentShiftsClosed,
      overdueTasks,
      openIncidents,
      criticalOpenIncidents,
      incidentAvgResolutionHours: currentIncidentAvg,
      handoverComplianceRate: currentHandoverRate,
      shiftClosureRate: currentShiftClosureRate,
    },
    roomFocus: {
      totalRooms: roomMonitor.summary.total,
      roomsWithActivity: roomMonitor.summary.withActivity,
      criticalRooms: roomMonitor.summary.critical,
      openEntries: roomMonitor.summary.openEntries,
      openTasks: roomMonitor.summary.openTasks,
      activeAlarms: roomMonitor.summary.activeAlarms,
      openGuarantees: roomMonitor.summary.openGuarantees,
    },
    controls: {
      cashAudits: cashAuditTotal,
      cashDifferences: cashDifferenceTotal,
      cashDifferenceByCurrency,
      auditsOpen,
      criticalFindings,
      correctiveOpen,
      correctiveOverdue,
      keysMissing,
      keysOutOfService,
      keySnapshots,
    },
    trends,
    sources: {
      operational: 'connected' as const,
      roomContext: 'connected' as const,
      cash: 'connected' as const,
      keys: 'connected' as const,
      audits: 'connected' as const,
    },
  };
}
