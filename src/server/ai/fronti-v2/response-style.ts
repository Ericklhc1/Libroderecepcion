export function userExplicitlyRequestedTable(message: string): boolean {
  return /\b(tabla|table|cuadro\s+comparativo|columnas?)\b/i.test(message);
}

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  const cells = splitCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * FRONTI vive en una burbuja estrecha. Las tablas Markdown se vuelven
 * ilegibles ahí, así que salvo petición expresa se degradan a fichas breves.
 */
export function normalizeFrontiReply(reply: string, userMessage: string): string {
  const clean = reply.trim();
  if (!clean || userExplicitlyRequestedTable(userMessage)) return clean;

  const lines = clean.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index] ?? '';
    const separator = lines[index + 1] ?? '';

    if (header.includes('|') && isSeparator(separator)) {
      const headers = splitCells(header);
      index += 1;
      const rows: string[][] = [];

      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? '';
        if (!next.includes('|') || !next.trim()) break;
        rows.push(splitCells(next));
        index += 1;
      }

      for (const row of rows) {
        const parts = headers
          .map((name, cellIndex) => {
            const value = row[cellIndex]?.trim();
            if (!value) return null;
            return name ? `**${name}:** ${value}` : value;
          })
          .filter((part): part is string => Boolean(part));
        if (parts.length) output.push(`- ${parts.join(' · ')}`);
      }
      continue;
    }

    output.push(header);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
