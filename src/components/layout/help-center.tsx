'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRight, CircleHelp, Compass, Search, X } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { runHelpActionAction } from '@/server/actions/help';
import {
  restartModuleTutorialAction,
  restartTutorialAction,
} from '@/server/actions/tutorial';
import { HELP_ACTIONS, searchHelp, type HelpTopic } from '@/domain/help';
import { visibleTutorialModules } from '@/domain/tutorial-tour';
import type { PermissionKey } from '@/lib/permissions';

/**
 * Central de ayuda.
 *
 * El diálogo se porta a document.body para que en móvil no quede atrapado por
 * un ancestro del shell, la navegación inferior o cualquier transform del
 * recorrido guiado. `100dvh` sigue el viewport visible real de Safari cuando
 * aparecen/desaparecen sus barras, evitando que la cabecera quede fuera de la
 * pantalla.
 */
export function HelpCenter({
  permissions,
  userId,
}: {
  permissions: PermissionKey[];
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchHelp(query, permissions), [query, permissions]);
  const tutorialModules = useMemo(
    () => visibleTutorialModules(permissions),
    [permissions],
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={
        open
          ? 'inline-flex h-9 items-center gap-2 rounded-md border border-petrol-100 bg-petrol-50 px-2.5 text-sm font-medium text-petrol-800'
          : 'inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-petrol-800 shadow-sm transition-colors hover:bg-slate-50'
      }
      aria-label={open ? 'Central de ayuda' : 'Abrir la central de ayuda'}
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xl:inline">Ayuda</span>
    </button>
  );

  if (!open || !mounted) return trigger;

  const dialog = (
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-2 sm:items-center sm:p-4">
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
        className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-slate-300 bg-white shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)] sm:max-h-[85dvh]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            placeholder="¿Qué necesitas hacer? Ej.: caja, llaves, no deja confirmar…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            aria-label="Buscar en la ayuda"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-petrol-50 px-3 py-3 ring-1 ring-petrol-100">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-petrol-900">Recorrido paso a paso</p>
              <p className="mt-0.5 text-xs leading-4 text-slate-600">
                Vuelve a recorrer la Central según los permisos de tu cuenta.
              </p>
            </div>
            <ActionForm
              action={restartTutorialAction}
              className="space-y-0"
              onSuccess={() => {
                window.sessionStorage.removeItem(`libro:tutorial:dismissed:${userId}`);
                window.location.reload();
              }}
            >
              <SubmitButton variant="secondary" size="sm" pendingLabel="Preparando…">
                <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                Iniciar recorrido
              </SubmitButton>
            </ActionForm>
          </div>

          <div className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-3">
            <p className="text-sm font-semibold text-petrol-900">Tutoriales por módulo</p>
            <p className="mt-0.5 text-xs leading-4 text-slate-600">
              Si te habilitan un módulo nuevo, su tutorial aparece automáticamente. También puedes
              repetir cualquiera de los módulos disponibles para tu cuenta.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tutorialModules.map((module) => (
                <ActionForm
                  key={module.key}
                  action={restartModuleTutorialAction}
                  className="space-y-0"
                  onSuccess={() => {
                    window.sessionStorage.removeItem(
                      `libro:tutorial:module:${userId}:${module.key}`,
                    );
                    window.location.reload();
                  }}
                >
                  <input type="hidden" name="tutorialModules" value={module.key} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Preparando…">
                    {module.label}
                  </SubmitButton>
                </ActionForm>
              ))}
            </div>
          </div>

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Procedimientos
          </p>

          {results.length === 0 ? (
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

        <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-center text-xs text-slate-400">
          Los procedimientos describen lo que el sistema hace de verdad. Si algo no coincide,
          avísale a tu Supervisor.
        </p>
      </div>
    </div>
  );

  return (
    <>
      {trigger}
      {createPortal(dialog, document.body)}
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
    <li className="rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
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

      {action ? <p className="mt-1 text-xs text-slate-500">{action.explains}</p> : null}
    </li>
  );
}
