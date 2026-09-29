import 'server-only';
import type { TextFragment } from '@/domain/pms/layout';

type LinkBox = { x1: number; y1: number; x2: number; y2: number };

function linkBoxesOf(annotations: unknown[]): LinkBox[] {
  return annotations.flatMap((annotation) => {
    if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return [];
    const value = annotation as Record<string, unknown>;
    if (value.subtype !== 'Link' || !Array.isArray(value.rect) || value.rect.length < 4) return [];
    const coords = value.rect.slice(0, 4).map(Number);
    if (coords.some((coordinate) => !Number.isFinite(coordinate))) return [];
    const [ax, ay, bx, by] = coords as [number, number, number, number];
    return [{
      x1: Math.min(ax, bx),
      y1: Math.min(ay, by),
      x2: Math.max(ax, bx),
      y2: Math.max(ay, by),
    }];
  });
}

function overlapsLink(
  boxes: LinkBox[],
  input: { x: number; y: number; width: number; height: number },
): boolean {
  // El y de TextContent es la línea base. Se usa un margen pequeño porque
  // distintos generadores redondean de forma distinta anotación y glifos.
  const left = input.x;
  const right = input.x + Math.max(input.width, 1);
  const bottom = input.y - Math.max(input.height * 0.25, 2);
  const top = input.y + Math.max(input.height, 6);
  const tolerance = 2;
  return boxes.some(
    (box) =>
      right >= box.x1 - tolerance &&
      left <= box.x2 + tolerance &&
      top >= box.y1 - tolerance &&
      bottom <= box.y2 + tolerance,
  );
}

/**
 * Extracción de texto posicionado de un PDF.
 *
 * Es la única pieza del módulo que depende de la librería de PDF. Devuelve
 * fragmentos con su coordenada, que es lo que necesita el lector estructural
 * para reconstruir columnas; el resto del módulo no sabe que existe un PDF.
 */
export async function readPdfFragments(data: Uint8Array): Promise<TextFragment[]> {
  // La build "legacy" es la que funciona en Node sin depender del DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  /*
    En Node, pdf.js carga su worker en el mismo hilo ("fake worker") y para
    eso necesita el archivo del worker. Si no se le dice dónde está, lo deduce
    de su propia ubicación, y en la función desplegada esa ruta no existía:
    fallaba con "Setting up fake worker failed: Cannot find module
    .../pdf.worker.mjs".

    Se resuelve la ruta real desde node_modules en lugar de dejar que la
    adivine. Si no se pudiera resolver, se sigue adelante sin fijarla: pdf.js
    volvería a su método de siempre y el error sería el mismo de antes, no uno
    nuevo introducido por esta línea.
  */
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    try {
      const { createRequire } = await import('node:module');
      pdfjs.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
    } catch (error) {
      console.warn('[pms] no se pudo resolver el worker de pdf.js', error);
    }
  }

  const document = await pdfjs.getDocument({
    data,
    // Sin fuentes del sistema ni workers: el servidor sólo necesita el texto.
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;

  const fragments: TextFragment[] = [];
  try {
    for (let page = 1; page <= document.numPages; page += 1) {
      const pdfPage = await document.getPage(page);
      const [content, annotations] = await Promise.all([
        pdfPage.getTextContent(),
        pdfPage.getAnnotations({ intent: 'display' }),
      ]);
      const linkBoxes = linkBoxesOf(annotations as unknown[]);
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const transform = item.transform as number[];
        const x = transform[4];
        const y = transform[5];
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        const width = typeof item.width === 'number' ? Math.abs(item.width) : 0;
        const height =
          typeof item.height === 'number'
            ? Math.abs(item.height)
            : Math.max(Math.abs(transform[0] ?? 0), Math.abs(transform[3] ?? 0), 0);
        const isLink = overlapsLink(linkBoxes, { x, y, width, height });
        fragments.push({ page, x, y, text: item.str, ...(isLink ? { isLink: true } : {}) });
      }
      pdfPage.cleanup();
    }
  } finally {
    await document.destroy();
  }

  return fragments;
}
