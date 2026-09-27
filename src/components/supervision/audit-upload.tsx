'use client';

import { useRef, useState } from 'react';
import { FileUp, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

type UploadResult = {
  name: string;
  ok: boolean;
  label?: string;
  findings?: number;
  warnings?: string[];
  error?: string;
};

export function SupervisionAuditUpload({ defaultBusinessDate }: { defaultBusinessDate: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [businessDate, setBusinessDate] = useState(defaultBusinessDate);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length || busy) return;

    setBusy(true);
    setResults([]);
    const next: UploadResult[] = [];

    for (const file of files) {
      setCurrent(file.name);
      try {
        const body = new FormData();
        body.set('file', file);
        body.set('businessDate', businessDate);
        const response = await fetch('/api/supervision/auditoria-diaria', {
          method: 'POST',
          body,
          headers: { Accept: 'application/json' },
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          label?: string;
          findings?: number;
          warnings?: string[];
          error?: string;
        };
        next.push({
          name: file.name,
          ok: response.ok && payload.ok === true,
          label: payload.label,
          findings: payload.findings,
          warnings: payload.warnings,
          error: response.ok ? undefined : payload.error ?? 'No se pudo leer el informe.',
        });
      } catch (error) {
        next.push({
          name: file.name,
          ok: false,
          error: error instanceof Error ? error.message : 'No se pudo leer el informe.',
        });
      }
      setResults([...next]);
    }

    setCurrent(null);
    setBusy(false);
    if (next.some((item) => item.ok)) router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-petrol-50 px-3 py-3 text-sm text-petrol-900 ring-1 ring-petrol-100">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-petrol-700" aria-hidden="true" />
          <p>
            Los PDF se leen uno por uno y se descartan inmediatamente. El Libro conserva sólo los datos
            normalizados que alimentan Supervisión y el cierre del turno; no conserva el archivo ni su texto completo.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-500">Fecha auditada</span>
          <input
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.currentTarget.value)}
            required
            className="input-base w-full"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-500">Informes PDF</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            required
            disabled={busy}
            className="block w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-petrol-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:border-petrol-400 disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Cada archivo puede pesar hasta 4 MB. Puedes seleccionar todos los informes del día de una vez.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileUp className="h-4 w-4" aria-hidden="true" />}
        {busy ? (current ? `Leyendo ${current}…` : 'Procesando…') : 'CARGAR AUDITORÍA'}
      </button>

      {results.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {results.map((result) => (
            <li
              key={result.name}
              className={`rounded-lg px-3 py-2 ring-1 ${
                result.ok
                  ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                  : 'bg-red-50 text-red-900 ring-red-200'
              }`}
            >
              <p className="font-medium">
                {result.ok ? '✓' : '×'} {result.name}
                {result.label ? ` · ${result.label}` : ''}
              </p>
              {result.ok && typeof result.findings === 'number' && result.findings > 0 ? (
                <p className="mt-0.5 text-xs">{result.findings} punto(s) para revisar.</p>
              ) : null}
              {result.error ? <p className="mt-0.5 text-xs">{result.error}</p> : null}
              {result.warnings?.map((warning) => (
                <p key={warning} className="mt-0.5 text-xs">{warning}</p>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
