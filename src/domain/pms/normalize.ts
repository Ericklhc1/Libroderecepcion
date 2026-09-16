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
import { parseMoney, type Money } from './money';
import { parsePaymentType, type ParsedPayment } from './payment';

/** Estado operativo que aporta cada informe. */
export type OperationalStatus = 'CHECK_IN' | 'IN_HOUSE' | 'CHECK_OUT';

/**
 * Estado que aporta cada informe, cuando lo aporta el informe entero.
 *
 * `ACTIVIDAD` no está acá a propósito: es el único informe cuyo estado NO lo
 * define el documento sino cada fila, en su columna «Tipo». Por eso el mapa
 * deja de ser total y quien lo consulta tiene que decidir qué hace cuando no
 * hay entrada, en vez de recibir un estado equivocado por omisión.
 */
export const STATUS_BY_REPORT: Partial<Record<ReportKind, OperationalStatus>> = {
  ENTRADAS: 'CHECK_IN',
  IN_HOUSE: 'IN_HOUSE',
  SALIDAS: 'CHECK_OUT',
};

/**
 * Cómo se lee la columna «Tipo» del informe de actividad.
 *
 * Son las tres palabras que imprime el PMS. «Ocupada» es la estadía en curso
 * —el equivalente al informe in house— y las otras dos son la llegada y la
 * salida del día.
 *
 * Importante y explícito: que el informe diga «Check-in» NO significa que el
 * check-in esté hecho. Significa que hay una llegada esperada para hoy. Lo
 * mismo con «Check-out»: es una salida que corresponde a hoy, no una salida
 * cerrada. Quien decide si el trámite se completó es el Libro, con sus llaves,
 * garantías y pendientes.
 */
export const ACTIVITY_TYPES: Record<string, OperationalStatus> = {
  'check-in': 'CHECK_IN',
  'check in': 'CHECK_IN',
  checkin: 'CHECK_IN',
  entrada: 'CHECK_IN',
  llegada: 'CHECK_IN',
  'check-out': 'CHECK_OUT',
  'check out': 'CHECK_OUT',
  checkout: 'CHECK_OUT',
  salida: 'CHECK_OUT',
  ocupada: 'IN_HOUSE',
  ocupado: 'IN_HOUSE',
  'in house': 'IN_HOUSE',
  'in-house': 'IN_HOUSE',
  alojado: 'IN_HOUSE',
};

/** Traduce la columna «Tipo» a estado operativo. `null` si no se reconoce. */
export function activityStatus(raw: string | null): OperationalStatus | null {
  if (!raw) return null;
  const key = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return ACTIVITY_TYPES[key] ?? null;
}

export const REPORT_LABELS: Record<ReportKind, string> = {
  ENTRADAS: 'Informe de entradas',
  IN_HOUSE: 'Informe in house',
  SALIDAS: 'Informe de salidas',
  ACTIVIDAD: 'Habitaciones con actividad',
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
  /** Huéspedes que declara la fila. Sólo lo trae el informe de actividad. */
  guestCount: number | null;
  /** Importe total de la estancia, con su moneda. Nunca un número suelto. */
  totalAmount: Money | null;
  /** Saldo pendiente de ESTA estancia, no de la habitación. */
  pendingAmount: Money | null;
  /** Forma de pago normalizada, con el texto original conservado. */
  payment: ParsedPayment | null;
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

/** Cantidad de huéspedes: un entero pequeño, o nada. */
function parseGuestCount(value: string | null): number | null {
  if (!value) return null;
  const digits = value.match(/\d+/)?.[0];
  if (!digits) return null;
  const count = Number(digits);
  return Number.isInteger(count) && count > 0 && count < 100 ? count : null;
}

export function normalizeReport(report: StructuredReport): NormalizedReport | null {
  if (!report.kind) return null;
  const kind = report.kind;
  const reportDate = parseReportDate(report.reportDate);
  const reportStatus = STATUS_BY_REPORT[kind] ?? null;

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

    const rawType = cell(record, 'pmsStatus');

    /*
      El estado sale de la fila cuando el informe no lo define, que es el caso
      del informe de actividad: su columna «Tipo» dice Check-in, Check-out u
      Ocupada por cada habitación. Si la palabra no se reconoce, la fila no se
      descarta —se conserva con el problema anotado— y va al preview para que
      alguien decida, que es la regla: no corregir datos dudosos en silencio.
    */
    const fromRow = reportStatus ? null : activityStatus(rawType);
    if (!reportStatus && !fromRow) {
      issues.push(
        rawType
          ? `El tipo de actividad «${rawType}» no se reconoce.`
          : 'La fila no dice si es entrada, salida u ocupada.',
      );
    }

    /*
      El importe se guarda con su moneda. El informe mezcla pesos y dólares, y
      en cada moneda el punto significa otra cosa: un importe sin moneda queda
      en nulo en lugar de suponerse peso.
    */
    const totalAmount = parseMoney(cell(record, 'totalAmount'));
    const pendingAmount = parseMoney(cell(record, 'pendingAmount'));
    const rawTotal = cell(record, 'totalAmount');
    if (rawTotal && !totalAmount) {
      issues.push(`No se pudo interpretar el importe total «${rawTotal}».`);
    }
    const rawPending = cell(record, 'pendingAmount');
    if (rawPending && !pendingAmount) {
      issues.push(`No se pudo interpretar el importe pendiente «${rawPending}».`);
    }
    if (totalAmount && pendingAmount && totalAmount.currency !== pendingAmount.currency) {
      issues.push('El importe total y el pendiente vienen en monedas distintas.');
    }

    const rawPayment = cell(record, 'paymentType');
    const payment = rawPayment ? parsePaymentType(rawPayment) : null;

    return {
      reservationId: cell(record, 'reservationId') ?? '',
      roomNumber,
      guestNames: names,
      channel: cell(record, 'channel'),
      arrivalDate: arrival.date,
      departureDate: departure.date,
      pmsStatus: rawType,
      sourceReport: kind,
      /*
        `CHECK_IN` como último recurso es deliberado y sólo se alcanza con la
        fila ya marcada como problemática: es el estado que NO otorga llave ni
        da nada por hecho, así que un dato ilegible no puede provocar que el
        sistema entregue una llave o cierre una salida por su cuenta.
      */
      operationalStatus: reportStatus ?? fromRow ?? 'CHECK_IN',
      guestCount: parseGuestCount(cell(record, 'guestCount')),
      totalAmount,
      pendingAmount,
      payment,
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
