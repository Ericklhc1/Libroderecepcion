'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bug, RefreshCcw } from 'lucide-react';
import { reportRuntimeErrorAction } from '@/server/actions/diagnostics';

export default function OperationalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    void reportRuntimeErrorAction({
      message: error.message || 'Error de ejecución sin mensaje',
      digest: error.digest ?? null,
      pathname,
      stack: error.stack ?? null,
    }).catch(() => undefined);
  }, [error, pathname]);

  return (
    <div className="mx-auto max-w-2xl py-12">
      <div className="rounded-xl bg-white p-6 ring-1 ring-red-200">
        <div className="flex items-start gap-3">
          <Bug className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-petrol-900">Se produjo un error de ejecución</h1>
            <p className="mt-1 text-sm text-slate-600">
              El incidente quedó enviado al Centro de diagnóstico con su contexto técnico. Puedes intentar cargar nuevamente esta vista.
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs tabular text-slate-500">Referencia: {error.digest}</p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-petrol-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-petrol-700"
            >
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
