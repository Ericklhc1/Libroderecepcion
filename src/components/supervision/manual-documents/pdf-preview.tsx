'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { createLocalPdfTask } from './pdf-runtime';
import { MANUAL_DOCUMENT_LIMITS as LIMITS } from '@/domain/manual-documents/types';

export function LocalPdfPreview({ file, page }: { file: File; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;
    let render: RenderTask | undefined;
    setLoading(true);
    setError('');
    const timeout = setTimeout(() => { if (!disposed) { setError('La vista previa excedió el tiempo permitido. El original sigue disponible para descargar.'); setLoading(false); disposed = true; render?.cancel(); void task?.destroy(); } }, LIMITS.parseTimeoutMs);
    void (async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (disposed) return;
      task = await createLocalPdfTask(bytes);
      if (disposed) { await task.destroy(); return; }
      const document = await task.promise;
      if (document.numPages > LIMITS.pages) throw new Error('El PDF supera el límite de páginas.');
      const pdfPage = await document.getPage(page);
      if (disposed || !canvas.current) return;
      const original = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 900 / original.width, Math.sqrt(2_000_000 / (original.width * original.height)));
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('La página tiene dimensiones inválidas.');
      const viewport = pdfPage.getViewport({ scale });
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      const context = canvas.current.getContext('2d');
      if (!context) throw new Error('El navegador no permite dibujar el PDF.');
      // AnnotationMode.DISABLE: no widgets, actions, links or PDF scripting.
      render = pdfPage.render({ canvasContext: context, viewport, annotationMode: 0 });
      await render.promise;
    })().catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'No se pudo mostrar la página.');
    }).finally(() => {
      clearTimeout(timeout);
      if (!disposed) setLoading(false);
      void task?.destroy();
    });
    return () => { disposed = true; clearTimeout(timeout); render?.cancel(); void task?.destroy(); };
  }, [file, page]);
  return <div className="rounded-lg border border-slate-200 bg-slate-100 p-2">
    {loading && <p role="status" className="p-3 text-sm">Dibujando página {page} del original local…</p>}
    {error && <p role="alert" className="p-3 text-sm text-red-700">{error}</p>}
    <canvas ref={canvas} aria-label={`Página ${page} del PDF original`} className={`mx-auto h-auto max-w-full bg-white ${loading || error ? 'hidden' : ''}`} />
  </div>;
}
