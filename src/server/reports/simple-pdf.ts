import 'server-only';

/**
 * Generador PDF textual pequeño y sin dependencias binarias. Los informes de
 * Supervisión son tablas/resúmenes: un PDF Type1 paginado es suficiente y,
 * sobre todo, produce exactamente los mismos bytes para descarga y correo.
 */
function latin(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '?');
}

function escapePdf(value: string): string {
  return latin(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLine(value: string, width = 94): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function createTextPdf(params: {
  title: string;
  subtitle?: string | null;
  lines: string[];
  generatedAt?: Date;
}): Buffer {
  const generatedAt = params.generatedAt ?? new Date();
  const body = params.lines.flatMap((line) => wrapLine(line));
  const pageSize = 47;
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(body.length, 1); index += pageSize) {
    pages.push(body.slice(index, index + pageSize));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  const fontId = 3;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(4 + index * 2);
    contentObjectIds.push(5 + index * 2);
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, pageIndex) => {
    const pageId = pageObjectIds[pageIndex]!;
    const contentId = contentObjectIds[pageIndex]!;
    const header = [
      params.title,
      params.subtitle ?? '',
      `Generado: ${generatedAt.toLocaleString('es-CL', { timeZone: 'America/Santiago' })} · Página ${pageIndex + 1}/${pages.length}`,
    ].filter(Boolean);
    const commands: string[] = [];
    let y = 752;
    header.forEach((line, index) => {
      commands.push(`BT /F1 ${index === 0 ? 15 : 9} Tf 42 ${y} Td (${escapePdf(line)}) Tj ET`);
      y -= index === 0 ? 22 : 16;
    });
    y -= 5;
    for (const line of pageLines) {
      commands.push(`BT /F1 9 Tf 42 ${y} Td (${escapePdf(line)}) Tj ET`);
      y -= 14;
    }
    const stream = commands.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let output = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = Buffer.byteLength(output, 'latin1');
    output += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length}\n`;
  output += '0000000000 65535 f \n';
  for (let id = 1; id < objects.length; id += 1) {
    output += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, 'latin1');
}
