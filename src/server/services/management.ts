import type { FollowUpReader } from './followup-access';
import 'server-only';

import {
  EntryStatus,
  EntryType,
  HandoverStatus,
  Priority,
  Severity,
  ShiftStatus,
  TaskStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addHotelCalendarDays, hotelDayStart } from '@/domain/time';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { getRoomMonitorOverview } from '@/server/services/room-monitor';
import {
  chatWithFrontiProviderChain,
  resolveFrontiBackgroundProviderChainRuntime,
} from '@/server/ai/fronti-provider';

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

export async function getManagementDecisionAdvice(
  decisions: ManagementDecision[],
): Promise<Record<string, string>> {
  if (decisions.length === 0) return {};

  try {
    const providers = await resolveFrontiBackgroundProviderChainRuntime({ reasoningEffort: 'low' });
    if (providers.length === 0) return {};

    const response = await chatWithFrontiProviderChain({
      providers,
      toolChoice: 'required',
      messages: [
        {
          role: 'system',
          content:
            'Eres Fronti, asistente operativo de AROH. Recibirás señales gerenciales ya detectadas por reglas determinísticas. ' +
            'No inventes hechos, montos, personas, causas ni identificadores. Para cada señal entrega una recomendación breve, concreta y accionable, ' +
            'basada únicamente en los hechos y evidencias proporcionados. Máximo 280 caracteres por recomendación.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            decisions.map((decision) => ({
              id: decision.id,
              title: decision.title,
              fact: decision.fact,
              why: decision.why,
              baseAction: decision.action,
              evidence: decision.evidence.map((item) => ({
                label: item.label,
                detail: item.detail,
              })),
            })),
          ),
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'entregar_sugerencias_gerencia',
            description: 'Devuelve una sugerencia operativa para cada señal de Gerencia.',
            strict: true,
            parameters: {
              type: 'object',
              properties: {
                suggestions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      advice: { type: 'string' },
                    },
                    required: ['id', 'advice'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['suggestions'],
              additionalProperties: false,
            },
          },
        },
      ],
    });

    const call = response.toolCalls.find(
      (item) => item.function.name === 'entregar_sugerencias_gerencia',
    );
    if (!call) return {};

    const parsed = JSON.parse(call.function.arguments) as {
      suggestions?: Array<{ id?: unknown; advice?: unknown }>;
    };
    const allowed = new Set(decisions.map((decision) => decision.id));
    const result: Record<string, string> = {};
    for (const item of parsed.suggestions ?? []) {
      if (typeof item.id !== 'string' || !allowed.has(item.id)) continue;
      if (typeof item.advice !== 'string') continue;
      const advice = item.advice.trim().replace(/\s+/g, ' ').slice(0, 360);
      if (advice) result[item.id] = advice;
    }
    return result;
  } catch (error) {
    console.warn(
      '[management] Fronti no pudo generar sugerencias; se conserva la acción determinística.',
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}

export async function getManagementCockpit(user: FollowUpReader, inputDays = 30) {
  const now = new Date();
  const days = normalizeDays(inputDays);
  const period = periodFor(days, now);
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
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { in: TASK_OPEN_STATUSES },
        dueAt: { lt: now },
      },
      select: {
        id: true,
        humanId: true,
        title: true,
        dueAt: true,
        assignee: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 30,
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
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        type: EntryType.INCIDENCIA,
        status: { in: ENTRY_OPEN_STATUSES },
        priority: Priority.CRITICA,
      },
      select: {
        id: true,
        humanId: true,
        title: true,
        occurredAt: true,
        owner: { select: { name: true } },
        room: { select: { number: true } },
      },
      orderBy: { occurredAt: 'asc' },
      take: 30,
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
        expectedAmount: true,
        countedAmount: true,
        difference: true,
        createdAt: true,
        countedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    getRoomMonitorOverview(user, now),
    prisma.checklistRun.count({
      where: { deletedAt: null, status: { not: 'CERRADA' } },
    }),
    prisma.auditFinding.findMany({
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
      select: {
        id: true,
        humanId: true,
        title: true,
        createdAt: true,
        audit: { select: { humanId: true, templateName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 30,
    }),
    prisma.correctiveMeasure.count({
      where: {
        deletedAt: null,
        status: { notIn: ['VALIDADA', 'CANCELADA'] },
      },
    }),
    prisma.correctiveMeasure.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['VALIDADA', 'CANCELADA'] },
        dueAt: { lt: now },
      },
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
      take: 30,
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

  const overdueTasks = overdueTaskRows.length;
  const criticalOpenIncidents = criticalOpenIncidentRows.length;
  const criticalFindings = criticalFindingRows.length;
  const correctiveOverdue = correctiveOverdueRows.length;

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
  if (cashDifferences.length > 0) {
    decisions.push({
      id: 'cash-differences',
      severity: 'critica',
      title: 'Diferencias de Caja detectadas',
      fact: `${cashDifferences.length} arqueo(s) del período registraron diferencia física.`,
      why: 'Las diferencias repetidas pueden indicar un problema de proceso, custodia o regularización pendiente.',
      action: 'Revisar patrón, causa y correcciones antes del siguiente cierre.',
      href: '/caja?seccion=auditorias',
      evidence: cashDifferences.slice(0, 5).map((row) => {
        const difference = Number(row.difference);
        return {
          id: `cash-${row.id}`,
          label: `Arqueo #${row.humanId} · ${row.currency} ${difference > 0 ? '+' : ''}${difference.toLocaleString('es-CL')}`,
          detail:
            `Esperado ${Number(row.expectedAmount).toLocaleString('es-CL')} · contado ${Number(row.countedAmount).toLocaleString('es-CL')} · ${row.countedBy.name}`,
          href: `/caja/arqueos/${row.id}`,
          at: row.createdAt,
        };
      }),
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
      href: '/llaves?piso=todos',
      evidence: keySnapshots
        .filter((row) => row.missing > 0 || row.outOfService > 0)
        .map((row) => ({
          id: `keys-floor-${row.floor}`,
          label: `Piso ${row.floor}`,
          detail: `${row.missing} faltante(s) · ${row.outOfService} fuera de servicio`,
          href: `/llaves?piso=${row.floor}`,
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
      roomContext: 'connected' as const,
      cash: 'connected' as const,
      keys: 'connected' as const,
      audits: 'connected' as const,
    },
  };
}
