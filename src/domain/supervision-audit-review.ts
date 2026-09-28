import type { Prisma } from '@prisma/client';

export type AuditReviewStatus = 'RESUELTO' | 'NO_APLICA';

export type AuditReviewDecision = {
  status: AuditReviewStatus;
  note: string | null;
  at: string;
  byId: string;
  byName: string;
};

export type AuditMetricOverride = {
  value: number;
  note: string;
  at: string;
  byId: string;
  byName: string;
};

export type SupervisionAuditReviewState = {
  checks: Record<string, AuditReviewDecision>;
  findings: Record<string, AuditReviewDecision>;
  metrics: {
    departuresPending?: AuditMetricOverride;
  };
};

export type AuditCheckLike = {
  key: string;
  done: boolean | null;
};

export type AuditFindingLike = {
  key: string;
};

function object(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function decision(value: unknown): AuditReviewDecision | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.status !== 'RESUELTO' && row.status !== 'NO_APLICA') return null;
  if (typeof row.at !== 'string' || typeof row.byId !== 'string' || typeof row.byName !== 'string') {
    return null;
  }
  return {
    status: row.status,
    note: typeof row.note === 'string' && row.note.trim() ? row.note : null,
    at: row.at,
    byId: row.byId,
    byName: row.byName,
  };
}

function decisions(value: unknown): Record<string, AuditReviewDecision> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const out: Record<string, AuditReviewDecision> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = decision(raw);
    if (parsed) out[key] = parsed;
  }
  return out;
}

function metricOverride(value: unknown): AuditMetricOverride | undefined {
  if (!value || Array.isArray(value) || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.value !== 'number' ||
    !Number.isFinite(row.value) ||
    row.value < 0 ||
    typeof row.note !== 'string' ||
    typeof row.at !== 'string' ||
    typeof row.byId !== 'string' ||
    typeof row.byName !== 'string'
  ) {
    return undefined;
  }
  return {
    value: row.value,
    note: row.note,
    at: row.at,
    byId: row.byId,
    byName: row.byName,
  };
}

export function parseSupervisionAuditReviewState(
  value: Prisma.JsonValue | null | undefined,
): SupervisionAuditReviewState {
  const root = object(value);
  const metricRoot =
    root.metrics && !Array.isArray(root.metrics) && typeof root.metrics === 'object'
      ? (root.metrics as Record<string, unknown>)
      : {};
  return {
    checks: decisions(root.checks),
    findings: decisions(root.findings),
    metrics: {
      departuresPending: metricOverride(metricRoot.departuresPending),
    },
  };
}

export function isAuditReviewResolved(decisionValue: AuditReviewDecision | null | undefined): boolean {
  return decisionValue?.status === 'RESUELTO' || decisionValue?.status === 'NO_APLICA';
}

export function unresolvedAuditChecks<T extends AuditCheckLike>(
  checks: T[],
  reviewState: SupervisionAuditReviewState,
): T[] {
  return checks.filter(
    (check) => check.done !== true && !isAuditReviewResolved(reviewState.checks[check.key]),
  );
}

export function unresolvedAuditFindings<T extends AuditFindingLike>(
  findings: T[],
  checks: AuditCheckLike[],
  reviewState: SupervisionAuditReviewState,
): T[] {
  const checkByKey = new Map(checks.map((check) => [check.key, check]));
  return findings.filter((finding) => {
    if (isAuditReviewResolved(reviewState.findings[finding.key])) return false;
    if (finding.key.startsWith('check:')) {
      const checkKey = finding.key.slice('check:'.length);
      const check = checkByKey.get(checkKey);
      if (check?.done === true || isAuditReviewResolved(reviewState.checks[checkKey])) return false;
    }
    return true;
  });
}

export function sourceDeparturePending(metrics: Prisma.JsonValue): number | null {
  const root = object(metrics);
  const departures =
    root.departures && !Array.isArray(root.departures) && typeof root.departures === 'object'
      ? (root.departures as Record<string, unknown>)
      : {};
  const pending = departures.pending;
  return typeof pending === 'number' && Number.isFinite(pending) ? pending : null;
}

export function sourceDepartureTotal(metrics: Prisma.JsonValue): number | null {
  const root = object(metrics);
  const departures =
    root.departures && !Array.isArray(root.departures) && typeof root.departures === 'object'
      ? (root.departures as Record<string, unknown>)
      : {};
  const total = departures.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

export function effectiveDeparturePending(
  metrics: Prisma.JsonValue,
  reviewState: SupervisionAuditReviewState,
): number | null {
  return reviewState.metrics.departuresPending?.value ?? sourceDeparturePending(metrics);
}

export function auditOperationalPendingCount(input: {
  metrics: Prisma.JsonValue;
  checks: AuditCheckLike[];
  findings: AuditFindingLike[];
  reviewState: Prisma.JsonValue | null | undefined;
}): number {
  const review = parseSupervisionAuditReviewState(input.reviewState);
  const pendingChecks = unresolvedAuditChecks(input.checks, review);
  const pendingFindings = unresolvedAuditFindings(input.findings, input.checks, review).filter(
    (finding) => !finding.key.startsWith('check:'),
  );
  const departuresPending = effectiveDeparturePending(input.metrics, review);
  return pendingChecks.length + pendingFindings.length + (departuresPending && departuresPending > 0 ? 1 : 0);
}
