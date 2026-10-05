import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { boundEvidence } from '@/domain/manual-documents/formats';
import { MANUAL_DOCUMENT_LIMITS as LIMITS } from '@/domain/manual-documents/types';
import type { DocumentEvidence, DocumentExtraction } from '@/domain/manual-documents/types';

export async function createLocalPdfTask(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Bundled same-origin worker. No CDN, external font service or native PDF plugin.
  const worker = new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url), { type: 'module' });
  const pdfWorker: InstanceType<typeof pdfjs.PDFWorker> = pdfjs.PDFWorker.fromPort({ port: worker });
  const task = pdfjs.getDocument({ data: Uint8Array.from(data), worker: pdfWorker,
    isEvalSupported: false, useSystemFonts: false, disableAutoFetch: true, disableStream: true,
    useWorkerFetch: false, maxImageSize: 4_000_000, canvasMaxAreaInBytes: 16_000_000,
  });
  const destroy = task.destroy.bind(task);
  let destruction: Promise<void> | undefined;
  task.destroy = () => destruction ??= (async () => {
    // A stuck decoder must not hold cancellation hostage to its own reply.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([destroy().catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, 100); })]); }
    finally { clearTimeout(timer); pdfWorker.destroy(); worker.terminate(); }
  })();
  return task;
}

export async function readLocalPdf(bytes: Uint8Array, signal: AbortSignal): Promise<DocumentExtraction> {
  const task = await createLocalPdfTask(bytes);
  let aborted = signal.aborted;
  let rejectInterrupted: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const abort = () => { aborted = true; rejectInterrupted(new Error('Lectura cancelada o fuera del tiempo permitido.')); void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  if (aborted) { await task.destroy(); throw new Error('Lectura cancelada.'); }
  const timer = setTimeout(abort, LIMITS.parseTimeoutMs);
  const evidence: DocumentEvidence[] = [];
  let characters = 0;
  try {
    return await Promise.race([interrupted, (async () => {
    const document = await task.promise;
    if (document.numPages > LIMITS.pages) throw new Error('El PDF supera 40 páginas. Divide el documento antes de revisarlo.');
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (aborted) throw new Error('Lectura cancelada o fuera del tiempo permitido.');
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const [index, item] of content.items.entries()) {
        if (!('str' in item) || !item.str.trim()) continue;
        characters += item.str.length;
        if (characters > LIMITS.textCharacters || evidence.length >= LIMITS.cells) throw new Error('El texto del PDF supera los límites de revisión.');
        evidence.push({ id: `p${pageNumber}:${index}`, page: pageNumber, x: item.transform[4], y: item.transform[5], text: item.str });
      }
      page.cleanup();
    }
    boundEvidence(evidence);
    return { evidence, pageCount: document.numPages, sheets: [], warnings: evidence.length
      ? ['El orden y el contenido del texto pueden diferir del diseño. Coteja cada dato con la página original.']
      : ['No se encontró texto seleccionable. Puedes mirar el original y transcribir datos con su página. Visión/IA no están habilitadas.'] };
    })()]);
  } catch (error) {
    if (aborted) throw new Error('Lectura cancelada o fuera del tiempo permitido. No se ha añadido el archivo.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}
