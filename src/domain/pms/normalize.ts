/**
 * Normalización de los tres informes a una sola estructura.
 *
 * Los informes se parecen pero no coinciden: las entradas traen "Cliente", las
 * salidas parten el nombre en "Nombre" y "Apellidos", y el in house imprime la
 * llegada sin año. Aquí quedan todos con la misma forma, y lo que el informe no
 * dice queda en nulo: no se inventa nada.
 */
import type { ColumnField } from './columns';
import type { RawRecord, ReportKind, StructuredReport } from './layout';

/** Estado operativo que aporta cada informe. */
export type OperationalStatus = 'CHECK_IN' | 'IN_HOUSE' | 'CHECK_OUT';

export const STATUS_BY_REPORT: Record<ReportKind, OperationalStatus> = {
  ENTRADAS: 'CHECK_IN',
  IN_HOUSE: 'IN_HOUSE',
  SALIDAS: 'CHECK_OUT',
};

export const REPORT_LABELS: Record<ReportKind, string> = {
  ENTRADAS: 'Informe de entradas',
  IN_HOUSE: 'Informe in house',
  SALIDAS: 'Informe de salidas',
};

/** Estructura común a la que se reducen los tres informes. */
export type NormalizedStay = {
  reservationId: string;
  roomNumber: string | null;
  guestNames: string[];
  channel: string | null;
  arrivalDate: Date | null;
  departureDate: Date | null;
  pmsStatus: string | null;
  sourceReport: ReportKind;
  operationalStatus: OperationalStatus;
  /** Página y fila del informe, para poder señalar el origen en la revisión. */
  origin: { page: number; y: number };
  /** Problemas de la propia fila: sin habitación, fecha ilegible, etc. */
  issues: string[];
};

export type NormalizedReport = {
  kind: ReportKind;
  kindSource: StructuredReport['kindSource'];
  title: string | null;
  reportDate: Date | null;
  columns: StructuredReport['columns'];
  unmapped: StructuredReport['unmapped'];
  summary: StructuredReport['summary'];
  stays: NormalizedStay[];
  ignoredLines: string[];
};

function cell(record: RawRecord, field: ColumnField): string | null {
  const value = record.cells[field]?.trim();
  return value ? value : null;
}

/** Fecha completa dd/MM/yyyy. */
function parseFullDate(value: string): Date | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
}

/**
 * Fecha sin año (dd/MM), como la llegada del informe in house.
 *
 * El año se toma del informe. Si al hacerlo la fecha quedara muy en el futuro,
 * es una llegada del año anterior: pasa en la última semana de diciembre, con
 * huéspedes que cruzan el año.
 */
function parseShortDate(value: string, reference: Date | null): Date | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, day, month] = match;
  const base = reference ?? new Date();
  const candidate = new Date(base.getFullYear(), Number(month) - 1, Number(day));
  if (Number.isNaN(candidate.getTime())) return null;
  const sixMonths = 1000 * 60 * 60 * 24 * 183;
  if (candidate.getTime() - base.getTime() > sixMonths) {
    return new Date(base.getFullYear() - 1, Number(month) - 1, Number(day));
  }
  return candidate;
}

export function parseReportDate(value: string | null): Date | null {
  return value ? parseFullDate(value) : null;
}

function parseDateCell(
  value: string | null,
  reference: Date | null,
): { date: Date | null; unreadable: boolean } {
  if (!value) return { date: null, unreadable: false };
  const full = parseFullDate(value);
  if (full) return { date: full, unreadable: false };
  const short = parseShortDate(value, reference);
  if (short) return { date: short, unreadable: false };
  return { date: null, unreadable: true };
}

/** Número de habitación: se conserva el texto del PMS, sin ceros añadidos. */
function parseRoomNumber(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, '');
  return /^[0-9A-Za-z.-]{1,12}$/.test(cleaned) ? cleaned.toUpperCase() : null;
}

/**
 * Nombre del huésped titular.
 *
 * Cuando el informe separa nombre y apellidos los une en ese orden; cuando trae
 * una sola columna la usa tal cual. Los huéspedes de las líneas siguientes se
 * conservan todos, en el orden en que aparecen.
 */
function guestNames(record: RawRecord): string[] {
  const single = cell(record, 'guestName');
  const first = cell(record, 'firstName');
  const last = cell(record, 'lastName');

  const primary = single ?? [first, last].filter(Boolean).join(' ').trim();
  const names = primary ? [primary] : [];
  for (const extra of record.extraGuests) {
    const clean = extra.trim();
    if (clean && !names.includes(clean)) names.push(clean);
  }
  return names;
}

export function normalizeReport(report: StructuredReport): NormalizedReport | null {
  if (!report.kind) return null;
  const kind = report.kind;
  const reportDate = parseReportDate(report.reportDate);
  const operationalStatus = STATUS_BY_REPORT[kind];

  const stays = report.records.map((record): NormalizedStay => {
    const issues: string[] = [];
    const roomNumber = parseRoomNumber(cell(record, 'roomNumber'));
    if (!roomNumber) issues.push('La fila no trae número de habitación.');

    const names = guestNames(record);
    if (!names.length) issues.push('La fila no trae nombre de huésped.');

    const arrival = parseDateCell(cell(record, 'arrival'), reportDate);
    if (arrival.unreadable) issues.push('No se pudo leer la fecha de llegada.');
    const departure = parseDateCell(cell(record, 'departure'), reportDate);
    if (departure.unreadable) issues.push('No se pudo leer la fecha de salida.');

    return {
      reservationId: cell(record, 'reservationId') ?? '',
      roomNumber,
      guestNames: names,
      channel: cell(record, 'channel'),
      arrivalDate: arrival.date,
      departureDate: departure.date,
      pmsStatus: cell(record, 'pmsStatus'),
      sourceReport: kind,
      operationalStatus,
      origin: { page: record.page, y: record.y },
      issues,
    };
  });

  return {
    kind,
    kindSource: report.kindSource,
    title: report.title,
    reportDate,
    columns: report.columns,
    unmapped: report.unmapped,
    summary: report.summary,
    stays,
    ignoredLines: report.ignoredLines,
  };
}
