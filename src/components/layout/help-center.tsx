'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CircleHelp, Search, X } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { runHelpActionAction } from '@/server/actions/help';
import { HELP_ACTIONS, searchHelp, type HelpTopic } from '@/domain/help';
import type { PermissionKey } from '@/lib/permissions';

/**
 * Central de ayuda.
 *
 * Documentación buscable de los procedimientos reales, filtrada por lo que la
 * persona puede hacer. No es un modelo de lenguaje a propósito: una respuesta
 * inventada sobre cómo cerrar una caja es peor que no tener ayuda.
 *
 * La búsqueda corre **en el cliente**, sobre el catálogo del dominio: son una
 * docena de procedimientos, así que ir al servidor por cada tecla sería una
 * espera sin ninguna ganancia.
 *
 * Algunos procedimientos traen un botón que **ejecuta** el paso, pero sólo
 * cuando la acción es reversible. Lo irreversible lleva a la pantalla y ahí
 * decide la persona.
 */
export function HelpCenter({ permissions }: { permissions: PermissionKey[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchHelp(query, permissions), [query, permissions]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg p-2 text-petrol-700 transition-colors hover:bg-petrol-50"
        aria-label="Abrir la central de ayuda"
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-petrol-50 p-2 text-petrol-800"
        aria-label="Central de ayuda"
      >
        <CircleHelp className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <button
          type="button"
          className="absolute inset-0 bg-petrol-950/40"
          aria-label="Cerrar la ayuda"
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Central de ayuda"
          className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-xl"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
              }}
              autoFocus
              placeholder="¿Qué necesitas hacer? Ej.: caja, llaves, no deja confirmar…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              aria-label="Buscar en la ayuda"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {results.length === 0 ? (
              /*
                Se dice que no hay nada, en vez de mostrar algo aproximado.
                Una ayuda que responde cualquier cosa deja de ser confiable.
              */
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-petrol-900">
                  No hay un procedimiento para eso.
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Prueba con otras palabras, o pregúntale a tu Supervisor y que quede como
                  procedimiento si hace falta.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {results.map((topic) => (
                  <HelpEntry key={topic.id} topic={topic} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>

          <p className="border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400">
            Los procedimientos describen lo que el sistema hace de verdad. Si algo no coincide,
            avísale a tu Supervisor.
          </p>
        </div>
      </div>
    </>
  );
}

function HelpEntry({
  topic,
  onNavigate,
}: {
  topic: HelpTopic;
  onNavigate: () => void;
}) {
  const action = topic.action ? HELP_ACTIONS[topic.action] : null;

  return (
    <li className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="font-medium text-petrol-900">{topic.question}</p>

      <ol className="mt-1.5 space-y-1 text-sm text-slate-700">
        {topic.steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="tabular shrink-0 text-xs font-semibold text-petrol-500">
              {index + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {topic.caveat ? (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
          {topic.caveat}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {topic.route ? (
          <Link
            href={topic.route}
            onClick={onNavigate}
            className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
          >
            Ir a la pantalla
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}

        {action ? (
          <ActionForm action={runHelpActionAction} className="space-y-0">
            <input type="hidden" name="action" value={topic.action} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Ejecutando…">
              {action.label}
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>

      {action ? (
        <p className="mt-1 text-xs text-slate-500">{action.explains}</p>
      ) : null}
    </li>
  );
}
