'use client';

import { formatTime } from '@/lib/format';

import { useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { AiAttribution } from '@/components/ai/ai-attribution';

type BriefResponse = {
  brief?: string;
  generatedAt?: string;
  error?: string;
};

export function OperationalBriefButton() {
  const [brief, setBrief] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadBrief() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/fronti/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const payload = (await response.json()) as BriefResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'No pude generar el briefing.');
      }
      setBrief(payload.brief ?? 'Sin briefing disponible.');
      setGeneratedAt(payload.generatedAt ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pude generar el briefing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => void loadBrief()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-petrol-700 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {brief ? 'Actualizar análisis' : 'Analizar con Fronti'}
      </button>

      {brief ? (
        <div className="max-w-2xl rounded-lg bg-petrol-50 px-3 py-2 text-left ring-1 ring-petrol-100">
          <p className="whitespace-pre-line text-sm leading-5 text-petrol-950">{brief}</p>
          {generatedAt ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Análisis contextual · {formatTime(generatedAt)}
            </p>
          ) : null}
          <AiAttribution className="mt-2 justify-start text-left opacity-80" />
        </div>
      ) : null}

      {error ? (
        <p className="max-w-md text-right text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
