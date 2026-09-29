import 'server-only';

import { createHash } from 'node:crypto';
import {
  NotificationType,
  SupervisionShiftStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { calendarDateKey } from '@/domain/time';
import {
  effectiveDeparturePending,
  parseSupervisionAuditReviewState,
  unresolvedAuditChecks,
  unresolvedAuditFindings,
} from '@/domain/supervision-audit-review';
import {
  parseProactiveBrief,
  severityAtLeast,
  type ProactiveBrief,
  type ProactiveSeverity,
  type ProactiveSignal,
} from '@/domain/fronti-proactive';
import type {
  SupervisionAuditCheck,
  SupervisionAuditFinding,
} from '@/server/services/supervision-audit-import';
import { notify } from '@/server/notifications';
import { getFrontiConfig } from './fronti-config';
import {
  chatWithFrontiProviderChain,
  resolveFrontiProviderChainRuntime,
} from './fronti-provider';

const DEDUPE_MS = 24 * 60 * 60 * 1000;

function jsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function severityRank(value: ProactiveSeverity): number {
  return value === 'ALTA' ? 3 : value === 'MEDIA' ? 2 : 1;
}

function fingerprintFor(shiftId: string, signals: ProactiveSignal[]): string {
  const stable = signals
    .map((signal) => ({
      id: signal.id,
      severity: signal.severity,
      source: signal.source,
      date: signal.date,
      title: signal.title,
      detail: signal.detail,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return createHash('sha256')
    .update(JSON.stringify({ shiftId, stable }))
    .digest('hex')
    .slice(0, 32);
}

function signalSetForImport(input: {
  id: string;
  businessDate: Date;
  reportKinds: string[];
  metrics: Prisma.JsonValue;
  checks: Prisma.JsonValue;
  findings: Prisma.JsonValue;
  reviewState: Prisma.JsonValue;
}): ProactiveSignal[] {
  const date = calendarDateKey(input.businessDate);
  const source = input.reportKinds.join(' + ') || 'Auditoría';
  const checks = jsonArray<SupervisionAuditCheck>(input.checks);
  const findings = jsonArray<SupervisionAuditFinding>(input.findings);
  const review = parseSupervisionAuditReviewState(input.reviewState);

  const signals: ProactiveSignal[] = [];

  for (const check of unresolvedAuditChecks(checks, review)) {
    signals.push({
      id: `audit:${input.id}:check:${check.key}`,
      severity: 'MEDIA',
      source,
      date,
      title: `Control pendiente: ${check.label}`,
      detail: check.observation?.trim() || 'El informe no dejó este control como realizado.',
    });
  }

  for (const finding of unresolvedAuditFindings(findings, checks, review)) {
    if (finding.key.startsWith('check:')) continue;
    signals.push({
      id: `audit:${input.id}:finding:${finding.key}`,
      severity: finding.severity,
      source,
      date,
      title: finding.title,
      detail: finding.detail,
    });
  }

  const departuresPending = effectiveDeparturePending(input.metrics, review);
  if (departuresPending !== null && departuresPending > 0) {
    signals.push({
      id: `audit:${input.id}:departures-pending`,
      severity: 'MEDIA',
      source,
      date,
      title: 'Check-outs pendientes',
      detail: `La evidencia vigente mantiene ${departuresPending} check-out(s) pendiente(s).`,
    });
  }

  return signals;
}

function bodyForBrief(brief: ProactiveBrief, signalCount: number): string {
  const lines = [
    brief.summary,
    '',
    ...brief.groups.flatMap((group, index) => [
      `${index + 1}. [${group.severity} · confianza ${group.confidence}] ${group.title}`,
      group.explanation,
      `Siguiente revisión: ${group.nextAction}`,
      '',
    ]),
    `Fronti agrupó ${signalCount} señal(es) determinísticas. No modificó datos ni ejecutó acciones.`,
  ];

  return lines.join('\n').trim().slice(0, 5000);
}

async function analyzeShift(input: {
  shiftId: string;
  supervisorId: string;
  supervisorName: string;
  signals: ProactiveSignal[];
  minSeverity: ProactiveSeverity;
  maxSignals: number;
  reasoningEffort: 'low' | 'medium' | 'high';
}): Promise<'notified' | 'deduplicated' | 'empty' | 'provider-unavailable'> {
  const filtered = input.signals
    .filter((signal) => severityAtLeast(signal.severity, input.minSeverity))
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, input.maxSignals);

  if (filtered.length === 0) return 'empty';

  const fingerprint = fingerprintFor(input.shiftId, filtered);
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.supervisorId,
      type: NotificationType.FRONTI_HALLAZGO,
      entity: 'FrontiProactiveBrief',
      entityId: fingerprint,
      createdAt: { gte: new Date(Date.now() - DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (existing) return 'deduplicated';

  const providers = await resolveFrontiProviderChainRuntime({
    reasoningEffort: input.reasoningEffort,
  });
  if (providers.length === 0) return 'provider-unavailable';

  const result = await chatWithFrontiProviderChain({
    providers,
    toolChoice: 'none',
    messages: [
      {
        role: 'system',
        content:
          'Eres Fronti en modo de análisis proactivo del Centro de Supervisión. ' +
          'Recibirás señales que YA fueron detectadas por reglas determinísticas del Libro. ' +
          'Tu tarea es agrupar señales relacionadas y explicar relaciones plausibles sin inventar hechos. ' +
          'No declares fraude, culpabilidad, causa raíz ni certeza cuando las señales no lo demuestran. ' +
          'No cambies severidades: el servidor las calculará desde las señales citadas. ' +
          'No propongas ejecutar cambios automáticos; sólo indicar qué revisar o verificar. ' +
          'Devuelve ÚNICAMENTE JSON válido con esta forma: ' +
          '{"summary":"resumen breve","groups":[{"title":"problema probable","confidence":"BAJA|MEDIA|ALTA","signalIds":["S1"],"explanation":"qué relación ves y sus límites","nextAction":"qué verificar"}]}. ' +
          'Máximo 4 grupos. Todo grupo debe citar signalIds recibidos. No agregues saludo, markdown ni texto fuera del JSON.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          supervisor: input.supervisorName,
          generatedAt: new Date().toISOString(),
          signals: filtered.map((signal, index) => ({
            id: `S${index + 1}`,
            originalId: signal.id,
            severity: signal.severity,
            source: signal.source,
            date: signal.date,
            title: signal.title,
            detail: signal.detail,
          })),
        }),
      },
    ],
  });

  const aliases = new Map(
    filtered.map((signal, index) => [`S${index + 1}`, signal.id]),
  );
  const modelSignals = filtered.map((signal, index) => ({
    ...signal,
    id: `S${index + 1}`,
  }));
  const parsed = parseProactiveBrief(result.text, modelSignals);
  const brief: ProactiveBrief = {
    summary: parsed.summary,
    groups: parsed.groups.map((group) => ({
      ...group,
      signalIds: group.signalIds
        .map((id) => aliases.get(id))
        .filter((id): id is string => Boolean(id)),
    })),
  };

  await notify({
    userId: input.supervisorId,
    type: NotificationType.FRONTI_HALLAZGO,
    title: `Fronti · análisis proactivo: ${brief.groups.length} foco(s)`,
    body: bodyForBrief(brief, filtered.length),
    link: '/supervision#fronti-proactivo',
    entity: 'FrontiProactiveBrief',
    entityId: fingerprint,
    internalOnly: true,
  });

  return 'notified';
}

export async function runProactiveSupervisionAnalysis(): Promise<{
  shifts: number;
  notified: number;
  deduplicated: number;
  empty: number;
  unavailable: number;
}> {
  const config = await getFrontiConfig();
  if (!config.enabled || !config.proactive.enabled) {
    return { shifts: 0, notified: 0, deduplicated: 0, empty: 0, unavailable: 0 };
  }

  const shifts = await prisma.supervisionShift.findMany({
    where: {
      status: SupervisionShiftStatus.ACTIVO,
      supervisor: {
        active: true,
        deletedAt: null,
        frontiAccessEnabled: true,
        role: { key: ROLE_KEYS.SUPERVISOR },
      },
    },
    select: {
      id: true,
      supervisorId: true,
      supervisor: { select: { name: true } },
      auditImports: {
        select: {
          id: true,
          businessDate: true,
          reportKinds: true,
          metrics: true,
          checks: true,
          findings: true,
          reviewState: true,
        },
        orderBy: { businessDate: 'desc' },
      },
    },
    orderBy: { startedAt: 'desc' },
  });

  const summary = {
    shifts: shifts.length,
    notified: 0,
    deduplicated: 0,
    empty: 0,
    unavailable: 0,
  };

  for (const shift of shifts) {
    const signals = shift.auditImports.flatMap((auditImport) =>
      signalSetForImport(auditImport),
    );
    try {
      const result = await analyzeShift({
        shiftId: shift.id,
        supervisorId: shift.supervisorId,
        supervisorName: shift.supervisor.name,
        signals,
        minSeverity: config.proactive.minSeverity,
        maxSignals: config.proactive.maxSignals,
        reasoningEffort: config.reasoningEffort,
      });
      if (result === 'notified') summary.notified += 1;
      if (result === 'deduplicated') summary.deduplicated += 1;
      if (result === 'empty') summary.empty += 1;
      if (result === 'provider-unavailable') summary.unavailable += 1;
    } catch (error) {
      console.warn('[fronti-proactivo] análisis no disponible', {
        shiftId: shift.id,
        error: error instanceof Error ? error.message : String(error),
      });
      summary.unavailable += 1;
    }
  }

  return summary;
}

export async function getLatestProactiveBriefForUser(
  userId: string,
  since?: Date | null,
) {
  return prisma.notification.findFirst({
    where: {
      userId,
      type: NotificationType.FRONTI_HALLAZGO,
      entity: 'FrontiProactiveBrief',
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      readAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
