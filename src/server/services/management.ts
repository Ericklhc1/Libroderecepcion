import 'server-only';

import {
  EntryStatus,
  EntryType,
  FollowUpStatus,
  HandoverStatus,
  OperationalAlarmStatus,
  Priority,
  Severity,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addHotelCalendarDays, hotelDayStart } from '@/domain/time';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';

export type ManagementDecisionSeverity = 'critica' | 'atencion' | 'seguimiento';

export type ManagementDecision = {
  id: string;
  severity: ManagementDecisionSeverity;
  title: string;
  fact: string;
  why: string;
  action: string;
  href: string;
};

export type ManagementTrend = {
  key: string;
  label: string;
  current: number | null;
  previous: number | null;
  unit: '%' | 'h' | 'n';
  better: 'higher' | 'lower';
};

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function normalizeDays(input: number): 7 | 30 | 90 {
  if (input === 7 || input === 90) return input;
  return 30;
}

function periodFor(days: 7 | 30 | 90, now: Date) {
  const currentFrom = hotelDayStart(addHotelCalendarDays(now, -(days - 1)));
  const currentTo = now;
  const previousTo = new Date(currentFrom.getTime() - 1);
  const previousFrom = hotelDayStart(addHotelCalendarDays(currentFrom, -days));
  return {
    days,
    current: { from: currentFrom, to: currentTo },
    previous: { from: previousFrom, to: previousTo },
  };
}

function sortDecisions(items: ManagementDecision[]) {
  const order: Record<ManagementDecisionSeverity, number> = {
    critica: 0,
    atencion: 1,
    seguimiento: 2,
  };
  return items.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title, 'es'));
}

export async function getManagementCockpit(inputDays = 30) {
  const now = new Date();
  const days = normalizeDays(inputDays);
  const period = periodFor(days, now);
  const currentRange = { gte: period.current.from, lte: period.current.to };
  const previousRange = { gte: period.previous.from, lte: period.previous.to };

  const [
    currentTasksClosed,
    previousTasksClosed,
    overdueTasks,
    currentIncidentClosures,
    previousIncidentClosures,
    currentIncidentVolume,
    previousIncidentVolume,
    openIncidents,
    criticalOpenIncidents,
    currentHandoversSent,
    currentHandoversReceived,
    previousHandoversSent,
    previousHandoversReceived,
    currentShifts,
    currentShiftsClosed,
    previousShifts,
    previousShiftsClosed,
    cashAudits,
    openFollowUps,
    overdueFollowUps,
    activeAlarms,
    overdueAlarms,
    auditsOpen,
    criticalFindings,
    correctiveOpen,
    correctiveOverdue,
    floor4,
    floor5,
    floor6,
  ] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: TaskStatus.COMPLETADA,
        completedAt: currentRange,
      },
      select: { completedAt: true, dueAt: true },
    }),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: TaskStatus.COMPLETADA,
        completedAt: previousRange,
      },
      select: { completedAt: true, dueAt: true },
    }),
    prisma.task.count({
      where: {
        deletedAt: null,
        status: { in: TASK_OPEN_STATUSES },
        dueAt: { lt: now },
      },
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: [EntryStatus.CERRADO, EntryStatus.RESUELTO] },
        closedAt: currentRange,
      },
      select: { occurredAt: true, closedAt: true },
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: [EntryStatus.CERRADO, EntryStatus.RESUELTO] },
        closedAt: previousRange,
      },
      select: { occurredAt: true, closedAt: true },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        occurredAt: currentRange,
      },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        occurredAt: previousRange,
      },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
      },
    }),
    prisma.operationalEntry.count({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
        priority: Priority.CRITICA,
      },
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
        date: currentRange,
        status: { not: ShiftStatus.ANULADO },
      },
    }),
    prisma.shift.count({
      where: { date: currentRange, status: ShiftStatus.CERRADO },
    }),
    prisma.shift.count({
      where: {
        date: previousRange,
        status: { not: ShiftStatus.ANULADO },
      },
    }),
    prisma.shift.count({
      where: { date: previousRange, status: ShiftStatus.CERRADO },
    }),
    prisma.cashAudit.findMany({
      where: { createdAt: currentRange },
      select: {
        id: true,
        humanId: true,
        currency: true,
        difference: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.followUp.count({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
      },
    }),
    prisma.followUp.count({
      where: {
        deletedAt: null,
        status: FollowUpStatus.VENCIDO,
      },
    }),
    prisma.operationalAlarm.count({
      where: { status: OperationalAlarmStatus.ACTIVA },
    }),
    prisma.operationalAlarm.count({
      where: {
        status: OperationalAlarmStatus.ACTIVA,
        dueAt: { lt: now },
      },
    }),
    prisma.checklistRun.count({
      where: { deletedAt: null, status: { not: 'CERRADA' } },
    }),
    prisma.auditFinding.count({
      where: {
        deletedAt: null,
        confirmed: true,
        severity: Severity.CRITICA,
        OR: [
          { correctiveMeasures: { none: { deletedAt: null } } },
          {
            correctiveMeasures: {
              some: {
                deletedAt: null,
                status: { notIn: ['VALIDADA', 'CANCELADA'] },
              },
            },
          },
        ],
      },
    }),
    prisma.correctiveMeasure.count({
      where: {
        deletedAt: null,
        status: { notIn: ['VALIDADA', 'CANCELADA'] },
      },
    }),
    prisma.correctiveMeasure.count({
      where: {
        deletedAt: null,
        status: { notIn: ['VALIDADA', 'CANCELADA'] },
        dueAt: { lt: now },
      },
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 4 },
      orderBy: { countedAt: 'desc' },
      select: {
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 5 },
      orderBy: { countedAt: 'desc' },
      select: {
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
    prisma.keyInventoryCount.findFirst({
      where: { floor: 6 },
      orderBy: { countedAt: 'desc' },
      select: {
        countedAt: true,
        items: { select: { expected: true, found: true, outOfService: true } },
      },
    }),
  ]);

  const taskOnTime = (rows: typeof currentTasksClosed) =>
    rows.filter((row) => !row.dueAt || (row.completedAt && row.completedAt <= row.dueAt)).length;
  const incidentHours = (rows: typeof currentIncidentClosures) =>
    rows
      .filter((row) => row.closedAt)
      .map((row) => (row.closedAt!.getTime() - row.occurredAt.getTime()) / 3_600_000);

  const currentTaskRate = safeRate(taskOnTime(currentTasksClosed), currentTasksClosed.length);
  const previousTaskRate = safeRate(taskOnTime(previousTasksClosed), previousTasksClosed.length);
  const currentIncidentAvg = average(incidentHours(currentIncidentClosures));
  const previousIncidentAvg = average(incidentHours(previousIncidentClosures));
  const currentHandoverRate = safeRate(currentHandoversReceived, currentHandoversSent);
  const previousHandoverRate = safeRate(previousHandoversReceived, previousHandoversSent);
  const currentShiftClosureRate = safeRate(currentShiftsClosed, currentShifts);
  const previousShiftClosureRate = safeRate(previousShiftsClosed, previousShifts);

  const cashDifferences = cashAudits.filter((row) => Number(row.difference) !== 0);
  const cashDifferenceByCurrency = Array.from(
    cashDifferences.reduce((map, row) => {
      map.set(row.currency, (map.get(row.currency) ?? 0) + Math.abs(Number(row.difference)));
      return map;
    }, new Map<string, number>()),
  ).map(([currency, amount]) => ({ currency, amount }));

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
    return { floor, countedAt: snapshot?.countedAt ?? null, ...totals };
  });
  const keysMissing = keySnapshots.reduce((sum, row) => sum + row.missing, 0);
  const keysOutOfService = keySnapshots.reduce((sum, row) => sum + row.outOfService, 0);

  const decisions: ManagementDecision[] = [];

  if (correctiveOverdue > 0) {
    decisions.push({
      id: 'corrective-overdue',
      severity: 'critica',
      title: 'Medidas correctivas vencidas',
      fact: `${correctiveOverdue} medida(s) correctiva(s) vencida(s) siguen abiertas.`,
      why: 'Un hallazgo con acción vencida mantiene el riesgo abierto aunque la auditoría ya haya terminado.',
      action: 'Definir responsable, nueva fecha o escalamiento.',
      href: '/supervision/auditorias',
    });
  }
  if (cashDifferences.length > 0) {
    decisions.push({
      id: 'cash-differences',
      severity: 'critica',
      title: 'Diferencias de Caja detectadas',
      fact: `${cashDifferences.length} arqueo(s) del período registraron diferencia física.`,
      why: 'Las diferencias repetidas pueden indicar un problema de proceso, custodia o regularización pendiente.',
      action: 'Revisar patrón, causa y correcciones antes del siguiente cierre.',
      href: '/caja?seccion=auditorias',
    });
  }
  if (criticalOpenIncidents > 0) {
    decisions.push({
      id: 'critical-incidents',
      severity: 'critica',
      title: 'Incidencias críticas abiertas',
      fact: `${criticalOpenIncidents} incidencia(s) crítica(s) continúan abiertas.`,
      why: 'Una incidencia crítica abierta concentra riesgo operativo y puede requerir coordinación entre áreas.',
      action: 'Confirmar contención, responsable y plazo de resolución.',
      href: '/libro?clase=entry&tipo=INCIDENCIA',
    });
  }
  if (overdueFollowUps > 0) {
    decisions.push({
      id: 'followups-overdue',
      severity: 'atencion',
      title: 'Seguimientos vencidos',
      fact: `${overdueFollowUps} seguimiento(s) vencido(s) siguen abiertos.`,
      why: 'Un seguimiento vencido indica continuidad perdida aunque el hecho original siga registrado.',
      action: 'Revisar responsable, próximo paso y nueva fecha.',
      href: '/seguimientos',
    });
  }
  if (overdueAlarms > 0) {
    decisions.push({
      id: 'alarms-overdue',
      severity: 'atencion',
      title: 'Alertas vencidas sin cierre',
      fact: `${overdueAlarms} alerta(s) activa(s) ya superaron su fecha u hora programada.`,
      why: 'La alerta sirve para llamar la atención; si vence sin cierre, la atención solicitada no quedó confirmada.',
      action: 'Atender, posponer o cerrar explícitamente la alerta.',
      href: '/alertas',
    });
  }
  if (keysMissing > 0 || keysOutOfService > 0) {
    decisions.push({
      id: 'keys-risk',
      severity: 'atencion',
      title: 'Cobertura de llaves incompleta',
      fact: `${keysMissing} faltante(s) y ${keysOutOfService} fuera de servicio según los últimos inventarios disponibles.`,
      why: 'La cobertura física insuficiente aumenta el riesgo de contingencia durante llegadas y operación.',
      action: 'Validar reposición, recuperación o contingencia por piso.',
      href: '/llaves?piso=todos',
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
    });
  }
  if (overdueTasks > 0) {
    decisions.push({
      id: 'tasks-overdue',
      severity: 'seguimiento',
      title: 'Backlog vencido',
      fact: `${overdueTasks} tarea(s) abiertas superaron su fecha límite.`,
      why: 'El atraso sostenido puede señalar carga, dependencia o prioridades mal calibradas.',
      action: 'Reasignar, reprogramar o retirar bloqueos explícitamente.',
      href: '/tareas',
    });
  }
  if (criticalFindings > 0) {
    decisions.push({
      id: 'critical-findings',
      severity: 'seguimiento',
      title: 'Hallazgos críticos confirmados',
      fact: `${criticalFindings} hallazgo(s) crítico(s) confirmado(s) no tienen cierre correctivo completo.`,
      why: 'Un hallazgo crítico sigue siendo riesgo mientras no exista una medida validada o un cierre explícito.',
      action: 'Asegurar medida, responsable, plazo y evidencia hasta validación.',
      href: '/supervision/auditorias',
    });
  }

  const trends: ManagementTrend[] = [
    {
      key: 'task-on-time',
      label: 'Tareas completadas en plazo',
      current: currentTaskRate,
      previous: previousTaskRate,
      unit: '%',
      better: 'higher',
    },
    {
      key: 'incident-mttr',
      label: 'Tiempo medio de resolución de incidencias',
      current: currentIncidentAvg,
      previous: previousIncidentAvg,
      unit: 'h',
      better: 'lower',
    },
    {
      key: 'handover-compliance',
      label: 'Recepción de entregas de turno',
      current: currentHandoverRate,
      previous: previousHandoverRate,
      unit: '%',
      better: 'higher',
    },
    {
      key: 'shift-closure',
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
    decisions: sortDecisions(decisions).slice(0, 6),
    execution: {
      taskOnTimeRate: currentTaskRate,
      overdueTasks,
      openIncidents,
      criticalOpenIncidents,
      incidentAvgResolutionHours: currentIncidentAvg,
      handoverComplianceRate: currentHandoverRate,
      shiftClosureRate: currentShiftClosureRate,
    },
    continuity: {
      openFollowUps,
      overdueFollowUps,
      activeAlarms,
      overdueAlarms,
    },
    controls: {
      cashAudits: cashAudits.length,
      cashDifferences: cashDifferences.length,
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
      cash: 'connected' as const,
      keys: 'connected' as const,
      audits: 'connected' as const,
      commercialPms: 'not_connected' as const,
      finance: 'not_connected' as const,
      labor: 'not_connected' as const,
      guestVoice: 'not_connected' as const,
      benchmark: 'not_connected' as const,
    },
  };
}
