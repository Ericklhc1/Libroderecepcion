import { MANUAL_DOCUMENT_LIMITS as LIMITS } from '@/domain/manual-documents/types';
import type { DocumentExtraction, DocumentFormat } from '@/domain/manual-documents/types';
import { readLocalPdf } from './pdf-runtime';

export async function readLocalDocument(name: string, bytes: Uint8Array, format: DocumentFormat, signal: AbortSignal): Promise<DocumentExtraction> {
  if (format === 'pdf') return readLocalPdf(bytes, signal);
  if (signal.aborted) throw new Error('Lectura cancelada.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./table-reader.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { finish(); reject(new Error('Lectura cancelada. No se ha añadido el archivo.')); };
    const timer = setTimeout(() => { finish(); reject(new Error('El archivo excedió el tiempo de lectura. Usa un archivo más pequeño.')); }, LIMITS.parseTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: DocumentExtraction; error?: string }>) => {
      finish();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error || 'No se pudo leer el archivo.'));
    };
    worker.onerror = () => { finish(); reject(new Error('No se pudo iniciar el lector aislado. Prueba con CSV/TSV o actualiza el navegador.')); };
    const buffer = Uint8Array.from(bytes).buffer;
    worker.postMessage({ name, buffer }, [buffer]);
  });
}
