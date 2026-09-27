import 'server-only';

import { AuditAction, SupervisionShiftStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readPdfFragments } from '@/server/pms/read-pdf';
import { RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { ROLE_KEYS } from '@/lib/permissions';

export type SupervisionReportKind =
  | 'AUDITORIA_FORMULARIO'
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

export type ParsedSupervisionReport = {
  kind: SupervisionReportKind;
  label: string;
  metrics: Record<string, unknown>;
  checks: SupervisionAuditCheck[];
  findings: SupervisionAuditFinding[];
  warnings: string[];
};

const REPORT_LABELS: Record<SupervisionReportKind, string> = {
  AUDITORIA_FORMULARIO: 'Formulario de auditoría',
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
  if (/formulario auditor[ií]a/i.test(text)) return 'AUDITORIA_FORMULARIO';
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
    case 'AUDITORIA_FORMULARIO':
      return {
        audit: {
          controls: checks.length,
          completed: checks.filter((check) => check.done === true).length,
          notCompleted: checks.filter((check) => check.done === false).length,
          withoutAnswer: checks.filter((check) => check.done === null).length,
        },
      };
    default:
      return {};
  }
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

  return {
    kind,
    label: REPORT_LABELS[kind],
    metrics: metricsFor(kind, text, checks),
    checks,
    findings,
    warnings,
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
  return parseSupervisionReportText(fileName, text);
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
  input: { businessDate: Date; parsed: ParsedSupervisionReport },
) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR || user.isSystemAdmin) {
    throw new RuleError('Sólo el Supervisor operativo puede cargar la auditoría diaria.');
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.supervisionShift.findFirst({
      where: {
        supervisorId: user.id,
        status: SupervisionShiftStatus.ACTIVO,
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!shift) {
      throw new RuleError('Inicia tu turno de Supervisión antes de cargar informes de auditoría.');
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
    const checks = mergeByKey(
      jsonArray<SupervisionAuditCheck>(existing?.checks),
      input.parsed.checks,
    );
    const findings = mergeByKey(
      jsonArray<SupervisionAuditFinding>(existing?.findings),
      input.parsed.findings,
    );
    const reportKinds = Array.from(new Set([...(existing?.reportKinds ?? []), input.parsed.kind]));
    const warnings = Array.from(new Set([...(existing?.warnings ?? []), ...input.parsed.warnings]));

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
