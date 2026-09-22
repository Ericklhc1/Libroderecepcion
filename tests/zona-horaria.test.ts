import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatTime,
  relativeTime,
  toDateInput,
  toDateTimeInput,
} from '@/lib/format';
import {
  HOTEL_TIME_ZONE,
  calendarDateKey,
  hotelCalendarDate,
  hotelDateKey,
  hotelDayEnd,
  hotelDayStart,
  hotelHour,
  hotelParts,
  parseHotelDateTimeLocal,
} from '@/domain/time';
import { plannedWindow, shiftTypeAt } from '@/domain/shift';
import { operationalDate } from '@/server/services/shifts';
import { ShiftType } from '@prisma/client';

/**
 * La hora del hotel.
 *
 * Fallo real y urgente: el formateo no pasaba zona horaria, así que usaba la
 * del proceso. En el portátil de quien programa eso acierta por casualidad
 * —la zona del portátil es la de Chile— y en el servidor de producción, que
 * corre en UTC, cada fecha del Libro aparecía tres horas adelantada.
 *
 * Se vio en pantalla: una multa registrada a las 16:25 se leía «01:55 p. m.».
 *
 * ESTAS PRUEBAS CORREN EN UTC. `vitest.config` no fija `TZ`, pero los
 * instantes se construyen con `Date.UTC`, que no depende de la zona del
 * proceso, y lo que se comprueba es que el resultado sea la hora de Chile
 * independientemente de dónde corra. Así la prueba falla igual en un portátil
 * chileno que en el servidor: es lo que la versión anterior no hacía.
 */

/** 16 de septiembre de 2026, 19:25 UTC = 16:25 en Santiago (UTC-3). */
const TARDE = new Date(Date.UTC(2026, 8, 16, 19, 25));

/** 17 de septiembre de 2026, 01:30 UTC = 22:30 del DÍA ANTERIOR en Santiago. */
const NOCHE = new Date(Date.UTC(2026, 8, 17, 1, 30));

describe('la hora que se muestra es la del hotel', () => {
  it('formatea la hora de Chile, no la del proceso', () => {
    // El caso de la captura: 19:25 UTC son las 16:25 en el mesón.
    expect(formatDateTime(TARDE)).toContain('16:25');
    expect(formatTime(TARDE)).toBe('16:25');
  });

  /*
    El caso grave. Una novedad de las 22:30 de un turno de noche caía, leída en
    UTC, en la 01:30 del día siguiente: otro turno y otra fecha operativa. El
    Libro atribuía el hecho al turno equivocado.
  */
  it('una novedad de las 22:30 no salta al día siguiente', () => {
    expect(formatTime(NOCHE)).toBe('22:30');
    expect(formatDate(NOCHE)).toBe('16-09-2026');
    expect(formatDateTime(NOCHE)).toContain('16-09-26');
  });

  it('la fecha sin hora también respeta la zona', () => {
    expect(formatDate(TARDE)).toBe('16-09-2026');
  });

  it('acepta una fecha en texto, como llega de una API', () => {
    expect(formatTime('2026-09-16T19:25:00.000Z')).toBe('16:25');
  });

  it('sin fecha, no inventa una', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatTime(null)).toBe('—');
  });
});

describe('los campos de formulario se prellenan con la hora del mesón', () => {
  /*
    El segundo fallo, más escondido que el visual: `toDateTimeInput` usaba
    `getHours()` y `getDate()`, que son del proceso. Prellenado desde el
    servidor, el campo proponía la hora UTC, y pasadas las 21:00 chilenas
    proponía además el día siguiente. El recepcionista guardaba un vencimiento
    con fecha de mañana sin notarlo.
  */
  it('propone la hora de Chile', () => {
    expect(toDateTimeInput(TARDE)).toBe('2026-09-16T16:25');
  });

  it('a las 22:30 propone HOY, no mañana', () => {
    expect(toDateTimeInput(NOCHE)).toBe('2026-09-16T22:30');
    expect(toDateInput(NOCHE)).toBe('2026-09-16');
  });

  it('la medianoche se escribe 00, no 24', () => {
    // 03:00 UTC son las 00:00 en Santiago. Un campo con «24» es inválido y el
    // navegador lo muestra vacío.
    const medianoche = new Date(Date.UTC(2026, 8, 17, 3, 0));
    expect(toDateTimeInput(medianoche)).toBe('2026-09-17T00:00');
  });

  it('sin fecha, el campo queda vacío', () => {
    expect(toDateTimeInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
  });
});

describe('la distancia entre dos instantes no tiene zona', () => {
  it('no se toca, y es correcto que no la use', () => {
    // Dos instantes están a la misma distancia en cualquier zona del mundo.
    const enUnaHora = new Date(Date.now() + 3_600_000);
    expect(relativeTime(enUnaHora)).toBe('en 1 h');
    const haceDosHoras = new Date(Date.now() - 7_200_000);
    expect(relativeTime(haceDosHoras)).toBe('hace 2 h');
  });
});

describe('utilidades de la zona del hotel', () => {
  it('la zona es la de Chile', () => {
    expect(HOTEL_TIME_ZONE).toBe('America/Santiago');
  });

  it('la fecha operativa agrupa por el día del hotel', () => {
    // Las 22:30 chilenas pertenecen al 16, aunque en UTC ya sea el 17.
    expect(hotelDateKey(NOCHE)).toBe('2026-09-16');
    expect(hotelDateKey(TARDE)).toBe('2026-09-16');
  });

  /*
    De esto depende qué turno corresponde: día [07:00,20:00) y noche
    [20:00,08:00). Con la hora del proceso, las 16:25 del mesón se leían como
    las 19:25 y una novedad de la tarde entraba al turno de noche.
  */
  it('la hora sirve para decidir el turno', () => {
    expect(hotelHour(TARDE)).toBeCloseTo(16.42, 1);
    expect(hotelHour(NOCHE)).toBeCloseTo(22.5, 1);
  });

  it('descompone la hora de pared del hotel', () => {
    expect(hotelParts(TARDE)).toEqual({
      year: '2026',
      month: '09',
      day: '16',
      hour: '16',
      minute: '25',
    });
  });

  it('interpreta la fecha efectiva de Caja como hora Chile y no como UTC del servidor', () => {
    expect(parseHotelDateTimeLocal('2026-09-16T16:25').toISOString()).toBe(
      '2026-09-16T19:25:00.000Z',
    );
  });
});


describe('el reloj operativo del sistema usa Santiago aunque el proceso use UTC', () => {
  it('elige el turno con la hora del hotel', () => {
    expect(shiftTypeAt(TARDE)).toBe(ShiftType.DIA);
    expect(shiftTypeAt(NOCHE)).toBe(ShiftType.NOCHE);
  });

  it('la fecha operativa después de las 21:00 chilenas sigue siendo hoy', () => {
    expect(operationalDate(NOCHE).toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(hotelCalendarDate(NOCHE).toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('las ventanas de turno representan 07:00/20:00 reales de Santiago', () => {
    const day = new Date('2026-09-16T00:00:00.000Z');
    const dia = plannedWindow(day, ShiftType.DIA);
    const noche = plannedWindow(day, ShiftType.NOCHE);

    expect(formatTime(dia.start)).toBe('07:00');
    expect(formatTime(dia.end)).toBe('20:00');
    expect(formatTime(noche.start)).toBe('20:00');
    expect(formatTime(noche.end)).toBe('08:00');
    expect(hotelDateKey(noche.end)).toBe('2026-09-17');
  });

  it('inicio y fin del día son instantes del calendario de Santiago', () => {
    expect(formatDateTime(hotelDayStart(NOCHE))).toContain('16-09-26');
    expect(formatTime(hotelDayStart(NOCHE))).toBe('00:00');
    expect(formatDateTime(hotelDayEnd(NOCHE))).toContain('16-09-26');
  });

  it('una fecha de PostgreSQL no retrocede un día al formatearla', () => {
    const dateOnly = new Date('2026-09-18T00:00:00.000Z');
    expect(calendarDateKey(dateOnly)).toBe('2026-09-18');
    expect(formatCalendarDate(dateOnly)).toBe('18-09-2026');
  });
});
