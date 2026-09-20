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

/**
 * Nombre semántico interno de cada campo. No representa necesariamente el texto
 * que FNS imprime en el PDF: por ejemplo, el campo interno «Habitación» aparece
 * literalmente como «Hab» en «Habitaciones con actividad».
 */
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
 * Encabezados LITERALES del informe FNS «Habitaciones con actividad».
 *
 * Esta lista se tomó de la plantilla real del hotel. Se mantiene separada de
 * `COLUMN_LABELS` a propósito: una cosa es lo que dice el PDF y otra el nombre
 * canónico que usa el dominio. Así la pantalla de revisión puede afirmar con
 * precisión qué leyó, sin convertir «Hab» en «Habitación» ni «Lle.» en
 * «Llegada».
 *
 * «Tipo de pago» está visualmente partido en dos líneas en el PDF ("Tipo de"
 * sobre "pago"), pero ése es el encabezado completo que ve la persona.
 */
export const ACTIVITY_SOURCE_HEADERS: Partial<Record<ColumnField, string>> = {
  reservationId: 'ID',
  pmsStatus: 'Tipo',
  channel: 'Canal',
  firstName: 'Nombre',
  lastName: 'Apellidos',
  arrival: 'Lle.',
  departure: 'Salida',
  roomNumber: 'Hab',
  guestCount: 'Hué',
  totalAmount: 'Imp. tot',
  pendingAmount: 'Imp. pte',
  paymentType: 'Tipo de pago',
};

/**
 * Devuelve el encabezado que debe mostrarse al revisar un informe.
 *
 * Para Actividad usamos la leyenda literal de FNS, porque su cabecera contiene
 * varias abreviaturas y un encabezado partido en dos líneas. Para los demás
 * informes conservamos exactamente el texto que extrajo el PDF.
 */
export function displayedSourceHeader(
  reportKind: string | null,
  field: ColumnField,
  detectedHeader: string,
): string {
  if (reportKind === 'ACTIVIDAD') {
    return ACTIVITY_SOURCE_HEADERS[field] ?? detectedHeader;
  }
  return detectedHeader;
}

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
    'booking number',
    'booking no',
    'folio',
    'confirmacion',
    'numero confirmacion',
    'confirmation',
    'confirmation number',
    'locator',
    'record locator',
    'codigo',
  ],
  channel: ['canal', 'origen', 'fuente', 'agencia', 'portal', 'segmento', 'canal de venta', 'source', 'market'],
  guestName: [
    'cliente',
    'huesped',
    'huespedes',
    'nombre completo',
    'nombre y apellidos',
    'titular',
    'pasajero',
    'pasajeros',
    'guest',
    'guests',
    'guest name',
    'customer',
    'customer name',
  ],
  firstName: ['nombre', 'nombres', 'primer nombre', 'first name', 'given name'],
  lastName: ['apellidos', 'apellido', 'apellido paterno', 'apellidos del cliente', 'last name', 'surname', 'family name'],
  roomNumber: [
    // FNS Actividad imprime literalmente «Hab».
    'hab',
    'habitacion',
    'habitaciones',
    'nro hab',
    'numero habitacion',
    'room',
    'room number',
    'room no',
    'unidad',
    'depto',
  ],
  arrival: [
    // FNS Actividad imprime literalmente «Lle.»; la puntuación se normaliza.
    'lle',
    'llegada',
    'entrada',
    'check in',
    'checkin',
    'fecha llegada',
    'fecha de llegada',
    'fecha entrada',
    'desde',
    'arrival',
    'arrival date',
    'start date',
  ],
  departure: [
    'salida',
    'sal',
    'check out',
    'checkout',
    'fecha salida',
    'fecha de salida',
    'hasta',
    'departure',
    'departure date',
    'end date',
  ],
  pmsStatus: [
    'tipo',
    'estado',
    'estado habitacion',
    'estado reserva',
    'tipo habitacion',
    'tipo movimiento',
    'movimiento',
    'situacion',
    'status',
    'reservation status',
    'stay status',
    'activity',
  ],
  guestCount: [
    'pax',
    'nro pax',
    'adultos',
    'cantidad huespedes',
    'total huespedes',
    // FNS Actividad abrevia literalmente la columna a «Hué».
    'hue',
    'hues',
    'numero huespedes',
    'guest count',
    'occupancy',
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
