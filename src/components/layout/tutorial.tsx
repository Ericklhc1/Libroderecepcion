'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Compass } from 'lucide-react';
import { Button, SubmitButton } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/form';
import { finishTutorialAction } from '@/server/actions/tutorial';
import type { HelpTopic } from '@/domain/help';

/**
 * Recorrido guiado del primer ingreso.
 *
 * Reutiliza los procedimientos de la central de ayuda —no repite sus textos— y
 * muestra sólo los que esa persona puede ejecutar: un recepcionista no
 * necesita aprender a emitir comunicados.
 *
 * Se puede saltar en cualquier momento, y eso es deliberado: alguien que entra
 * a las tres de la mañana con el mesón lleno no puede quedar atrapado en un
 * recorrido. Se vuelve a abrir desde el perfil.
 *
 * A diferencia del comunicado obligatorio, esto **no bloquea**: es ayuda, no
 * una orden.
 */
export function TutorialTour({
  steps,
  userName,
}: {
  steps: HelpTopic[];
  userName: string;
}) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || steps.length === 0) return null;

  const step = steps[index];
  if (!step) return null;

  const isLast = index === steps.length - 1;
  const first = index === 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-20 lg:bottom-4 lg:left-auto lg:right-4 lg:w-96 lg:px-0 lg:pb-0 no-print">
      <div className="rounded-xl bg-petrol-900 p-4 text-petrol-50 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-petrol-800 p-1.5 text-gold-400">
            <Compass className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gold-400">
              {first ? `Bienvenido, ${userName}` : 'Recorrido guiado'} · {index + 1} de{' '}
              {steps.length}
            </p>
            <p className="mt-0.5 font-semibold">{step.question}</p>
          </div>
        </div>

        <ol className="mt-2 space-y-1 text-sm text-petrol-100">
          {step.steps.map((line, position) => (
            <li key={line} className="flex gap-2">
              <span className="tabular shrink-0 text-xs text-gold-400">{position + 1}.</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>

        {step.route ? (
          <Link
            href={step.route}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-gold-400 hover:underline"
          >
            Ver esa pantalla
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-petrol-800 pt-3">
          {/*
            Saltar está siempre disponible, desde el primer paso: alguien con
            el mesón lleno no puede quedar atrapado acá.
          */}
          <ActionForm
            action={finishTutorialAction}
            hideSuccess
            className="space-y-0"
            refreshOnSuccess
          >
            <SubmitButton variant="ghost" size="sm" pendingLabel="…">
              {isLast ? 'Terminar' : 'Saltar el recorrido'}
            </SubmitButton>
          </ActionForm>

          <div className="flex items-center gap-1">
            {!first ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIndex((current) => current - 1)}
              >
                Atrás
              </Button>
            ) : null}
            {!isLast ? (
              <Button
                variant="gold"
                size="sm"
                onClick={() => setIndex((current) => current + 1)}
              >
                Siguiente
              </Button>
            ) : null}
          </div>
        </div>

        {/*
          Cerrar sin marcarlo como hecho: el recorrido vuelve en la próxima
          sesión. Es para quien quiere seguirlo pero no ahora.
        */}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-2 w-full text-center text-xs text-petrol-300 hover:text-petrol-100"
        >
          Ahora no, recuérdamelo la próxima vez
        </button>
      </div>
    </div>
  );
}
