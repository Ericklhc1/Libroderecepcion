/**
 * Lectura estructural de un informe del PMS.
 *
 * Recibe los fragmentos de texto con su posición en la página —lo único que un
 * PDF entrega de verdad— y reconstruye la tabla: agrupa fragmentos en líneas,
 * localiza la línea de encabezados, deduce los límites de cada columna a partir
 * de ellos y reparte las celdas. No hay posiciones fijas en ninguna parte.
 *
 * Es dominio puro: no sabe qué es un PDF ni toca la base de datos, de modo que
 * puede probarse con fragmentos escritos a mano.
 */
import { matchColumn, type ColumnField } from './columns';

/**
 * `ACTIVIDAD` es «Habitaciones con actividad», y es el informe PRINCIPAL: trae
 * en un solo documento las ocupadas, las salidas y las entradas del día, de
 * modo que ya no hace falta subir tres archivos para armar la foto operativa.
 *
 * Se diferencia de los otros tres en algo estructural: el estado no lo define
 * el informe, lo define CADA FILA en su columna «Tipo».
 */
export type ReportKind = 'ENTRADAS' | 'IN_HOUSE' | 'SALIDAS' | 'ACTIVIDAD';

/** Un trozo de texto tal como lo entrega el PDF, con su posición. */
export type TextFragment = { page: number; x: number; y: number; text: string };

export type DetectedColumn = { field: ColumnField; header: string; x: number };

export type RawRecord = {
  cells: Partial<Record<ColumnField, string>>;
  /** Huéspedes adicionales escritos en líneas de continuación. */
  extraGuests: string[];
  page: number;
  y: number;
};

export type ReportSummary = { label: string; numbers: number[] };

export type StructuredReport = {
  kind: ReportKind | null;
  kindSource: 'título' | 'columnas' | null;
  title: string | null;
  reportDate: string | null;
  /** Timestamp exacto impreso por FNS, sin interpretar zona horaria. */
  reportGeneratedAt: string | null;
  columns: DetectedColumn[];
  /** Encabezados que el diccionario no reconoció; se muestran en la revisión. */
  unmapped: Array<{ header: string; x: number }>;
  records: RawRecord[];
  summary: ReportSummary[];
  ignoredLines: string[];
};

type Fragment = { x: number; text: string };
type Line = { page: number; y: number; fragments: Fragment[] };

/**
 * Tolerancia vertical al agrupar fragmentos en una línea.
 *
 * El PMS imprime la columna de habitación 1,5 puntos más abajo que el resto de
 * la fila, mientras que las líneas de continuación de huéspedes están a 9
 * puntos o más. Cinco puntos separan ambos casos con margen.
 */
const LINE_TOLERANCE = 5;

/** Un identificador de reserva del PMS: sólo dígitos, al menos tres. */
const RESERVATION_ID = /^\d{3,}$/;

const NAME_FIELDS: ColumnField[] = ['guestName', 'firstName', 'lastName'];

/**
 * Campos que una línea de continuación puede COMPLETAR.
 *
 * Los tres informes antiguos sólo parten los nombres, y por eso la primera
 * versión sólo aceptaba continuaciones de nombre. «Habitaciones con actividad»
 * parte además otras dos cosas, y las dos importan:
 *
 *   407 · …  Andrea | Bustamante    ← fila
 *            Denisse | Nuñez        ← continuación: nombre
 *
 *   405 · …  US$ 204.12 | Prepago   ← fila
 *            Mota | Comision        ← continuación: nombre Y forma de pago
 *
 *   517 · …  CL$ 117.622 | CL$      ← fila: el importe pendiente se corta
 *            117.622                ← continuación: el resto del importe
 *
 * Sin esto, la línea `Mota | Comision` no era «sólo nombres», así que se
 * descartaba entera —perdiendo el apellido y el tipo de pago— y además cortaba
 * el hilo del registro. Y el importe pendiente de la 517 quedaba en «CL$», sin
 * cifra: un saldo de ciento diecisiete mil pesos leído como ilegible.
 */
const CONTINUABLE_FIELDS: ColumnField[] = [
  ...NAME_FIELDS,
  'totalAmount',
  'pendingAmount',
  'paymentType',
];

/**
 * Marca de moneda suelta, para reconocer el pie de totales.
 *
 * El pie del informe de actividad imprime los totales bajo las mismas columnas
 * que los importes de las filas:
 *
 *   US$ 2435.34 | US$
 *   284.14
 *   CL$ | CL$
 *   11.301.339 | 531.896
 *
 * Caen exactamente donde caería una continuación de importe, así que sin una
 * guarda se sumarían al último registro leído y la habitación 630 acabaría con
 * un saldo de dos mil cuatrocientos dólares que no existe.
 *
 * Lo que los distingue: el pie trae DOS marcas de moneda en la misma línea
 * —una por columna— y una continuación real trae sólo la cifra.
 */
const CURRENCY_MARK = /(?:CL\$|US\$|USD|CLP)/gi;

/**
 * Caracteres de control, invisibles y de fuentes de iconos que el PMS
 * intercala en la plantilla.
 *
 * No se ven al abrir el PDF, pero llegan como fragmentos de texto —el informe
 * de entradas trae un glifo del área de uso privado junto al encabezado— y si
 * no se descartan, uno de ellos se pega al encabezado siguiente y la columna
 * queda mal identificada.
 */
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff\ue000-\uf8ff]/g;

/** Deja sólo el texto visible del fragmento; vacío si no había nada legible. */
export function printableText(raw: string): string {
  return raw.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

export function groupIntoLines(fragments: TextFragment[]): Line[] {
  const pages = new Map<number, TextFragment[]>();
  for (const fragment of fragments) {
    const text = printableText(fragment.text);
    if (!text) continue;
    const clean = { ...fragment, text };
    const list = pages.get(fragment.page);
    if (list) list.push(clean);
    else pages.set(fragment.page, [clean]);
  }

  const lines: Line[] = [];
  for (const [page, items] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    // De arriba hacia abajo: en PDF la coordenada y crece hacia arriba.
    const ordered = [...items].sort((a, b) => b.y - a.y);
    let current: Line | null = null;
    let anchor = 0;
    for (const item of ordered) {
      if (!current || Math.abs(item.y - anchor) > LINE_TOLERANCE) {
        current = { page, y: item.y, fragments: [] };
        anchor = item.y;
        lines.push(current);
      }
      current.fragments.push({ x: item.x, text: item.text });
    }
  }

  for (const line of lines) line.fragments.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Intenta leer una línea como encabezados de tabla.
 *
 * Si un fragmento no se reconoce, prueba a unirlo con el siguiente: hay
 * plantillas que parten "Fecha llegada" en dos trozos.
 */
function readHeaderLine(line: Line): {
  columns: DetectedColumn[];
  unmapped: Array<{ header: string; x: number }>;
} {
  const columns: DetectedColumn[] = [];
  const unmapped: Array<{ header: string; x: number }> = [];

  for (let index = 0; index < line.fragments.length; index += 1) {
    const fragment = line.fragments[index];
    if (!fragment) continue;

    const direct = matchColumn(fragment.text);
    if (direct) {
      columns.push({ field: direct, header: fragment.text, x: fragment.x });
      continue;
    }

    const next = line.fragments[index + 1];
    if (next && next.x - fragment.x < 60) {
      const joined = `${fragment.text} ${next.text}`;
      const pair = matchColumn(joined);
      if (pair) {
        columns.push({ field: pair, header: joined, x: fragment.x });
        index += 1;
        continue;
      }
    }

    unmapped.push({ header: fragment.text, x: fragment.x });
  }

  return { columns, unmapped };
}

/** Límites de columna: el punto medio entre dos encabezados consecutivos. */
function columnBounds(columns: DetectedColumn[]): Array<{ field: ColumnField; lo: number; hi: number }> {
  const ordered = [...columns].sort((a, b) => a.x - b.x);
  return ordered.map((column, index) => {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    return {
      field: column.field,
      lo: previous ? (previous.x + column.x) / 2 : -Infinity,
      hi: next ? (column.x + next.x) / 2 : Infinity,
    };
  });
}

function splitIntoCells(
  line: Line,
  bounds: Array<{ field: ColumnField; lo: number; hi: number }>,
): Partial<Record<ColumnField, string>> {
  const cells: Partial<Record<ColumnField, string>> = {};
  for (const fragment of line.fragments) {
    const column = bounds.find((bound) => fragment.x >= bound.lo && fragment.x < bound.hi);
    if (!column) continue;
    const previous = cells[column.field];
    cells[column.field] = previous ? `${previous} ${fragment.text}` : fragment.text;
  }
  return cells;
}

function lineText(line: Line): string {
  return line.fragments.map((fragment) => fragment.text).join(' ');
}

function detectKindFromTitle(title: string | null): ReportKind | null {
  if (!title) return null;
  const text = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  /*
    La actividad se comprueba PRIMERO. Su título es «Habitaciones con
    actividad» y no contiene ninguna de las palabras de los otros tres, pero el
    orden importa igual: si mañana el PMS lo titulara «Actividad de entradas y
    salidas», la primera coincidencia mandaría y el informe principal se leería
    como uno de los secundarios.
  */
  if (/actividad/.test(text)) return 'ACTIVIDAD';
  if (/in[\s-]?house|en casa/.test(text)) return 'IN_HOUSE';
  if (/salida|check[\s-]?out|departure/.test(text)) return 'SALIDAS';
  if (/entrada|llegada|check[\s-]?in|arrival/.test(text)) return 'ENTRADAS';
  return null;
}

/**
 * Deducción de respaldo: si el título no lo dice, la combinación de columnas
 * identifica el informe. Las salidas son el único informe que separa nombre y
 * apellidos; el in house es el único que trae estado o tipo de habitación.
 */
function detectKindFromColumns(columns: DetectedColumn[]): ReportKind | null {
  const fields = new Set(columns.map((column) => column.field));
  /*
    La actividad es el único informe con importes y forma de pago, y va antes
    que las salidas porque también separa nombre y apellidos: sin esta línea se
    identificaría como el informe de salidas y se perdería el estado por fila.
  */
  if (fields.has('paymentType') || fields.has('pendingAmount')) return 'ACTIVIDAD';
  if (fields.has('lastName') && fields.has('firstName')) return 'SALIDAS';
  if (fields.has('pmsStatus') && fields.has('roomNumber')) return 'IN_HOUSE';
  if (fields.has('guestName') && fields.has('roomNumber')) return 'ENTRADAS';
  return null;
}

const DATE_IN_TEXT = /(\d{1,2}\/\d{1,2}\/\d{4})/g;
const GENERATED_AT_IN_TEXT = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}:\d{2})/;

function findReportGeneratedAt(lines: Line[]): string | null {
  const generated = lines.find((line) => /informe generado/i.test(lineText(line)));
  if (!generated) return null;
  const match = lineText(generated).match(GENERATED_AT_IN_TEXT);
  return match ? `${match[1]} ${match[2]}` : null;
}

function findReportDate(lines: Line[]): string | null {
  const generated = lines.find((line) => /informe generado/i.test(lineText(line)));
  const fromGenerated = generated ? lineText(generated).match(DATE_IN_TEXT) : null;
  if (fromGenerated?.length) return fromGenerated[fromGenerated.length - 1] ?? null;

  const first = lines[0];
  const fromTitle = first ? lineText(first).match(DATE_IN_TEXT) : null;
  if (fromTitle?.length) return fromTitle[fromTitle.length - 1] ?? null;
  return null;
}

/** Líneas de totales al pie: "Check-in 13 1 12", "In-house 51". */
function readSummary(line: Line): ReportSummary | null {
  const first = line.fragments[0];
  if (!first) return null;
  /*
    «Ocupada» entra por el informe de actividad, cuyo pie declara las tres
    cifras que el preview contrasta con lo leído:

      Check-in  10 …
      Check-out 24 …
      Ocupada   19 …
  */
  if (!/^(check[\s-]?in|check[\s-]?out|in[\s-]?house|ocupada|total)/i.test(first.text)) {
    return null;
  }
  const numbers = line.fragments
    .slice(1)
    .filter((fragment) => /^\d+$/.test(fragment.text.trim()))
    .map((fragment) => Number(fragment.text.trim()));
  if (!numbers.length) return null;
  return { label: first.text, numbers };
}

/**
 * Reconstruye el informe completo a partir de los fragmentos posicionados.
 */
export function readStructuredReport(fragments: TextFragment[]): StructuredReport {
  const lines = groupIntoLines(fragments);

  /*
    El título es la primera línea que NO sea la de encabezados.

    Tomar `lines[0]` a ciegas fallaba cuando el informe llega sin título: la
    línea de encabezados pasaba por título, y como contiene la palabra
    «Salida» —es el nombre de una columna— el informe de actividad se
    identificaba como el de salidas. Con eso el estado por fila se perdía y
    las cincuenta y tres filas quedaban marcadas como salidas.
  */
  const titleLine = lines.find((line) => {
    const candidate = readHeaderLine(line);
    const looksLikeHeader =
      candidate.columns.length >= 3 &&
      candidate.columns.some((column) => column.field === 'reservationId');
    return !looksLikeHeader;
  });
  const title = titleLine ? lineText(titleLine) : null;
  const reportDate = findReportDate(lines);
  const reportGeneratedAt = findReportGeneratedAt(lines);

  let columns: DetectedColumn[] = [];
  let unmapped: Array<{ header: string; x: number }> = [];
  let bounds: Array<{ field: ColumnField; lo: number; hi: number }> = [];

  const records: RawRecord[] = [];
  const summary: ReportSummary[] = [];
  const ignoredLines: string[] = [];
  let current: RawRecord | null = null;

  for (const line of lines) {
    const candidate = readHeaderLine(line);
    /*
      El encabezado se repite en cada página del informe: se vuelve a leer,
      porque los límites de columna pueden variar entre páginas.

      Se exige además la columna de ID, y no es un adorno: el pie del informe
      de actividad imprime la línea «Habitaciones | Pasajeros | Huéspedes», que
      mapea tres columnas del diccionario y sin esta condición se tomaría por
      un encabezado nuevo, reemplazando los límites reales al final del
      documento. Todo encabezado de verdad trae identificador de reserva.
    */
    const hasId = candidate.columns.some((column) => column.field === 'reservationId');
    if (candidate.columns.length >= 3 && hasId) {
      columns = candidate.columns;
      unmapped = candidate.unmapped;
      bounds = columnBounds(candidate.columns);
      current = null;
      continue;
    }

    if (!bounds.length) {
      ignoredLines.push(lineText(line));
      continue;
    }

    const cells = splitIntoCells(line, bounds);
    const id = cells.reservationId?.trim();

    if (id && RESERVATION_ID.test(id)) {
      current = { cells, extraGuests: [], page: line.page, y: line.y };
      records.push(current);
      continue;
    }

    // El pie del informe se reconoce antes que cualquier otra cosa: los
    // totales caen bajo la última columna y, sin esta guarda, "In-house 51"
    // terminaría anotado como un huésped más de la última habitación leída.
    const totals = readSummary(line);
    if (totals) {
      summary.push(totals);
      current = null;
      continue;
    }

    /*
      Pie de totales del informe de actividad. Se reconoce ANTES que la
      continuación porque cae bajo las mismas columnas de importe:

        US$ 2435.34 | US$      ← dos marcas de moneda: es el pie
        284.14                 ← cifra suelta: parece una continuación

      Dos marcas de moneda en una línea sin identificador de reserva sólo
      ocurren en el pie. Sin esta guarda, esas cifras se sumaban al último
      registro leído y la habitación 630 acabaría con un saldo de dos mil
      cuatrocientos dólares inexistente.
    */
    const currencyMarks = lineText(line).match(CURRENCY_MARK)?.length ?? 0;
    if (currencyMarks >= 2) {
      current = null;
      continue;
    }

    /*
      Línea de continuación: completa el registro previo.

      Antes sólo se aceptaban continuaciones de NOMBRE, porque es lo único que
      parten los tres informes antiguos. La actividad parte además la forma de
      pago —«Prepago» arriba, «Comision» abajo— y el importe —«CL$» arriba,
      «117.622» abajo—, así que una línea como `Mota | Comision` no era «sólo
      nombres»: se descartaba entera, perdiendo el apellido Y el tipo de pago,
      y además cortaba el hilo del registro.

      Los nombres siguen yendo a `extraGuests`, que es donde los espera el
      normalizador; los demás campos se concatenan a su celda.
    */
    const fields = Object.keys(cells) as ColumnField[];
    const continuable =
      fields.length > 0 && fields.every((field) => CONTINUABLE_FIELDS.includes(field));
    if (current && continuable) {
      const name = NAME_FIELDS.map((field) => cells[field])
        .filter((value): value is string => Boolean(value?.trim()))
        .join(' ')
        .trim();
      if (name) current.extraGuests.push(name);

      for (const field of fields) {
        if (NAME_FIELDS.includes(field)) continue;
        const addition = cells[field]?.trim();
        if (!addition) continue;
        const previous = current.cells[field];
        current.cells[field] = previous ? `${previous} ${addition}` : addition;
      }
      continue;
    }

    ignoredLines.push(lineText(line));
    current = null;
  }

  const fromTitle = detectKindFromTitle(title);
  const kind = fromTitle ?? detectKindFromColumns(columns);

  return {
    kind,
    kindSource: kind ? (fromTitle ? 'título' : 'columnas') : null,
    title,
    reportDate,
    reportGeneratedAt,
    columns,
    unmapped,
    records,
    summary,
    ignoredLines,
  };
}
