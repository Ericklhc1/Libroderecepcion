/**
 * La hora del hotel.
 *
 * Todo lo que se muestre o se escriba con una hora pasa por acá, y la razón es
 * un fallo real: el formateo no pasaba zona horaria, así que usaba la del
 * proceso. En un portátil eso funciona por casualidad —la zona del portátil es
 * la del hotel— y en el servidor de producción, que corre en UTC, cada fecha
 * del Libro aparecía tres horas adelantada.
 *
 * En un libro de recepción eso no es cosmético. Una novedad registrada a las
 * 23:30 de un turno de noche se leía como 02:30 del día siguiente, es decir en
 * otro turno y en otra fecha operativa. Y un formulario prellenado desde el
 * servidor después de las 21:00 chilenas proponía el día siguiente.
 *
 * La zona es fija porque el hotel es uno y está en Chile. `HOTEL_TIMEZONE`
 * sigue existiendo como variable de entorno para lo que corre sólo en el
 * servidor; este archivo es el valor que además pueden usar las pantallas, que
 * no leen variables de entorno.
 */

export const HOTEL_TIME_ZONE = 'America/Santiago';

export const HOTEL_LOCALE = 'es-CL';

/**
 * Descompone una fecha en la hora de pared del hotel.
 *
 * Es lo que permite escribir un `<input type="datetime-local">` correcto:
 * `getHours()` devolvería la hora del proceso, y lo que el campo necesita es
 * la hora que vería alguien de pie en el mesón.
 */
export function hotelParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    /*
      A medianoche, `hour12: false` puede devolver «24» en lugar de «00» según
      la plataforma. Un `<input type="datetime-local">` con 24 es inválido y el
      campo aparece vacío.
    */
    hour: pick('hour') === '24' ? '00' : pick('hour'),
    minute: pick('minute'),
  };
}

/**
 * La fecha operativa a la que pertenece un momento, en la zona del hotel.
 *
 * Se usa para agrupar por día. Con la zona del proceso, un registro de las
 * 22:00 chilenas caía en el día siguiente, porque en UTC ya es la 01:00.
 */
export function hotelDateKey(date: Date): string {
  const { year, month, day } = hotelParts(date);
  return `${year}-${month}-${day}`;
}

/** La hora del hotel, en horas decimales. Sirve para decidir el turno. */
export function hotelHour(date: Date): number {
  const { hour, minute } = hotelParts(date);
  return Number(hour) + Number(minute) / 60;
}
