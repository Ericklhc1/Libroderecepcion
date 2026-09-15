import 'server-only';
import type { TextFragment } from '@/domain/pms/layout';

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
      const content = await pdfPage.getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const transform = item.transform as number[];
        const x = transform[4];
        const y = transform[5];
        if (typeof x !== 'number' || typeof y !== 'number') continue;
        fragments.push({ page, x, y, text: item.str });
      }
      pdfPage.cleanup();
    }
  } finally {
    await document.destroy();
  }

  return fragments;
}
