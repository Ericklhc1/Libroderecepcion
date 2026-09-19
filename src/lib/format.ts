import { HOTEL_LOCALE, HOTEL_TIME_ZONE, hotelParts } from '@/domain/time';

/**
 * Formateo de fechas, horas y montos.
 *
 * TODA función que muestre una hora pasa `timeZone` explícitamente. Sin eso
 * `toLocaleString` usa la zona del proceso: en un portátil chileno acierta por
 * casualidad y en el servidor de producción, que corre en UTC, adelanta tres
 * horas cada fecha del Libro. Una novedad de las 23:30 se leía como 02:30 del
 * día siguiente: otro turno y otra fecha operativa.
 */

const DATE_LOCALE = HOTEL_LOCALE;

/**
 * Opciones comunes: la zona del hotel, siempre, y reloj de 24 horas.
 *
 * `es-CL` formatea en 12 horas por omisión —«01:55 p. m.»— y en un mesón eso
 * es un defecto: las ventanas de turno se enuncian «07:00 a 19:59» y «20:00 a
 * 07:59», así que una hora con a. m. / p. m. obliga a traducir mentalmente
 * para saber a qué turno pertenece un registro. Y de noche, con prisa, se lee
 * mal.
 */
const ZONE = { timeZone: HOTEL_TIME_ZONE, hour12: false } as const;

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleString(DATE_LOCALE, {
    ...ZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleDateString(DATE_LOCALE, {
    ...ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Formatea una fecha calendario de PostgreSQL (`@db.Date`).
 *
 * Prisma representa esas fechas como 00:00 UTC. Aplicar America/Santiago a
 * ese valor las movería al día anterior. Por eso una fecha sin hora se
 * formatea explícitamente en UTC: conserva el calendario que vino del PMS.
 */
export function formatCalendarDate(
  date: Date | string | null | undefined,
): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleDateString(DATE_LOCALE, {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleTimeString(DATE_LOCALE, {
    ...ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Distancia relativa en lenguaje operativo: "hace 2 h", "en 30 min", "vencida". */
export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  /*
    Esta función no necesita zona horaria y es correcto que no la use: compara
    dos instantes, y la distancia entre dos instantes es la misma en cualquier
    zona del mundo.
  */
  const diffMs = value.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  let quantity: string;
  if (minutes < 1) quantity = 'menos de 1 min';
  else if (minutes < 60) quantity = `${minutes} min`;
  else if (hours < 24) quantity = `${hours} h`;
  else quantity = `${days} d`;

  return diffMs >= 0 ? `en ${quantity}` : `hace ${quantity}`;
}

/**
 * Valor para `<input type="datetime-local">`.
 *
 * Usaba `getFullYear()`, `getMonth()` y `getHours()`, que son la hora del
 * PROCESO. Prellenado desde el servidor, el campo proponía la hora UTC, y
 * después de las 21:00 chilenas proponía además el día siguiente: el
 * recepcionista guardaba un vencimiento con fecha de mañana sin notarlo.
 */
export function toDateTimeInput(date: Date | null | undefined): string {
  if (!date) return '';
  const { year, month, day, hour, minute } = hotelParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function toDateInput(date: Date | null | undefined): string {
  if (!date) return '';
  const { year, month, day } = hotelParts(date);
  return `${year}-${month}-${day}`;
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString(DATE_LOCALE, {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  });
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
