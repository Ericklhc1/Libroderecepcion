import {
  addHotelCalendarDays,
  hotelDateKey,
  hotelParts,
  hotelWallDateTime,
  parseHotelDateInput,
} from './time';

const DATE_HELP = 'No pude interpretar el vencimiento. Indica el día y la hora, por ejemplo «hoy a las 21:00».';

function wallTime(key: string, hour: number, minute: number): Date {
  const date = hotelWallDateTime(key, hour, minute);
  const parts = hotelParts(date);
  // Rechaza fechas imposibles y horas inexistentes durante el cambio de hora.
  if (hotelDateKey(date) !== key || Number(parts.hour) !== hour || Number(parts.minute) !== minute) {
    throw new Error(DATE_HELP);
  }
  return date;
}

/** Acepta lenguaje del usuario; nunca depende de la zona UTC del servidor. */
export function parseFrontiDueAt(value: unknown, now = new Date()): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 160) throw new Error(DATE_HELP);
  const original = value.trim();
  if (!original) return null;
  const text = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^(?:vence|vencimiento)\s*:?\s*/, '').replace(/[.!]$/, '').trim();
  if (/^(?:sin (?:fecha|vencimiento)|no aplica)$/.test(text)) return null;

  try {
    const iso = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:\d{2})?$/.exec(original);
    if (iso) {
      // Comprueba el calendario incluso cuando Date normalizaría 31/02.
      const [year, month, day] = iso[1]!.split('-').map(Number);
      const calendar = new Date(Date.UTC(year!, month! - 1, day!));
      if (calendar.toISOString().slice(0, 10) !== iso[1] || Number(iso[2]) > 23 || Number(iso[3]) > 59) throw new Error(DATE_HELP);
      const canonical = original.replace(/[Tt ]/, 'T').replace(/z$/, 'Z');
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(canonical)) {
        wallTime(iso[1]!, Number(iso[2]), Number(iso[3]));
      }
      return parseHotelDateInput(canonical);
    }

    const calendar = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(?:a las?\s+)?(\d{1,2}):(\d{2})$/.exec(text);
    if (calendar) {
      return wallTime(`${calendar[3]}-${calendar[2]!.padStart(2, '0')}-${calendar[1]!.padStart(2, '0')}`, Number(calendar[4]), Number(calendar[5]));
    }

    const relative = /^en\s+(\d{1,3})\s+(minutos?|horas?|dias?)(?:\s+a las?\s+(\d{1,2})(?::(\d{2}))?)?$/.exec(text);
    if (relative) {
      const count = Number(relative[1]);
      if (count < 1 || count > 365) throw new Error(DATE_HELP);
      if (relative[2]!.startsWith('dia')) {
        const date = addHotelCalendarDays(now, count);
        return relative[3]
          ? wallTime(hotelDateKey(date), Number(relative[3]), Number(relative[4] ?? 0))
          : date;
      }
      if (relative[3]) throw new Error(DATE_HELP);
      return new Date(now.getTime() + count * (relative[2]!.startsWith('hora') ? 3_600_000 : 60_000));
    }

    const clock = /^(?:(hoy|manana|pasado manana)\s+)?(?:a las?\s+)?(\d{1,2})(?::(\d{2}))?(?:\s*(?:h|hrs|horas))?$/.exec(text);
    if (clock) {
      const days = clock[1] === 'pasado manana' ? 2 : clock[1] === 'manana' ? 1 : 0;
      const date = days ? addHotelCalendarDays(now, days) : now;
      return wallTime(hotelDateKey(date), Number(clock[2]), Number(clock[3] ?? 0));
    }
  } catch {
    throw new Error(DATE_HELP);
  }
  throw new Error(DATE_HELP);
}
