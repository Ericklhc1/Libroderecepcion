import 'server-only';

import { AuditAction, SupervisionShiftStatus, type Prisma } from '@prisma/client';
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

export type SupervisionReportKind =
  | 'AUDITORIA_FORMULARIO'
  | 'ACTIVIDAD'
  | 'ENTRADAS'
  | 'COBROS'
  | 'VENTAS_CANAL'
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
  VENTAS_CANAL: 'Ventas por canal',
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

function compactText(lines: string[]): string {
  return lines.join(' ').replace(/\s+/g, ' ').trim();
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
  const datePattern = /(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:\D|$)/;

  // El nombre del archivo es la fuente más estable: los PDF operativos de FNS
  // llevan la fecha de emisión. Antes se buscaba primero en el texto y podía
  // capturarse la llegada/salida de un huésped (por ejemplo 01/10) como si
  // fuera la fecha del informe.
  const fileMatch = fileName.match(datePattern);
  if (fileMatch?.[1] && fileMatch[2] && fileMatch[3]) {
    const normalized = normalizeReportedDate(fileMatch[1], fileMatch[2], fileMatch[3]);
    if (normalized) return normalized;
  }

  const header = text.slice(0, 800);
  const anchoredHeader = header.match(
    /(?:hotel\s+hw\s+libertad|informe(?:\s+de)?|reporte(?:\s+diario)?|formulario\s+auditor[ií]a|in\s*house)[^\d]{0,80}(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i,
  );
  if (anchoredHeader?.[1] && anchoredHeader[2] && anchoredHeader[3]) {
    const normalized = normalizeReportedDate(anchoredHeader[1], anchoredHeader[2], anchoredHeader[3]);
    if (normalized) return normalized;
  }

  // Último recurso: sólo aceptamos una fecha genérica si es la única del
  // encabezado. Si hay varias, es mejor pedir/usar la fecha operativa vigente
  // que inventar cuál corresponde al informe.
  const candidates = Array.from(
    header.matchAll(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:\D|$)/g),
  )
    .map((match) =>
      match[1] && match[2] && match[3]
        ? normalizeReportedDate(match[1], match[2], match[3])
        : null,
    )
    .filter((value): value is string => Boolean(value));

  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

const EXPECTED_FIELDS: Partial<Record<SupervisionReportKind, number>> = {
  ACTIVIDAD: 1,
  ENTRADAS: 1,
  VENTAS_CANAL: 8,
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
  const findings = kind === 'AUDITORIA_FORMULARIO' ? findingsFromAudit(text, checks) : [];
  const metrics = metricsFor(kind, text, checks);
  const completeness = completenessFor(kind, metrics, checks);
  if (completeness && completeness.found < completeness.expected) {
    warnings.push(
      `Formato parcialmente reconocido: se extrajeron ${completeness.found} de ${completeness.expected} campos/control(es) esperados para ${REPORT_LABELS[kind]}.`,
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

  const text = compactText(linesFromFragments(fragments));
  const parsed = parseSupervisionReportText(fileName, text);

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

    const metrics = {
      ...jsonObject(existing?.metrics),
      ...input.parsed.metrics,
    } as Prisma.InputJsonObject;
    const checks =
      input.parsed.kind === 'AUDITORIA_FORMULARIO'
        ? input.parsed.checks
        : mergeByKey(
            jsonArray<SupervisionAuditCheck>(existing?.checks),
            input.parsed.checks,
          );
    const findings =
      input.parsed.kind === 'AUDITORIA_FORMULARIO'
        ? input.parsed.findings
        : mergeByKey(
            jsonArray<SupervisionAuditFinding>(existing?.findings),
            input.parsed.findings,
          );
    const reviewState = parseSupervisionAuditReviewState(existing?.reviewState);
    // Un informe SALIDAS recién cargado es una nueva fotografía de origen:
    // sustituye cualquier ajuste manual previo del contador, para no ocultar datos más frescos.
    if (input.parsed.kind === 'SALIDAS') {
      delete reviewState.metrics.departuresPending;
    }
    const reportKinds = Array.from(new Set([...(existing?.reportKinds ?? []), input.parsed.kind]));
    const warnings = Array.from(new Set([...(existing?.warnings ?? []), ...input.parsed.warnings]));
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
    return saved;
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
