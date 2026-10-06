import { validateDocumentFile } from '@/domain/manual-documents/formats';
import { readLocalDelimited, readLocalWorkbook } from './table-reader';

self.onmessage = async (event: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try {
    const bytes = new Uint8Array(event.data.buffer);
    const format = validateDocumentFile(event.data.name, bytes);
    if (format === 'pdf') throw new Error('El PDF requiere su lector aislado.');
    const result = format === 'xlsx' ? await readLocalWorkbook(bytes) : readLocalDelimited(bytes, format);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'No se pudo leer el archivo.' });
  }
};
