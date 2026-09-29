export type ProactiveSeverity = 'BAJA' | 'MEDIA' | 'ALTA';
export type ProactiveConfidence = 'BAJA' | 'MEDIA' | 'ALTA';

export type ProactiveSignal = {
  id: string;
  severity: ProactiveSeverity;
  source: string;
  date: string;
  title: string;
  detail: string;
};

export type ProactiveGroup = {
  title: string;
  severity: ProactiveSeverity;
  confidence: ProactiveConfidence;
  signalIds: string[];
  explanation: string;
  nextAction: string;
};

export type ProactiveBrief = {
  summary: string;
  groups: ProactiveGroup[];
};

const SEVERITY_RANK: Record<ProactiveSeverity, number> = {
  BAJA: 1,
  MEDIA: 2,
  ALTA: 3,
};

function clean(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : '';
}

export function severityAtLeast(
  severity: ProactiveSeverity,
  minimum: ProactiveSeverity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minimum];
}

export function highestSignalSeverity(
  signalIds: string[],
  signals: ProactiveSignal[],
): ProactiveSeverity {
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  let highest: ProactiveSeverity = 'BAJA';
  for (const id of signalIds) {
    const signal = byId.get(id);
    if (signal && SEVERITY_RANK[signal.severity] > SEVERITY_RANK[highest]) {
      highest = signal.severity;
    }
  }
  return highest;
}

function jsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new Error('Fronti no devolvió JSON interpretable.');
  }
}

export function parseProactiveBrief(
  raw: string,
  signals: ProactiveSignal[],
): ProactiveBrief {
  const payload = jsonPayload(raw);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('El briefing proactivo no tiene la estructura esperada.');
  }

  const root = payload as Record<string, unknown>;
  const summary = clean(root.summary, 800);
  const groupsRaw = Array.isArray(root.groups) ? root.groups : [];
  const validSignalIds = new Set(signals.map((signal) => signal.id));
  const groups: ProactiveGroup[] = [];

  for (const rawGroup of groupsRaw.slice(0, 4)) {
    if (!rawGroup || Array.isArray(rawGroup) || typeof rawGroup !== 'object') continue;
    const row = rawGroup as Record<string, unknown>;
    const title = clean(row.title, 180);
    const explanation = clean(row.explanation, 900);
    const nextAction = clean(row.nextAction, 500);
    const confidence: ProactiveConfidence =
      row.confidence === 'ALTA' || row.confidence === 'BAJA' ? row.confidence : 'MEDIA';
    const ids = Array.isArray(row.signalIds)
      ? [...new Set(
          row.signalIds.filter(
            (value): value is string => typeof value === 'string' && validSignalIds.has(value),
          ),
        )]
      : [];

    if (!title || !explanation || !nextAction || ids.length === 0) continue;

    groups.push({
      title,
      severity: highestSignalSeverity(ids, signals),
      confidence,
      signalIds: ids,
      explanation,
      nextAction,
    });
  }

  if (!summary || groups.length === 0) {
    throw new Error('Fronti no produjo grupos utilizables para las señales recibidas.');
  }

  return { summary, groups };
}
