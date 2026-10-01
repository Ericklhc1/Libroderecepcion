'use client';

import { lockBodyScroll } from '@/lib/body-scroll-lock';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  CheckCircle2,
  FileUp,
  Lightbulb,
  Loader2,
  MessageSquareWarning,
  Trash2,
  X,
} from 'lucide-react';

type RequestKind = 'ERROR' | 'FUNCION';

type AttachmentDraft = {
  name: string;
  type: string;
  dataUrl: string;
};

type StoredAttachmentDraft = {
  kind: 'CAPTURA' | 'ARCHIVO';
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

type SubmitState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'ok'; message: string }
  | { status: 'error'; message: string };

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function readFile(file: File): Promise<AttachmentDraft> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error('El archivo supera 3 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type || 'application/octet-stream',
        dataUrl: String(reader.result ?? ''),
      });
    reader.readAsDataURL(file);
  });
}

async function captureCurrentScreen(): Promise<AttachmentDraft> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Este navegador no permite capturar pantalla desde la Central.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });
    }

    const sourceWidth = Math.max(1, video.videoWidth);
    const sourceHeight = Math.max(1, video.videoHeight);
    const maxWidth = 1440;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la captura.');

    context.drawImage(video, 0, 0, width, height);
    return {
      name: `captura-${new Date().toISOString().replaceAll(':', '-')}.jpg`,
      type: 'image/jpeg',
      dataUrl: canvas.toDataURL('image/jpeg', 0.82),
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

async function archiveAttachment(
  draft: AttachmentDraft,
  kind: StoredAttachmentDraft['kind'],
): Promise<StoredAttachmentDraft> {
  const blob = await fetch(draft.dataUrl).then((response) => response.blob());
  const initResponse = await fetch('/api/soporte/adjuntos/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: draft.name,
      type: draft.type,
      size: blob.size,
      kind,
    }),
  });
  const init = (await initResponse.json().catch(() => ({}))) as {
    error?: string;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    kind?: StoredAttachmentDraft['kind'];
    uploadUrl?: string;
  };
  if (!initResponse.ok || !init.uploadUrl || !init.storageKey) {
    throw new Error(init.error || 'No se pudo preparar el archivado interno.');
  }

  const upload = await fetch(init.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': init.mimeType || draft.type },
    body: blob,
  });
  if (!upload.ok) {
    throw new Error(`El almacenamiento interno respondió ${upload.status}.`);
  }

  return {
    kind: init.kind || kind,
    storageKey: init.storageKey,
    fileName: init.fileName || draft.name,
    mimeType: init.mimeType || draft.type,
    size: init.size || blob.size,
  };
}

export function SupportRequestPanel({
  version,
  hotelName,
}: {
  version: string;
  hotelName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [kind, setKind] = useState<RequestKind>('ERROR');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<AttachmentDraft | null>(null);
  const [attachment, setAttachment] = useState<AttachmentDraft | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [state, setState] = useState<SubmitState>({ status: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const unlockBodyScroll = lockBodyScroll();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.status !== 'sending') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockBodyScroll();
    };
  }, [open, state.status]);

  async function capture() {
    setCaptureBusy(true);
    setState({ status: 'idle' });
    try {
      setScreenshot(await captureCurrentScreen());
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'No se pudo capturar la pantalla.',
      });
    } finally {
      setCaptureBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ status: 'idle' });
    try {
      setAttachment(await readFile(file));
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'No se pudo adjuntar el archivo.',
      });
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim() || !description.trim() || state.status === 'sending') return;

    setState({ status: 'sending' });
    try {
      const drafts: Array<{ draft: AttachmentDraft; kind: StoredAttachmentDraft['kind'] }> = [];
      if (screenshot) drafts.push({ draft: screenshot, kind: 'CAPTURA' });
      if (attachment) drafts.push({ draft: attachment, kind: 'ARCHIVO' });

      const storedAttachments: StoredAttachmentDraft[] = [];
      for (const item of drafts) {
        try {
          storedAttachments.push(await archiveAttachment(item.draft, item.kind));
        } catch {
          // El reporte no depende del storage: conserva el envío principal y el correo.
        }
      }

      const storedKinds = new Set(storedAttachments.map((item) => item.kind));
      const emailScreenshot = storedKinds.has('CAPTURA') ? null : screenshot;
      const emailAttachment = storedKinds.has('ARCHIVO') ? null : attachment;

      const response = await fetch('/api/soporte/solicitud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId: crypto.randomUUID(),
          kind,
          subject: subject.trim(),
          description: description.trim(),
          // Si el binario ya quedó en R2 no vuelve a viajar como base64 hacia Vercel.
          // El correo conserva sólo el fallback de los archivos que no lograron archivarse.
          screenshot: emailScreenshot,
          attachment: emailAttachment,
          storedAttachments,
          context: {
            pathname: window.location.pathname,
            search: window.location.search,
            href: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform || 'desconocida',
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            screen: `${window.screen.width}x${window.screen.height}`,
            version,
            hotelName,
          },
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        mailSent?: boolean;
        storedAttachmentCount?: number;
      };
      if (!response.ok) throw new Error(payload.error || 'No se pudo enviar la solicitud.');

      const storedCount = payload.storedAttachmentCount ?? storedAttachments.length;
      const missedCount = Math.max(0, drafts.length - storedCount);
      let message = payload.message || 'Solicitud enviada.';
      if (storedCount > 0) {
        message += ` ${storedCount === 1 ? 'El adjunto quedó' : 'Los adjuntos quedaron'} disponible${storedCount === 1 ? '' : 's'} en la bandeja.`;
      }
      if (missedCount > 0) {
        message += payload.mailSent
          ? ` ${missedCount === 1 ? 'Un adjunto no pudo' : `${missedCount} adjuntos no pudieron`} archivarse internamente, pero ${missedCount === 1 ? 'se incluyó' : 'se incluyeron'} en el correo.`
          : ` ${missedCount === 1 ? 'Un adjunto no pudo' : `${missedCount} adjuntos no pudieron`} archivarse internamente y el correo tampoco salió; conserva el archivo para reintentarlo si hace falta.`;
      }

      setState({
        status: 'ok',
        message,
      });
      setSubject('');
      setDescription('');
      setScreenshot(null);
      setAttachment(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'No se pudo enviar la solicitud.',
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-petrol-800 shadow-sm transition-colors hover:bg-slate-50 lg:inline-flex"
        aria-label="Reportar error o solicitar función"
      >
        <MessageSquareWarning className="h-4 w-4 text-petrol-600" aria-hidden="true" />
        <span className="hidden xl:inline">Reportar / solicitar</span>
      </button>

      {open && mounted ? createPortal(
        <div className="fixed inset-0 z-[130] no-print overscroll-contain">
          <button
            type="button"
            className="absolute inset-0 bg-petrol-950/40"
            aria-label="Cerrar"
            onClick={() => {
              if (state.status !== 'sending') setOpen(false);
            }}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-panel-title"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)]"
          >
            <header className="flex items-start gap-3 border-b border-slate-200 bg-petrol-900 px-4 py-4 text-white">
              <span className="mt-0.5 rounded-md bg-gold-500 p-2 text-petrol-950">
                <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="support-panel-title" className="font-semibold">
                  Reportar / solicitar
                </h2>
                <p className="mt-0.5 text-xs leading-4 text-petrol-100">
                  La Central adjunta automáticamente contexto técnico para que no tengas que explicar qué pantalla estabas usando.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={state.status === 'sending'}
                className="rounded-md p-1.5 text-petrol-100 hover:bg-petrol-800 disabled:opacity-40"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setKind('ERROR')}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    kind === 'ERROR'
                      ? 'border-red-300 bg-red-50 text-red-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <MessageSquareWarning className="mb-1 h-4 w-4" aria-hidden="true" />
                  <span className="block text-sm font-semibold">Reportar problema</span>
                  <span className="mt-0.5 block text-xs opacity-75">Algo no funciona como debería.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKind('FUNCION')}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    kind === 'FUNCION'
                      ? 'border-gold-400 bg-gold-50 text-petrol-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Lightbulb className="mb-1 h-4 w-4" aria-hidden="true" />
                  <span className="block text-sm font-semibold">Solicitar función</span>
                  <span className="mt-0.5 block text-xs opacity-75">Algo podría resolverse mejor.</span>
                </button>
              </div>

              <label className="mt-4 block">
                <span className="label-base">Asunto</span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  maxLength={160}
                  required
                  placeholder={kind === 'ERROR' ? 'Ej.: No puedo devolver una garantía' : 'Ej.: Filtro rápido por piso'}
                  className="input-base"
                />
              </label>

              <label className="mt-3 block">
                <span className="label-base">Descripción</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={7}
                  maxLength={6000}
                  required
                  placeholder="Qué ocurrió, qué esperabas que ocurriera y cualquier detalle útil."
                  className="input-base min-h-36 resize-y"
                />
              </label>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void capture()}
                  disabled={captureBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-petrol-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {captureBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-4 w-4" aria-hidden="true" />
                  )}
                  Capturar pantalla
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-petrol-700 hover:bg-slate-50"
                >
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Adjuntar archivo
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/csv"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                />
              </div>

              {screenshot || attachment ? (
                <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                  {screenshot ? (
                    <div className="flex items-center gap-2 text-xs text-slate-700">
                      <Camera className="h-3.5 w-3.5 text-petrol-600" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{screenshot.name}</span>
                      <button
                        type="button"
                        onClick={() => setScreenshot(null)}
                        className="rounded p-1 text-slate-500 hover:bg-white hover:text-red-700"
                        aria-label="Quitar captura"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  {attachment ? (
                    <div className="flex items-center gap-2 text-xs text-slate-700">
                      <FileUp className="h-3.5 w-3.5 text-petrol-600" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachment(null);
                          if (fileRef.current) fileRef.current.value = '';
                        }}
                        className="rounded p-1 text-slate-500 hover:bg-white hover:text-red-700"
                        aria-label="Quitar archivo"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 rounded-md bg-petrol-50 px-3 py-2.5 text-xs leading-4 text-petrol-800 ring-1 ring-petrol-100">
                Se enviarán automáticamente: referencia de soporte, módulo/ruta, versión, alojamiento, navegador/plataforma, zona horaria, tamaño de ventana y estado de turno cuando corresponda. Las capturas y archivos se archivan de forma privada para consultarlos desde la bandeja; si ese archivado falla, el sistema conserva el envío por correo como respaldo.
              </div>

              {state.status === 'ok' ? (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {state.message}
                </p>
              ) : null}

              {state.status === 'error' ? (
                <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
                  {state.message}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={
                  state.status === 'sending' ||
                  subject.trim().length === 0 ||
                  description.trim().length === 0
                }
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-petrol-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-petrol-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.status === 'sending' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Enviando…
                  </>
                ) : kind === 'ERROR' ? (
                  'Enviar reporte'
                ) : (
                  'Enviar solicitud'
                )}
              </button>
            </form>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
