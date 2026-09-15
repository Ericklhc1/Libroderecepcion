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

export type ReportKind = 'ENTRADAS' | 'IN_HOUSE' | 'SALIDAS';

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
  if (fields.has('lastName') && fields.has('firstName')) return 'SALIDAS';
  if (fields.has('pmsStatus') && fields.has('roomNumber')) return 'IN_HOUSE';
  if (fields.has('guestName') && fields.has('roomNumber')) return 'ENTRADAS';
  return null;
}

const DATE_IN_TEXT = /(\d{1,2}\/\d{1,2}\/\d{4})/g;

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
  if (!/^(check[\s-]?in|check[\s-]?out|in[\s-]?house|total)/i.test(first.text)) return null;
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
  const title = lines[0] ? lineText(lines[0]) : null;
  const reportDate = findReportDate(lines);

  let columns: DetectedColumn[] = [];
  let unmapped: Array<{ header: string; x: number }> = [];
  let bounds: Array<{ field: ColumnField; lo: number; hi: number }> = [];

  const records: RawRecord[] = [];
  const summary: ReportSummary[] = [];
  const ignoredLines: string[] = [];
  let current: RawRecord | null = null;

  for (const line of lines) {
    const candidate = readHeaderLine(line);
    // El encabezado se repite en cada página del informe: se vuelve a leer,
    // porque los límites de columna pueden variar entre páginas.
    if (candidate.columns.length >= 3) {
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

    // Línea de continuación: sólo trae nombres y pertenece al registro previo.
    const onlyNames =
      Object.keys(cells).length > 0 &&
      Object.keys(cells).every((field) => NAME_FIELDS.includes(field as ColumnField));
    if (current && onlyNames) {
      const name = NAME_FIELDS.map((field) => cells[field])
        .filter((value): value is string => Boolean(value?.trim()))
        .join(' ')
        .trim();
      if (name) current.extraGuests.push(name);
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
    columns,
    unmapped,
    records,
    summary,
    ignoredLines,
  };
}
