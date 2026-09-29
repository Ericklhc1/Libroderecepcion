import 'server-only';

import {
  AuditAction,
  SupervisionShiftStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readPdfFragments } from '@/server/pms/read-pdf';
import { readStructuredReport } from '@/domain/pms/layout';
import { normalizeReport } from '@/domain/pms/normalize';
import { RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS } from '@/lib/permissions';
import {
  parseSupervisionAuditReviewState,
  sourceDeparturePending,
  sourceDepartureTotal,
  type AuditReviewStatus,
} from '@/domain/supervision-audit-review';
import {
  parseSalesPeriodReport,
  salesPeriodFindings,
  type SalesPeriodMetrics,
} from '@/domain/supervision-sales-period';

export type SupervisionReportKind =
  | 'AUDITORIA_FORMULARIO'
  | 'ACTIVIDAD'
  | 'ENTRADAS'
  | 'COBROS'
  | 'VENTAS_CANAL'
  | 'VENTAS_PERIODO'
  | 'PRODUCCION_HABITACION'
  | 'SALIDAS'
  | 'REVENUE'
  | 'IN_HOUSE'
  | 'CARGOS_DIARIOS'
  | 'CIERRE_CAJA'
  | 'DESCONOCIDO';

export type SupervisionAuditCheck = {
  key: string;
  label: string;
  done: boolean | null;
  observation: string | null;
};

export type SupervisionAuditFinding = {
  key: string;
  severity: 'BAJA' | 'MEDIA' | 'ALTA';
  title: string;
  detail: string;
};

export const SUPERVISION_AUDIT_PARSER_VERSION = '1.25.0';

export type ParsedSupervisionReport = {
  kind: SupervisionReportKind;
  label: string;
  metrics: Record<string, unknown>;
  checks: SupervisionAuditCheck[];
  findings: SupervisionAuditFinding[];
  warnings: string[];
  reportedBusinessDate: string | null;
  completeness: { found: number; expected: number } | null;
};

const REPORT_LABELS: Record<SupervisionReportKind, string> = {
  AUDITORIA_FORMULARIO: 'Formulario de auditoría',
  ACTIVIDAD: 'Habitaciones con actividad',
  ENTRADAS: 'Entradas / Check-ins',
  COBROS: 'Cobros',
  VENTAS_CANAL: 'Ventas por canal (legado)',
  VENTAS_PERIODO: 'Ventas por período',
  PRODUCCION_HABITACION: 'Producción por habitación',
  SALIDAS: 'Salidas',
  REVENUE: 'Revenue',
  IN_HOUSE: 'In house',
  CARGOS_DIARIOS: 'Cargos diarios',
  CIERRE_CAJA: 'Cierre de caja',
  DESCONOCIDO: 'Informe no reconocido',
};

function linesFromFragments(
  fragments: Array<{ page: number; x: number; y: number; text: string }>,
): string[] {
  const sorted = [...fragments].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > 2.5) return b.y - a.y;
    return a.x - b.x;
  });
  const lines: Array<{ page: number; y: number; parts: Array<{ x: number; text: string }> }> = [];
  for (const fragment of sorted) {
    const current = lines.at(-1);
    if (!current || current.page !== fragment.page || Math.abs(current.y - fragment.y) > 2.5) {
      lines.push({ page: fragment.page, y: fragment.y, parts: [{ x: fragment.x, text: fragment.text }] });
    } else {
      current.parts.push({ x: fragment.x, text: fragment.text });
    }
  }
  return lines.map((line) =>
    line.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function numberEs(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function numberUs(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function matchNumber(text: string, pattern: RegExp, parser = numberEs): number | null {
  const match = pattern.exec(text);
  return parser(match?.[1]);
}

function kindOf(fileName: string, text: string): SupervisionReportKind {
  const name = fileName.toLocaleLowerCase('es-CL');
  const hasReservationIdentity =
    /(?:\bID\b|localizador|reserva(?:ci[oó]n)?)/i.test(text) &&
    /habitaci[oó]n|\broom\b/i.test(text) &&
    // Los informes FNS operativos traen IDs numéricos de reserva. Exigir al
    // menos uno evita acreditar prosa que sólo mencione "reservas/habitaciones".
    /\b\d{5,}\b/.test(text);

  if (/formulario auditor[ií]a/i.test(text)) return 'AUDITORIA_FORMULARIO';

  // El nombre del archivo nunca basta para acreditar un informe operativo:
  // un PDF escaneado o ajeno llamado "actividad.pdf" no puede abrir Supervisión.
  if (
    /habitaciones con actividad/i.test(text) ||
    ((name.includes('habitaciones con actividad') || name.includes('actividad')) &&
      hasReservationIdentity &&
      /check.?in|check.?out|ocupad[ao]|in.?house/i.test(text))
  ) {
    return 'ACTIVIDAD';
  }
  if (
    /informe de entradas/i.test(text) ||
    (name.includes('entradas') &&
      hasReservationIdentity &&
      /entrada|llegada|check.?in|arrival/i.test(text))
  ) {
    return 'ENTRADAS';
  }

  if (/operaciones de caja reservas/i.test(text) || /totales por forma de pago/i.test(text)) return 'COBROS';
  if (/informe detalle ventas periodo/i.test(text)) return 'VENTAS_PERIODO';
  if (/ingresos totales por canal/i.test(text)) return 'VENTAS_CANAL';
  if (/producci[oó]n por habitaci[oó]n/i.test(text)) return 'PRODUCCION_HABITACION';
  if (/informe de salidas/i.test(text)) return 'SALIDAS';
  if (/informe de revenue/i.test(text)) return 'REVENUE';
  if (/\bin[- ]?house\b/i.test(text)) return 'IN_HOUSE';
  if (/informe de cargos diarios/i.test(text)) return 'CARGOS_DIARIOS';
  if (name.includes('cierre de caja')) return 'CIERRE_CAJA';
  return 'DESCONOCIDO';
}

const AUDIT_PROMPTS: Array<{ key: string; label: string; needle: string }> = [
  { key: 'checkin-realizados', label: 'Check-in del día realizados', needle: 'todos los check in del día realizados' },
  { key: 'checkout-realizados', label: 'Check-out del día realizados', needle: 'todos los check out del día realizados' },
  { key: 'checkout-cobrados', label: 'Check-out del día cobrados', needle: 'todos los check out del día estén marcados como cobrados' },
  { key: 'tarifas-habitaciones', label: 'Tarifas y valores de habitaciones', needle: 'tarifas y valores estén correctas' },
  { key: 'tarifas-salones', label: 'Tarifas y valores de salones', needle: 'salones, que las tarifas y valores estén correctas' },
  { key: 'cobros-documentos', label: 'Forma de pago, moneda y documento', needle: 'correcta relación entre forma de pago' },
  { key: 'cargos-centro-costo', label: 'Cargos diarios y centro de costo', needle: 'todos los cargos están bien asociados' },
  { key: 'tickets-restaurante', label: 'Tíquets de restaurante cotejados', needle: 'cotejamos todos los tiquet de restaurante' },
  { key: 'mesas-restaurante', label: 'Mesas de Restaurante cerradas', needle: 'mesas sin cerrar en restaurante' },
  { key: 'auditoria-nocturna', label: 'Auditoría nocturna conciliada', needle: 'auditoría nocturna que estén bien todos los' },
  { key: 'centro-coste', label: 'Centro de coste cuadra con producción', needle: 'centro de coste que cuadre con producción' },
  { key: 'garantias', label: 'Garantías correctas en habitaciones', needle: 'todas las habitaciones tienen la garantía correcta' },
  { key: 'cuentas-sobre-dias', label: 'Cuentas sobre 7 días revisadas', needle: 'cuentas que exceden los 7 días' },
  { key: 'prevision-servicios', label: 'Previsión y servicios por habitación', needle: 'previsión de servicios y servicios por habitación' },
  { key: 'reservas-grupales', label: 'Reservas grupales revisadas', needle: 'informe de reservas grupales' },
  { key: 'facturas-rechazadas', label: 'Facturas rechazadas revisadas', needle: 'facturas rechazadas' },
  { key: 'habitaciones-sucias', label: 'Habitaciones pendientes marcadas sucias', needle: 'habitaciones ocupadas y pendientes de check-out' },
  { key: 'eventos-iniciados', label: 'Eventos iniciados del día realizados', needle: 'eventos iniciados del día realizados' },
  { key: 'eventos-finalizados', label: 'Eventos finalizados del día realizados', needle: 'eventos finalizados del día realizados' },
  { key: 'eventos-cobrados', label: 'Eventos finalizados del día cobrados', needle: 'eventos finalizados del día estén marcados como cobrados' },
];

function auditChecks(text: string): SupervisionAuditCheck[] {
  const lower = text.toLocaleLowerCase('es-CL');
  const located = AUDIT_PROMPTS.map((prompt) => ({
    ...prompt,
    index: lower.indexOf(prompt.needle),
  }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  return located.map((item, index) => {
    const nextIndex = located[index + 1]?.index ?? text.length;
    const segment = text.slice(item.index, nextIndex).replace(/\s+/g, ' ').trim();
    const status = segment.match(/\b(S[ií]|No)\b/i);
    const done = status ? /^s/i.test(status[1] ?? '') : null;
    const observation = status
      ? segment.slice((status.index ?? 0) + status[0].length).trim().slice(0, 500) || null
      : null;
    return { key: item.key, label: item.label, done, observation };
  });
}

function findingsFromAudit(text: string, checks: SupervisionAuditCheck[]): SupervisionAuditFinding[] {
  const findings: SupervisionAuditFinding[] = checks
    .filter((check) => check.done === false)
    .map((check) => ({
      key: `check:${check.key}`,
      severity: 'MEDIA',
      title: `Control no realizado: ${check.label}`,
      detail: check.observation || 'El formulario de auditoría lo marca como no realizado.',
    }));

  const pending = text.match(/Reserva con ID\s+(\d+)\s+tiene un pendiente de\s+([\d.,]+)\s*CLP/i);
  if (pending?.[1] && pending[2]) {
    findings.push({
      key: `pms-pending:${pending[1]}`,
      severity: 'MEDIA',
      title: `Saldo pendiente PMS · reserva ${pending[1]}`,
      detail: `El formulario reporta un pendiente de ${pending[2]} CLP y señala que el día ya estaba cerrado.`,
    });
  }
  return findings;
}

function metricsFor(kind: SupervisionReportKind, text: string, checks: SupervisionAuditCheck[]) {
  switch (kind) {
    case 'REVENUE': {
      const total = text.match(
        /Total\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+([\d.,]+)%\s+CL\$\s*([\d.]+)\s+CL\$\s*([\d.]+)\s+CL\$\s*([\d.]+)/i,
      );
      return {
        revenue: {
          occupancyPct: numberUs(total?.[1]),
          revenueClp: numberEs(total?.[2]),
          adrClp: numberEs(total?.[3]),
          revparClp: numberEs(total?.[4]),
        },
      };
    }
    case 'VENTAS_PERIODO':
      return {};
    case 'VENTAS_CANAL': {
      const total = text.match(
        /Total\s+CL\$\s*([\d.]+)\s+CL\$\s*([\d.]+)\s+CL\$\s*([\d.]+)\s+CL\$\s*([\d.]+)\s+([\d.,]+)\s*%\s+(\d+)\s+(\d+)\s+(\d+)/i,
      );
      return {
        salesChannels: {
          grossClp: numberEs(total?.[1]),
          netClp: numberEs(total?.[2]),
          adrClp: numberEs(total?.[3]),
          commissionsClp: numberEs(total?.[4]),
          commissionPct: numberUs(total?.[5]),
          reservations: numberUs(total?.[6]),
          roomNights: numberUs(total?.[7]),
          overnightStays: numberUs(total?.[8]),
        },
      };
    }
    case 'ACTIVIDAD':
      return { roomActivity: { recognized: true } };
    case 'ENTRADAS':
      return { entries: { recognized: true } };
    case 'COBROS':
      return {
        payments: {
          clpAmount: matchNumber(text, /CL\$\s+CL\$\s*([\d.]+)\s+(\d+)\s+US\$\s+US\$/i),
          clpOperations: matchNumber(text, /CL\$\s+CL\$\s*[\d.]+\s+(\d+)\s+US\$\s+US\$/i, numberUs),
          usdAmount: matchNumber(text, /US\$\s+US\$\s*([\d.]+)\s+(\d+)\s+Informe generado/i, numberUs),
          usdOperations: matchNumber(text, /US\$\s+US\$\s*[\d.]+\s+(\d+)\s+Informe generado/i, numberUs),
        },
      };
    case 'SALIDAS': {
      const checkout = text.match(/Total\s+Realizado\s+Pendiente\s+Check-out\s+(\d+)\s+(\d+)\s+(\d+)/i);
      return {
        departures: {
          total: numberUs(checkout?.[1]),
          completed: numberUs(checkout?.[2]),
          pending: numberUs(checkout?.[3]),
          totalClp: matchNumber(text, /CL\$\s*([\d.]+)\s+CL\$\s*0\s+US\$/i),
          totalUsd: matchNumber(text, /US\$\s*([\d.]+)\s+US\$\s*0/i, numberUs),
        },
      };
    }
    case 'PRODUCCION_HABITACION':
      return {
        roomProduction: {
          occupiedRoomsWithCost: matchNumber(text, /Habitaciones ocupadas\s+con coste\s+(\d+)/i, numberUs),
          totalClp: matchNumber(text, /Total CLP\s+CL\$\s*([\d.]+)/i),
          totalUsd: matchNumber(text, /Total USD\s+US\$\s*([\d.]+)/i, numberUs),
        },
      };
    case 'IN_HOUSE':
      return {
        inHouse: {
          rooms: matchNumber(text, /Habitaciones\s+in.?house\s+(\d+)/i, numberUs),
        },
      };
    case 'CARGOS_DIARIOS':
      return {
        dailyCharges: {
          noData: /Ning[uú]n dato disponible/i.test(text),
        },
      };
    case 'AUDITORIA_FORMULARIO': {
      const activity = text.match(
        /Ent\s+(\d+)\s*,?\s*Sal\s+(\d+)\s*,?\s*Des\s+(\d+)\s*,?\s*Occ\s+([\d.,]+)%/i,
      );
      return {
        audit: {
          controls: checks.length,
          completed: checks.filter((check) => check.done === true).length,
          notCompleted: checks.filter((check) => check.done === false).length,
          withoutAnswer: checks.filter((check) => check.done === null).length,
        },
        auditActivity: {
          entries: numberUs(activity?.[1]),
          departures: numberUs(activity?.[2]),
          breakfasts: numberUs(activity?.[3]),
          occupancyPct: numberUs(activity?.[4]),
        },
      };
    }
    default:
      return {};
  }
}

function normalizeReportedDate(dayRaw: string, monthRaw: string, yearRaw: string): string | null {
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  let year = Number(yearRaw);
  if (yearRaw.length === 2) year += 2000;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function reportedBusinessDate(fileName: string, text: string): string | null {
  for (const source of [text.slice(0, 800), fileName]) {
    const match = source.match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:\D|$)/);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const normalized = normalizeReportedDate(match[1], match[2], match[3]);
    if (normalized) return normalized;
  }
  return null;
}

const EXPECTED_FIELDS: Partial<Record<SupervisionReportKind, number>> = {
  ACTIVIDAD: 1,
  ENTRADAS: 1,
  VENTAS_CANAL: 8,
  VENTAS_PERIODO: 1,
  COBROS: 4,
  PRODUCCION_HABITACION: 3,
  SALIDAS: 5,
  REVENUE: 4,
  IN_HOUSE: 1,
  CARGOS_DIARIOS: 1,
  AUDITORIA_FORMULARIO: 20,
};

function countExtractedValues(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countExtractedValues(item), 0);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, item) => sum + countExtractedValues(item),
      0,
    );
  }
  return 0;
}

function completenessFor(
  kind: SupervisionReportKind,
  metrics: Record<string, unknown>,
  checks: SupervisionAuditCheck[],
): { found: number; expected: number } | null {
  const expected = EXPECTED_FIELDS[kind] ?? 0;
  if (expected === 0) return null;
  const found =
    kind === 'AUDITORIA_FORMULARIO'
      ? checks.length
      : Math.min(expected, countExtractedValues(metrics));
  return { found, expected };
}

export function parseSupervisionReportText(
  fileName: string,
  rawText: string,
): ParsedSupervisionReport {
  const text = rawText.replace(/\s+/g, ' ').trim();
  const kind = kindOf(fileName, text);
  const warnings: string[] = [];
  const salesPeriod = kind === 'VENTAS_PERIODO' ? parseSalesPeriodReport(rawText) : null;

  if (!text) {
    warnings.push(
      kind === 'CIERRE_CAJA'
        ? 'El cierre de caja parece ser una imagen/escaneo. No se guardó el archivo ni se inventaron datos: revisa Caja desde el Libro.'
        : 'El PDF no contiene texto legible. No se guardó el archivo.',
    );
  }
  if (kind === 'DESCONOCIDO') {
    warnings.push('El formato no se reconoció; el archivo se descartó después de la lectura y no aportó métricas.');
  }

  const checks = kind === 'AUDITORIA_FORMULARIO' ? auditChecks(text) : [];
  const findings =
    kind === 'AUDITORIA_FORMULARIO'
      ? findingsFromAudit(text, checks)
      : salesPeriod
        ? salesPeriodFindings(salesPeriod)
        : [];
  const metrics = salesPeriod ? { salesPeriod } : metricsFor(kind, text, checks);
  const completeness =
    salesPeriod
      ? { found: salesPeriod.visibleDays, expected: salesPeriod.expectedVisibleDays }
      : completenessFor(kind, metrics, checks);
  if (completeness && completeness.found < completeness.expected) {
    warnings.push(
      kind === 'VENTAS_PERIODO'
        ? `Ventas por período: el PDF contiene ${completeness.found} día(s) completos de ${completeness.expected} esperados hasta la fecha de generación. No se completaron fechas por inferencia.`
        : `Formato parcialmente reconocido: se extrajeron ${completeness.found} de ${completeness.expected} campos/control(es) esperados para ${REPORT_LABELS[kind]}.`,
    );
  }

  return {
    kind,
    label: REPORT_LABELS[kind],
    metrics,
    checks,
    findings,
    warnings,
    reportedBusinessDate: reportedBusinessDate(fileName, text),
    completeness,
  };
}

export async function parseSupervisionReport(
  fileName: string,
  data: Uint8Array,
): Promise<ParsedSupervisionReport> {
  let fragments: Awaited<ReturnType<typeof readPdfFragments>> = [];
  try {
    fragments = await readPdfFragments(data);
  } catch (error) {
    throw new RuleError(
      `No se pudo leer ${fileName}: ${error instanceof Error ? error.message : 'PDF inválido'}`,
    );
  }

  const lines = linesFromFragments(fragments);
  const parsed = parseSupervisionReportText(fileName, lines.join('\n'));

  // Para los informes que describen movimientos de habitaciones, reutilizamos
  // el lector PMS estructurado. Así la apertura no se limita a saber que el
  // archivo existe: conserva una señal por ID sobre lo que FNS parece tener
  // pendiente/procesado. La señal NO cambia el estado operativo del Libro.
  if (['ACTIVIDAD', 'ENTRADAS', 'SALIDAS'].includes(parsed.kind)) {
    const structured = readStructuredReport(fragments);
    const normalized = normalizeReport(structured);
    if (normalized) {
      const actionRows = normalized.stays
        .filter(
          (stay) =>
            stay.operationalStatus === 'CHECK_IN' ||
            stay.operationalStatus === 'CHECK_OUT',
        )
        .map((stay) => ({
          reservationId: stay.reservationId,
          roomNumber: stay.roomNumber,
          status: stay.operationalStatus,
          signal: stay.pmsProcessingSignal,
          confidence: stay.pmsProcessingConfidence,
        }));

      parsed.metrics = {
        ...parsed.metrics,
        pmsProcessing: {
          pending: actionRows.filter((row) => row.signal === 'PENDIENTE').length,
          processedProbable: actionRows.filter((row) => row.signal === 'PROCESADO_PROBABLE').length,
          unknown: actionRows.filter((row) => row.signal === null).length,
          rows: actionRows,
        },
      };

      if (actionRows.some((row) => row.signal === 'PROCESADO_PROBABLE')) {
        parsed.warnings = Array.from(new Set([
          ...parsed.warnings,
          'FNS presenta IDs enlazados y no enlazados en el mismo informe. Los no enlazados se muestran como procesados probables, pero requieren verificación humana.',
        ]));
      }
    }
  }

  return parsed;
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function jsonArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mergeByKey<T extends { key: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...a, ...b]) map.set(item.key, item);
  return [...map.values()];
}

type PmsProcessingRow = {
  reservationId: string;
  roomNumber: string | null;
  status: 'CHECK_IN' | 'CHECK_OUT';
  signal: 'PENDIENTE' | 'PROCESADO_PROBABLE' | null;
  confidence: 'ALTA' | 'MEDIA' | null;
};

function pmsProcessingRows(metrics: Record<string, unknown>): PmsProcessingRow[] {
  const processing = metrics.pmsProcessing;
  if (!processing || Array.isArray(processing) || typeof processing !== 'object') return [];
  const rows = (processing as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is PmsProcessingRow => {
    if (!row || Array.isArray(row) || typeof row !== 'object') return false;
    const item = row as Record<string, unknown>;
    return (
      typeof item.reservationId === 'string' &&
      (item.status === 'CHECK_IN' || item.status === 'CHECK_OUT')
    );
  });
}

function mergedMetrics(
  existingValue: Prisma.JsonValue | null | undefined,
  incoming: Record<string, unknown>,
  kind: SupervisionReportKind,
): Prisma.InputJsonObject {
  const existing = jsonObject(existingValue);
  const merged = { ...existing, ...incoming } as Record<string, unknown>;
  const incomingRows = pmsProcessingRows(incoming);
  if (incomingRows.length === 0) return merged as Prisma.InputJsonObject;

  const existingRows = pmsProcessingRows(existing);
  const replacedStatuses = new Set(incomingRows.map((row) => row.status));
  const rows =
    kind === 'ACTIVIDAD'
      ? incomingRows
      : [
          ...existingRows.filter((row) => !replacedStatuses.has(row.status)),
          ...incomingRows,
        ];

  const unique = new Map<string, PmsProcessingRow>();
  for (const row of rows) {
    unique.set(`${row.status}:${row.reservationId}`, row);
  }
  const allRows = [...unique.values()];
  merged.pmsProcessing = {
    pending: allRows.filter((row) => row.signal === 'PENDIENTE').length,
    processedProbable: allRows.filter((row) => row.signal === 'PROCESADO_PROBABLE').length,
    unknown: allRows.filter((row) => row.signal === null).length,
    rows: allRows,
  };
  return merged as Prisma.InputJsonObject;
}

function auditOwnedFinding(key: string): boolean {
  return key.startsWith('check:') || key.startsWith('pms-pending:');
}

function sameFinding(a: SupervisionAuditFinding | undefined, b: SupervisionAuditFinding | undefined): boolean {
  return Boolean(
    a &&
    b &&
    a.key === b.key &&
    a.severity === b.severity &&
    a.title === b.title &&
    a.detail === b.detail,
  );
}

function salesPeriodFromMetrics(value: Prisma.JsonValue | null | undefined): SalesPeriodMetrics | null {
  const root = jsonObject(value);
  const candidate = root.salesPeriod;
  if (!candidate || Array.isArray(candidate) || typeof candidate !== 'object') return null;
  const period = candidate as unknown as SalesPeriodMetrics;
  if (
    typeof period.periodStart !== 'string' ||
    typeof period.periodEnd !== 'string' ||
    !Array.isArray(period.daily)
  ) {
    return null;
  }
  return period;
}

function dateAtUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function dateKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcDay(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}

function jsonNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatCrossDates(rows: Array<{ date: string; detail?: string }>, limit = 6): string {
  const shown = rows
    .slice(0, limit)
    .map((row) => (row.detail ? `${row.date} (${row.detail})` : row.date));
  return rows.length > limit
    ? `${shown.join(', ')} y ${rows.length - limit} día(s) más`
    : shown.join(', ');
}

async function reconcileSalesPeriodImports(
  tx: Prisma.TransactionClient,
  shiftId: string,
): Promise<void> {
  const salesRows = await tx.supervisionAuditImport.findMany({
    where: {
      supervisionShiftId: shiftId,
      reportKinds: { has: 'VENTAS_PERIODO' },
    },
    select: {
      id: true,
      metrics: true,
      findings: true,
      reviewState: true,
    },
  });
  if (!salesRows.length) return;

  const activeRoomCount = await tx.room.count({ where: { active: true } });

  for (const salesRow of salesRows) {
    const salesPeriod = salesPeriodFromMetrics(salesRow.metrics);
    if (!salesPeriod || !salesPeriod.visibleThrough) continue;

    const from = dateAtUtc(salesPeriod.periodStart);
    const through = dateAtUtc(salesPeriod.visibleThrough);
    const evidenceRows = await tx.supervisionAuditImport.findMany({
      where: {
        businessDate: { gte: from, lte: through },
      },
      select: {
        id: true,
        businessDate: true,
        metrics: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    type DayEvidence = {
      auditActivity?: Record<string, unknown>;
      roomProduction?: Record<string, unknown>;
      inHouse?: Record<string, unknown>;
      pmsProcessing?: Record<string, unknown>;
    };
    const byDate = new Map<string, DayEvidence>();
    for (const row of evidenceRows) {
      const key = dateKeyUtc(row.businessDate);
      const evidence = byDate.get(key) ?? {};
      const metrics = jsonObject(row.metrics);
      const take = (name: keyof DayEvidence) => {
        if (evidence[name]) return;
        const section = metrics[name];
        if (section && !Array.isArray(section) && typeof section === 'object') {
          evidence[name] = section as Record<string, unknown>;
        }
      };
      take('auditActivity');
      take('roomProduction');
      take('inHouse');
      take('pmsProcessing');
      byDate.set(key, evidence);
    }

    const cross: SupervisionAuditFinding[] = [];

    const roomInventoryMismatch = salesPeriod.daily
      .filter(
        (day) =>
          activeRoomCount > 0 &&
          day.totalRooms !== null &&
          day.blockedRooms !== null &&
          day.totalRooms + day.blockedRooms !== activeRoomCount,
      )
      .map((day) => ({
        date: day.date,
        detail: `${day.totalRooms ?? '—'} vendibles + ${day.blockedRooms ?? '—'} bloqueadas ≠ ${activeRoomCount}`,
      }));
    if (roomInventoryMismatch.length) {
      cross.push({
        key: 'cross:sales-period:room-inventory',
        severity: 'ALTA',
        title: 'Inventario PMS no concilia con habitaciones activas del Libro',
        detail: `El hotel tiene ${activeRoomCount} habitaciones activas en el Libro. Diferencias: ${formatCrossDates(roomInventoryMismatch)}.`,
      });
    }

    const auditMismatch: Array<{ date: string; detail: string }> = [];
    const productionMismatch: Array<{ date: string; detail: string }> = [];
    const movementMismatch: Array<{ date: string; detail: string }> = [];
    const inHouseMismatch: Array<{ date: string; detail: string }> = [];

    for (const day of salesPeriod.daily) {
      const evidence = byDate.get(day.date);
      if (!evidence) continue;

      const audit = evidence.auditActivity;
      if (audit) {
        const differences: string[] = [];
        const entries = jsonNumber(audit.entries);
        const departures = jsonNumber(audit.departures);
        const breakfasts = jsonNumber(audit.breakfasts);
        const occupancy = jsonNumber(audit.occupancyPct);
        if (entries !== null && day.checkIns !== null && entries !== day.checkIns) {
          differences.push(`check-in ${entries}≠${day.checkIns}`);
        }
        if (departures !== null && day.checkOuts !== null && departures !== day.checkOuts) {
          differences.push(`check-out ${departures}≠${day.checkOuts}`);
        }
        if (breakfasts !== null && day.breakfasts !== null && breakfasts !== day.breakfasts) {
          differences.push(`desayunos ${breakfasts}≠${day.breakfasts}`);
        }
        if (
          occupancy !== null &&
          day.occupancyPct !== null &&
          Math.abs(occupancy - day.occupancyPct) > 0.1
        ) {
          differences.push(`OCC ${occupancy}%≠${day.occupancyPct}%`);
        }
        if (differences.length) auditMismatch.push({ date: day.date, detail: differences.join(', ') });
      }

      const production = evidence.roomProduction;
      if (production) {
        const differences: string[] = [];
        const rooms = jsonNumber(production.occupiedRoomsWithCost);
        const totalClp = jsonNumber(production.totalClp);
        if (rooms !== null && day.occupiedWithCost !== null && rooms !== day.occupiedWithCost) {
          differences.push(`hab. con coste ${rooms}≠${day.occupiedWithCost}`);
        }
        if (
          totalClp !== null &&
          day.roomRevenueClp !== null &&
          Math.abs(totalClp - day.roomRevenueClp) > 2
        ) {
          differences.push(
            `producción ${Math.round(totalClp).toLocaleString('es-CL')}≠${Math.round(day.roomRevenueClp).toLocaleString('es-CL')}`,
          );
        }
        if (differences.length) productionMismatch.push({ date: day.date, detail: differences.join(', ') });
      }

      const processing = evidence.pmsProcessing;
      if (processing && Array.isArray(processing.rows)) {
        const rows = processing.rows.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        );
        const checkIns = rows.filter((item) => item.status === 'CHECK_IN').length;
        const checkOuts = rows.filter((item) => item.status === 'CHECK_OUT').length;
        const differences: string[] = [];
        if (day.checkIns !== null && checkIns > 0 && checkIns !== day.checkIns) {
          differences.push(`check-in PDF ${checkIns}≠ventas ${day.checkIns}`);
        }
        if (day.checkOuts !== null && checkOuts > 0 && checkOuts !== day.checkOuts) {
          differences.push(`check-out PDF ${checkOuts}≠ventas ${day.checkOuts}`);
        }
        if (differences.length) movementMismatch.push({ date: day.date, detail: differences.join(', ') });
      }

      const inHouse = evidence.inHouse;
      if (inHouse) {
        const rooms = jsonNumber(inHouse.rooms);
        if (
          rooms !== null &&
          day.occupiedRooms !== null &&
          Math.abs(rooms - day.occupiedRooms) > 2
        ) {
          inHouseMismatch.push({
            date: day.date,
            detail: `In House ${rooms} vs ocupadas ${day.occupiedRooms}`,
          });
        }
      }
    }

    if (auditMismatch.length) {
      cross.push({
        key: 'cross:sales-period:audit-activity',
        severity: 'ALTA',
        title: 'Formulario de auditoría y ventas por período discrepan',
        detail: `Diferencias en actividad diaria: ${formatCrossDates(auditMismatch)}.`,
      });
    }
    if (productionMismatch.length) {
      cross.push({
        key: 'cross:sales-period:room-production',
        severity: 'ALTA',
        title: 'Producción por habitación no concilia con ventas por período',
        detail: `Diferencias en: ${formatCrossDates(productionMismatch)}.`,
      });
    }
    if (movementMismatch.length) {
      cross.push({
        key: 'cross:sales-period:pms-movements',
        severity: 'MEDIA',
        title: 'Movimientos PMS no coinciden entre informes',
        detail: `Check-in/check-out difieren en: ${formatCrossDates(movementMismatch)}. La señal de enlaces sigue siendo auxiliar y no cambia estados automáticamente.`,
      });
    }
    if (inHouseMismatch.length) {
      cross.push({
        key: 'cross:sales-period:in-house',
        severity: 'MEDIA',
        title: 'In House y ocupación del período no coinciden',
        detail: `Diferencias superiores a 2 habitaciones en: ${formatCrossDates(inHouseMismatch)}. Revisa la hora de emisión de ambos informes antes de concluir un error.`,
      });
    }

    const pmsLinenFines = salesPeriod.daily.reduce(
      (sum, day) => sum + (day.costCenters.multasBlancos ?? 0),
      0,
    );
    const linenFines = await tx.$queryRaw<Array<{ amount: unknown }>>`
      SELECT DISTINCT ON (f."id") f."amount"
        FROM "Fine" f
        JOIN "AuditLog" a
          ON a."entity" = 'Fine'
         AND a."entityId" = f."id"
         AND a."action" = 'CAMBIO_ESTADO'
         AND a."after"->>'status' = 'COBRADA'
       WHERE f."deletedAt" IS NULL
         AND f."kind"::text = 'BLANCO'
         AND f."currency" = 'CLP'
         AND a."createdAt" >= ${from}
         AND a."createdAt" < ${nextUtcDay(through)}
       ORDER BY f."id", a."createdAt" DESC
    `;
    const libroLinenFines = linenFines.reduce(
      (sum, fine) => sum + (fine.amount ? Number(fine.amount) : 0),
      0,
    );
    if (Math.abs(pmsLinenFines - libroLinenFines) > 2) {
      cross.push({
        key: 'cross:sales-period:linen-fines',
        severity: libroLinenFines === 0 || pmsLinenFines === 0 ? 'ALTA' : 'MEDIA',
        title: 'Multas por blancos del PMS no concilian con el Libro',
        detail: `Ventas por período muestra ${Math.round(pmsLinenFines).toLocaleString('es-CL')} en “Multas por Blancos”; el Libro suma ${Math.round(libroLinenFines).toLocaleString('es-CL')} en multas BLANCO cobradas dentro del mismo tramo visible. Revisa fecha de registro, estado y trazabilidad.`,
      });
    }

    const allExistingFindings = jsonArray<SupervisionAuditFinding>(salesRow.findings);
    const existingFindings = allExistingFindings.filter(
      (finding) => !finding.key.startsWith('cross:sales-period:'),
    );
    const previousCross = new Map(
      allExistingFindings
        .filter((finding) => finding.key.startsWith('cross:sales-period:'))
        .map((finding) => [finding.key, finding]),
    );
    const nextCross = new Map(cross.map((finding) => [finding.key, finding]));
    const review = parseSupervisionAuditReviewState(salesRow.reviewState);
    for (const key of Object.keys(review.findings)) {
      if (!key.startsWith('cross:sales-period:')) continue;
      if (!sameFinding(previousCross.get(key), nextCross.get(key))) {
        delete review.findings[key];
      }
    }

    await tx.supervisionAuditImport.update({
      where: { id: salesRow.id },
      data: {
        findings: mergeByKey(existingFindings, cross) as unknown as Prisma.InputJsonArray,
        reviewState: JSON.parse(JSON.stringify(review)) as Prisma.InputJsonObject,
      },
    });
  }
}

export async function mergeSupervisionAuditReport(
  user: CurrentUser,
  input: {
    businessDate: Date;
    parsed: ParsedSupervisionReport;
    sourceFile?: {
      sha256: string;
      size: number;
      parserVersion: string;
      reportedBusinessDate: string | null;
      completeness: { found: number; expected: number } | null;
    };
  },
) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('Sólo el Supervisor operativo puede cargar la auditoría diaria.');
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findFirst({
      where: {
        supervisorId: user.id,
        status: { in: [SupervisionShiftStatus.PREPARACION, SupervisionShiftStatus.ACTIVO] },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!shift) {
      throw new RuleError('Comienza la apertura de Supervisión antes de cargar los informes del día.');
    }

    const existing = await tx.supervisionAuditImport.findUnique({
      where: {
        supervisionShiftId_businessDate: {
          supervisionShiftId: shift.id,
          businessDate: input.businessDate,
        },
      },
    });

    const metrics = mergedMetrics(
      existing?.metrics,
      input.parsed.metrics,
      input.parsed.kind,
    );
    const checks =
      input.parsed.kind === 'AUDITORIA_FORMULARIO'
        ? input.parsed.checks
        : mergeByKey(
            jsonArray<SupervisionAuditCheck>(existing?.checks),
            input.parsed.checks,
          );
    const existingFindings = jsonArray<SupervisionAuditFinding>(existing?.findings);
    const findings =
      input.parsed.kind === 'AUDITORIA_FORMULARIO'
        ? mergeByKey(
            existingFindings.filter((finding) => !auditOwnedFinding(finding.key)),
            input.parsed.findings,
          )
        : input.parsed.kind === 'VENTAS_PERIODO'
          ? mergeByKey(
              existingFindings.filter(
                (finding) =>
                  !finding.key.startsWith('sales-period:') &&
                  !finding.key.startsWith('cross:sales-period:'),
              ),
              input.parsed.findings,
            )
          : mergeByKey(existingFindings, input.parsed.findings);
    const reviewState = parseSupervisionAuditReviewState(existing?.reviewState);
    if (input.parsed.kind === 'AUDITORIA_FORMULARIO') {
      for (const key of Object.keys(reviewState.findings)) {
        if (auditOwnedFinding(key)) delete reviewState.findings[key];
      }
    }
    if (input.parsed.kind === 'VENTAS_PERIODO') {
      for (const key of Object.keys(reviewState.findings)) {
        if (key.startsWith('sales-period:') || key.startsWith('cross:sales-period:')) {
          delete reviewState.findings[key];
        }
      }
    }
    // Un informe SALIDAS recién cargado es una nueva fotografía de origen:
    // sustituye cualquier ajuste manual previo del contador, para no ocultar datos más frescos.
    if (input.parsed.kind === 'SALIDAS') {
      delete reviewState.metrics.departuresPending;
    }
    const reportKinds = Array.from(new Set([...(existing?.reportKinds ?? []), input.parsed.kind]));
    const existingWarnings =
      input.parsed.kind === 'VENTAS_PERIODO'
        ? (existing?.warnings ?? []).filter((warning) => !warning.startsWith('Ventas por período:'))
        : (existing?.warnings ?? []);
    const warnings = Array.from(new Set([...existingWarnings, ...input.parsed.warnings]));
    const existingSourceFiles = jsonArray<{
      sha256: string;
      size: number;
      parserVersion: string;
      reportedBusinessDate: string | null;
      completeness: { found: number; expected: number } | null;
    }>(existing?.sourceFiles);
    const sourceFiles = input.sourceFile
      ? [
          ...existingSourceFiles.filter((item) => item.sha256 !== input.sourceFile?.sha256),
          input.sourceFile,
        ]
      : existingSourceFiles;

    const saved = await tx.supervisionAuditImport.upsert({
      where: {
        supervisionShiftId_businessDate: {
          supervisionShiftId: shift.id,
          businessDate: input.businessDate,
        },
      },
      update: {
        uploadedById: user.id,
        reportKinds,
        metrics,
        checks: checks as unknown as Prisma.InputJsonArray,
        findings: findings as unknown as Prisma.InputJsonArray,
        warnings,
        reviewState: JSON.parse(JSON.stringify(reviewState)) as Prisma.InputJsonObject,
        sourceFiles: sourceFiles as unknown as Prisma.InputJsonArray,
      },
      create: {
        supervisionShiftId: shift.id,
        businessDate: input.businessDate,
        uploadedById: user.id,
        reportKinds,
        metrics,
        checks: checks as unknown as Prisma.InputJsonArray,
        findings: findings as unknown as Prisma.InputJsonArray,
        warnings,
        reviewState: JSON.parse(JSON.stringify(reviewState)) as Prisma.InputJsonObject,
        sourceFiles: sourceFiles as unknown as Prisma.InputJsonArray,
      },
    });

    await recordAudit(
      {
        entity: 'SupervisionAuditImport',
        entityId: saved.id,
        action: existing ? AuditAction.EDITAR : AuditAction.CREAR,
        summary: `Auditoría diaria actualizada con ${input.parsed.label}`,
        user,
        after: {
          businessDate: input.businessDate,
          reportKind: input.parsed.kind,
          reportKinds,
          findings: findings.length,
          warnings: warnings.length,
          sourceFilePersisted: false,
          sourceFileHashesPersisted: sourceFiles.length,
          parserVersion: SUPERVISION_AUDIT_PARSER_VERSION,
        },
      },
      tx,
    );

    if (
      [
        'VENTAS_PERIODO',
        'AUDITORIA_FORMULARIO',
        'ACTIVIDAD',
        'ENTRADAS',
        'SALIDAS',
        'PRODUCCION_HABITACION',
        'IN_HOUSE',
      ].includes(input.parsed.kind)
    ) {
      await reconcileSalesPeriodImports(tx, shift.id);
    }

    return tx.supervisionAuditImport.findUniqueOrThrow({ where: { id: saved.id } });
  });
}


function assertActiveAuditReviewOwner(
  user: CurrentUser,
  row: { supervisionShift: { supervisorId: string; status: SupervisionShiftStatus } },
) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('Sólo el Supervisor operativo puede actualizar la revisión diaria.');
  }
  if (row.supervisionShift.supervisorId !== user.id) {
    throw new RuleError('Esa auditoría diaria pertenece al turno de otro Supervisor.');
  }
  if (row.supervisionShift.status !== SupervisionShiftStatus.ACTIVO) {
    throw new RuleError('La revisión diaria sólo puede modificarse mientras tu turno de Supervisión está activo.');
  }
}

export async function reviewSupervisionAuditItem(
  user: CurrentUser,
  input: {
    auditImportId: string;
    target: 'CHECK' | 'FINDING';
    key: string;
    status: AuditReviewStatus | null;
    note?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.supervisionAuditImport.findUnique({
      where: { id: input.auditImportId },
      include: { supervisionShift: { select: { supervisorId: true, status: true } } },
    });
    if (!row) throw new RuleError('Ese resumen de auditoría ya no existe.');
    assertActiveAuditReviewOwner(user, row);

    const collection =
      input.target === 'CHECK'
        ? jsonArray<SupervisionAuditCheck>(row.checks)
        : jsonArray<SupervisionAuditFinding>(row.findings);
    if (!collection.some((item) => item.key === input.key)) {
      throw new RuleError('Ese punto ya no forma parte de la auditoría vigente.');
    }

    const note = input.note?.trim() || null;
    if (input.status === 'NO_APLICA' && !note) {
      throw new RuleError('Indica por qué este punto no aplica antes de retirarlo del pendiente.');
    }

    const reviewState = parseSupervisionAuditReviewState(row.reviewState);
    const bucket = input.target === 'CHECK' ? reviewState.checks : reviewState.findings;
    const before = bucket[input.key] ?? null;
    if (input.status === null) {
      delete bucket[input.key];
    } else {
      bucket[input.key] = {
        status: input.status,
        note,
        at: new Date().toISOString(),
        byId: user.id,
        byName: user.name,
      };
    }

    const saved = await tx.supervisionAuditImport.update({
      where: { id: row.id },
      data: {
        reviewState: JSON.parse(JSON.stringify(reviewState)) as Prisma.InputJsonObject,
      },
    });
    await recordAudit(
      {
        entity: 'SupervisionAuditImport',
        entityId: row.id,
        action: AuditAction.EDITAR,
        summary:
          input.status === null
            ? `Punto de auditoría reabierto: ${input.key}`
            : `Punto de auditoría ${input.status === 'RESUELTO' ? 'resuelto' : 'marcado no aplicable'}: ${input.key}`,
        user,
        before: { target: input.target, key: input.key, decision: before },
        after: { target: input.target, key: input.key, decision: bucket[input.key] ?? null },
      },
      tx,
    );
    return saved;
  });
}

export async function updateSupervisionAuditDeparturesPending(
  user: CurrentUser,
  input: {
    auditImportId: string;
    value: number | null;
    note?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.supervisionAuditImport.findUnique({
      where: { id: input.auditImportId },
      include: { supervisionShift: { select: { supervisorId: true, status: true } } },
    });
    if (!row) throw new RuleError('Ese resumen de auditoría ya no existe.');
    assertActiveAuditReviewOwner(user, row);

    const importedPending = sourceDeparturePending(row.metrics);
    if (importedPending === null) {
      throw new RuleError('Esta carga no contiene un contador de check-outs pendientes.');
    }

    const total = sourceDepartureTotal(row.metrics);
    const reviewState = parseSupervisionAuditReviewState(row.reviewState);
    const before = reviewState.metrics.departuresPending ?? null;

    if (input.value === null) {
      delete reviewState.metrics.departuresPending;
    } else {
      if (!Number.isInteger(input.value) || input.value < 0) {
        throw new RuleError('Los check-outs pendientes deben ser un número entero igual o mayor que cero.');
      }
      if (total !== null && input.value > total) {
        throw new RuleError(`No puedes indicar más pendientes (${input.value}) que salidas informadas (${total}).`);
      }
      const note = input.note?.trim();
      if (!note) {
        throw new RuleError('Indica qué cambió para actualizar el estado operativo de check-outs.');
      }
      reviewState.metrics.departuresPending = {
        value: input.value,
        note,
        at: new Date().toISOString(),
        byId: user.id,
        byName: user.name,
      };
    }

    const saved = await tx.supervisionAuditImport.update({
      where: { id: row.id },
      data: {
        reviewState: JSON.parse(JSON.stringify(reviewState)) as Prisma.InputJsonObject,
      },
    });
    await recordAudit(
      {
        entity: 'SupervisionAuditImport',
        entityId: row.id,
        action: AuditAction.EDITAR,
        summary:
          input.value === null
            ? 'Check-outs pendientes restablecidos al valor del informe'
            : `Check-outs pendientes actualizados: ${importedPending} del informe → ${input.value} operativos`,
        user,
        before: { importedPending, override: before },
        after: {
          importedPending,
          override: reviewState.metrics.departuresPending ?? null,
        },
      },
      tx,
    );
    return saved;
  });
}

export async function listSupervisionAuditImportsForShift(shiftId: string) {
  return prisma.supervisionAuditImport.findMany({
    where: { supervisionShiftId: shiftId },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { businessDate: 'desc' },
  });
}
