function delimiterOf(text: string): ',' | ';' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 12).join('\n');
  const counts = ([',', ';', '\t'] as const).map((delimiter) => ({
    delimiter,
    count: [...sample].filter((character) => character === delimiter).length,
  }));
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

/** Lector pequeño de CSV/TSV: admite comillas, separadores dentro de celdas y saltos de línea. */
export function parseDelimited(text: string, delimiter = delimiterOf(text), options: {
  preserveEmptyRows?: boolean;
  preserveWhitespace?: boolean;
  strict?: boolean;
  maxRows?: number;
  maxColumns?: number;
  maxCellCharacters?: number;
} = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const appendCell = () => {
    row.push(options.preserveWhitespace ? cell : cell.trim());
    if (row.length > (options.maxColumns ?? Infinity)) throw new Error('El archivo supera el límite de columnas.');
    cell = '';
    closedQuote = false;
  };
  const appendRow = () => {
    if (options.preserveEmptyRows || row.some(Boolean)) rows.push(row);
    if (rows.length > (options.maxRows ?? Infinity)) throw new Error('El archivo supera el límite de filas.');
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        if (cell.length > (options.maxCellCharacters ?? Infinity)) throw new Error('Una celda supera el límite de texto.');
        index += 1;
      } else {
        if (options.strict && !quoted && (cell.length || closedQuote)) throw new Error('Las comillas del archivo no son válidas.');
        closedQuote = quoted;
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      appendCell();
      continue;
    }
    if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      appendCell();
      appendRow();
      continue;
    }
    if (options.strict && closedQuote && !/\s/.test(character)) throw new Error('Hay texto después del cierre de comillas.');
    cell += character;
    if (cell.length > (options.maxCellCharacters ?? Infinity)) throw new Error('Una celda supera el límite de texto.');
  }

  if (options.strict && quoted) throw new Error('El archivo contiene comillas sin cerrar.');
  appendCell();
  if (row.some(Boolean) || (options.preserveEmptyRows && text.endsWith(delimiter))) appendRow();
  return rows;
}

