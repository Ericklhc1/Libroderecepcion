/**
 * Reglas de frescura para informes FNS que modifican el estado vivo.
 * El PDF imprime hora local del hotel; se interpreta exclusivamente en
 * America/Santiago y la comparación siempre ocurre en servidor.
 */
export const FNS_TIME_ZONE = 'America/Santiago';
export const LIVE_REPORT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const FUTURE_CLOCK_TOLERANCE_MS = 60 * 1000;

export type ReportFreshness =
  | { status: 'VALIDO'; generatedAt: Date; ageMs: number }
  | { status: 'VENCIDO'; generatedAt: Date; ageMs: number }
  | { status: 'INVALIDO'; generatedAt: Date | null; ageMs: number | null; reason: string };

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date): Parts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: FNS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const formatted = formatter.formatToParts(date);
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(formatted.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    year: numberPart('year'),
    month: numberPart('month'),
    day: numberPart('day'),
    hour: numberPart('hour'),
    minute: numberPart('minute'),
    second: numberPart('second'),
  };
}

function localSerial(p: Parts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Convierte DD/MM/YYYY HH:mm:ss de FNS en el instante real correspondiente en Santiago. */
export function parseFnsGeneratedAt(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const wanted: Parts = {
    day: Number(match[1]), month: Number(match[2]), year: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
  };
  if (wanted.month < 1 || wanted.month > 12 || wanted.day < 1 || wanted.day > 31 ||
      wanted.hour > 23 || wanted.minute > 59 || wanted.second > 59) return null;

  // Primera aproximación: tratar el reloj local como UTC. Dos correcciones son
  // suficientes incluso alrededor de cambios de offset.
  let instant = new Date(localSerial(wanted));
  for (let i = 0; i < 3; i += 1) {
    const shown = zonedParts(instant);
    const delta = localSerial(wanted) - localSerial(shown);
    if (delta === 0) break;
    instant = new Date(instant.getTime() + delta);
  }
  const final = zonedParts(instant);
  return localSerial(final) === localSerial(wanted) ? instant : null;
}

export function evaluateReportFreshness(rawGeneratedAt: string | null, now = new Date()): ReportFreshness {
  if (!rawGeneratedAt) {
    return { status: 'INVALIDO', generatedAt: null, ageMs: null, reason: 'El PDF no contiene la fecha y hora exactas de «Informe generado».' };
  }
  const generatedAt = parseFnsGeneratedAt(rawGeneratedAt);
  if (!generatedAt) {
    return { status: 'INVALIDO', generatedAt: null, ageMs: null, reason: 'La fecha/hora de generación de FNS es ilegible o imposible.' };
  }
  const ageMs = now.getTime() - generatedAt.getTime();
  if (ageMs < -FUTURE_CLOCK_TOLERANCE_MS) {
    return { status: 'INVALIDO', generatedAt, ageMs, reason: 'El informe declara una hora futura respecto del servidor.' };
  }
  if (ageMs > LIVE_REPORT_MAX_AGE_MS) return { status: 'VENCIDO', generatedAt, ageMs };
  return { status: 'VALIDO', generatedAt, ageMs: Math.max(0, ageMs) };
}

export const CLOSURE_REQUIRED_REPORTS = ['ACTIVIDAD', 'SALIDAS', 'IN_HOUSE'] as const;

export function validateClosureReportSet(
  reports: Array<{ kind: string | null; reportGeneratedAt: string | null }>,
  now = new Date(),
): { valid: boolean; missing: string[]; invalid: Array<{ kind: string | null; freshness: ReportFreshness }> } {
  const missing = CLOSURE_REQUIRED_REPORTS.filter((kind) => !reports.some((r) => r.kind === kind));
  const invalid = reports
    .filter((r) => CLOSURE_REQUIRED_REPORTS.includes(r.kind as (typeof CLOSURE_REQUIRED_REPORTS)[number]))
    .map((r) => ({ kind: r.kind, freshness: evaluateReportFreshness(r.reportGeneratedAt, now) }))
    .filter((r) => r.freshness.status !== 'VALIDO');
  return { valid: missing.length === 0 && invalid.length === 0, missing: [...missing], invalid };
}
