/**
 * Diccionario de columnas de los informes del PMS.
 *
 * Los informes no se leen por posición: se leen por encabezado. Este archivo
 * traduce el texto del encabezado —tal como lo imprime el PMS, con o sin
 * acentos, abreviado o completo— al campo canónico que usa el sistema. Cuando
 * el hotel cambie de plantilla o aparezca otro PMS, se agrega el sinónimo aquí
 * y el resto del módulo no cambia.
 */

/** Campos canónicos que el sistema sabe interpretar. */
export type ColumnField =
  | 'reservationId'
  | 'channel'
  | 'guestName'
  | 'firstName'
  | 'lastName'
  | 'roomNumber'
  | 'arrival'
  | 'departure'
  | 'pmsStatus'
  | 'guestCount'
  /*
    Los tres campos que aporta «Habitaciones con actividad». El importe total y
    el pendiente viajan con su moneda dentro del texto —«CL$ 64.511»— y se
    interpretan en `money.ts`: acá sólo se reconoce la columna.
  */
  | 'totalAmount'
  | 'pendingAmount'
  | 'paymentType';

export const COLUMN_LABELS: Record<ColumnField, string> = {
  reservationId: 'ID de reserva',
  channel: 'Canal',
  guestName: 'Cliente / huéspedes',
  firstName: 'Nombre',
  lastName: 'Apellidos',
  roomNumber: 'Habitación',
  arrival: 'Llegada',
  departure: 'Salida',
  pmsStatus: 'Estado o tipo',
  guestCount: 'Cantidad de huéspedes',
  totalAmount: 'Importe total',
  pendingAmount: 'Importe pendiente',
  paymentType: 'Tipo de pago',
};

/**
 * Sinónimos por campo. La comparación se hace sobre el encabezado normalizado
 * (minúsculas, sin acentos, sin puntuación final).
 */
const SYNONYMS: Record<ColumnField, string[]> = {
  reservationId: [
    'id',
    'id reserva',
    'id de reserva',
    'reserva',
    'nro reserva',
    'numero reserva',
    'numero de reserva',
    'codigo reserva',
    'localizador',
    'booking',
    'booking id',
    'folio',
  ],
  channel: ['canal', 'origen', 'fuente', 'agencia', 'portal', 'segmento', 'canal de venta'],
  guestName: [
    'cliente',
    'huesped',
    'huespedes',
    'nombre completo',
    'nombre y apellidos',
    'titular',
    'pasajero',
    'pasajeros',
  ],
  firstName: ['nombre', 'nombres', 'primer nombre'],
  lastName: ['apellidos', 'apellido', 'apellido paterno', 'apellidos del cliente'],
  roomNumber: [
    'hab',
    'habitacion',
    'habitaciones',
    'nro hab',
    'numero habitacion',
    'room',
    'unidad',
    'depto',
  ],
  arrival: [
    'lle',
    'llegada',
    'entrada',
    'check in',
    'checkin',
    'fecha llegada',
    'fecha de llegada',
    'fecha entrada',
    'desde',
  ],
  departure: [
    'salida',
    'sal',
    'check out',
    'checkout',
    'fecha salida',
    'fecha de salida',
    'hasta',
  ],
  pmsStatus: ['tipo', 'estado', 'estado habitacion', 'tipo habitacion', 'situacion'],
  guestCount: [
    'pax',
    'nro pax',
    'adultos',
    'cantidad huespedes',
    'total huespedes',
    // «Habitaciones con actividad» abrevia la columna a «Hué».
    'hue',
    'hues',
  ],
  /*
    Los encabezados de importe vienen abreviados —«Imp. tot», «Imp. pte»— y el
    diccionario normaliza el punto a espacio, así que llegan como «imp tot» e
    «imp pte». Se registran las dos formas, la abreviada y la completa.

    El orden dentro de cada lista no importa, pero el orden de los CAMPOS sí:
    `totalAmount` va antes que `pendingAmount` y los dos antes que
    `paymentType`, porque el primer campo que reclama un sinónimo lo conserva.
  */
  totalAmount: [
    'imp tot',
    'imp total',
    'importe total',
    'total',
    'precio total',
    'importe',
  ],
  pendingAmount: [
    'imp pte',
    'imp pend',
    'importe pendiente',
    'pendiente',
    'saldo',
    'saldo pendiente',
  ],
  /*
    «Tipo de pago» se imprime en DOS líneas en el informe de actividad: «Tipo
    de» encima y «pago» en la línea de encabezados. Por eso el sinónimo suelto
    «pago» tiene que existir: es lo único que aparece en la línea que se lee.

    Y tiene que resolverse a `paymentType` y no a `pmsStatus`, que reclama
    «tipo»: son columnas distintas y en este informe conviven.
  */
  paymentType: ['pago', 'tipo de pago', 'forma de pago', 'forma pago', 'tipo pago'],
};

/** Quita acentos, puntuación y mayúsculas para comparar encabezados. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Marca de ordinal en "Nº reserva". El acotador de palabra evita el error
    // de comerse la "no" de "Nombre", que dejaba la columna sin reconocer.
    .replace(/\bn[º°]\s*/g, '')
    .replace(/[.:;,#]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXACT = new Map<string, ColumnField>();
for (const [field, list] of Object.entries(SYNONYMS) as Array<[ColumnField, string[]]>) {
  for (const synonym of list) {
    // El primer campo que reclama un sinónimo lo conserva: el orden de
    // SYNONYMS define la prioridad ante colisiones.
    if (!EXACT.has(synonym)) EXACT.set(synonym, field);
  }
}

/**
 * Traduce un encabezado a su campo canónico.
 *
 * Primero busca coincidencia exacta —así "nombre completo" es el cliente y no
 * el nombre de pila— y sólo después admite que el encabezado contenga el
 * sinónimo, para tolerar variantes como "Hab. asignada".
 */
export function matchColumn(raw: string): ColumnField | null {
  const header = normalizeHeader(raw);
  if (!header) return null;

  const exact = EXACT.get(header);
  if (exact) return exact;

  const words = header.split(' ');
  let best: { field: ColumnField; length: number } | null = null;
  for (const [synonym, field] of EXACT) {
    const synonymWords = synonym.split(' ');
    const contained = synonymWords.every((word) => words.includes(word));
    if (!contained) continue;
    // Gana el sinónimo más específico: "fecha de llegada" sobre "llegada".
    if (!best || synonym.length > best.length) best = { field, length: synonym.length };
  }
  return best?.field ?? null;
}
