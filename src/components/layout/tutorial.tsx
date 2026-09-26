'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Compass, MousePointer2, RotateCcw } from 'lucide-react';
import { Button, SubmitButton } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/form';
import { finishTutorialAction } from '@/server/actions/tutorial';
import { shouldNavigateTutorial, type TutorialStep } from '@/domain/tutorial-tour';

type Rect = { top: number; left: number; width: number; height: number };

function visibleTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return (
    nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    }) ?? null
  );
}

function isInViewport(rect: DOMRect): boolean {
  const topSafe = 72;
  const bottomSafe = window.innerHeight - 96;
  return rect.bottom > topSafe && rect.top < bottomSafe;
}

/**
 * Recorrido guiado sin secuestrar el scroll.
 *
 * El paso puede hacer un único desplazamiento inicial para mostrar el objetivo.
 * Después, cualquier scroll del usuario sólo recalcula la posición del foco:
 * nunca vuelve a llamar scrollIntoView. Así se evita el bucle que antes hacía
 * "pelear" la página contra el dedo/rueda.
 *
 * Si la persona intenta interactuar con el Libro durante el recorrido, la
 * interacción se intercepta antes de llegar a la interfaz y se pregunta si
 * quiere cerrar el tutorial sólo por esta vez o no volver a mostrarlo.
 */
export function TutorialTour({
  steps,
  userId,
  userName,
  suspended = false,
}: {
  steps: TutorialStep[];
  userId: string;
  userName: string;
  suspended?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const dismissKey = `libro:tutorial:dismissed:${userId}`;
  const [dismissed, setDismissed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [targetOffscreen, setTargetOffscreen] = useState(false);
  const [interactionPrompt, setInteractionPrompt] = useState(false);
  const [neverAgainConfirmed, setNeverAgainConfirmed] = useState(false);
  const scrollRaf = useRef<number | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const first = index === 0;

  useEffect(() => {
    setDismissed(window.sessionStorage.getItem(dismissKey) === '1');
    setSessionReady(true);
  }, [dismissKey]);

  function dismissThisSession() {
    window.sessionStorage.setItem(dismissKey, '1');
    setDismissed(true);
  }

  useEffect(() => {
    if (
      !sessionReady ||
      !step?.route ||
      !shouldNavigateTutorial(dismissed, pathname, step.route, suspended)
    ) {
      return;
    }
    router.push(step.route);
  }, [dismissed, pathname, router, sessionReady, step, suspended]);

  useEffect(() => {
    if (!sessionReady || dismissed || suspended || !step) {
      setTargetRect(null);
      setTargetOffscreen(false);
      return;
    }

    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const measure = () => {
      const target = visibleTarget(step.target);
      if (!target) {
        setTargetRect(null);
        setTargetOffscreen(false);
        return;
      }
      const rect = target.getBoundingClientRect();
      const onScreen = isInViewport(rect);
      setTargetOffscreen(!onScreen);
      setTargetRect(
        onScreen
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
          : null,
      );
    };

    const initialLocate = () => {
      const target = visibleTarget(step.target);
      if (!target) {
        measure();
        return;
      }

      // ÚNICO desplazamiento automático del paso.
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      settleTimer = setTimeout(measure, 260);
    };

    const passiveMeasure = () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = null;
        measure();
      });
    };

    initialTimer = setTimeout(initialLocate, 180);
    window.addEventListener('resize', passiveMeasure);
    window.addEventListener('scroll', passiveMeasure, true);

    return () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (settleTimer) clearTimeout(settleTimer);
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
      scrollRaf.current = null;
      window.removeEventListener('resize', passiveMeasure);
      window.removeEventListener('scroll', passiveMeasure, true);
    };
  }, [dismissed, pathname, sessionReady, step, suspended]);

  useEffect(() => {
    if (!sessionReady || dismissed || suspended || !step) return;

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-tutorial-ui="true"]')) return;

      // Se intercepta el click, no pointerdown: tocar/arrastrar para hacer scroll
      // sigue funcionando en móvil y trackpad sin abrir este diálogo.
      event.preventDefault();
      event.stopPropagation();
      setInteractionPrompt(true);
    };

    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [dismissed, sessionReady, step, suspended]);

  const pointer = useMemo(() => {
    if (!targetRect) return null;
    return {
      x: targetRect.left + targetRect.width / 2,
      y: Math.max(24, targetRect.top - 28),
    };
  }, [targetRect]);

  function goBackToTarget() {
    const target = visibleTarget(step?.target);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  if (!sessionReady || dismissed || suspended || steps.length === 0 || !step) return null;

  return (
    <>
      {targetRect ? (
        <div className="pointer-events-none fixed inset-0 z-[60] no-print" aria-hidden="true">
          <div
            className="absolute rounded-xl ring-4 ring-gold-400 shadow-[0_0_0_9999px_rgba(6,31,41,0.64)] transition-all duration-150"
            style={{
              top: Math.max(6, targetRect.top - 6),
              left: Math.max(6, targetRect.left - 6),
              width: targetRect.width + 12,
              height: targetRect.height + 12,
            }}
          />
          {pointer ? (
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 text-3xl text-gold-400 drop-shadow-lg"
              style={{ left: pointer.x, top: pointer.y }}
            >
              ↓
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        data-tutorial-ui="true"
        className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-20 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[26rem] lg:px-0 lg:pb-0 no-print"
      >
        <div className="rounded-xl bg-petrol-900 p-4 text-petrol-50 shadow-2xl ring-1 ring-white/10">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-lg bg-petrol-800 p-1.5 text-gold-400">
              <Compass className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gold-400">
                {first ? `Bienvenido, ${userName}` : 'Recorrido guiado'} · {index + 1} de {steps.length}
              </p>
              <p className="mt-0.5 font-semibold">{step.title}</p>
              <p className="mt-1.5 text-sm leading-5 text-petrol-100">{step.description}</p>
            </div>
          </div>

          {targetOffscreen ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-amber-100/10 px-3 py-2 ring-1 ring-amber-300/30">
              <p className="text-xs text-amber-100">
                Te alejaste del punto señalado. Puedes seguir leyendo sin que la página te arrastre.
              </p>
              <Button variant="ghost" size="sm" onClick={goBackToTarget}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Volver al punto
              </Button>
            </div>
          ) : null}

          {step.route ? (
            <p className="mt-2 text-xs text-petrol-300">
              Pantalla: <span className="font-medium text-gold-300">{step.route}</span>
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-petrol-800 pt-3">
            <Button variant="ghost" size="sm" onClick={() => dismissThisSession()}>
              Cerrar esta vez
            </Button>

            <div className="flex items-center gap-1">
              {!first ? (
                <Button variant="ghost" size="sm" onClick={() => setIndex((current) => current - 1)}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Atrás
                </Button>
              ) : null}
              {!isLast ? (
                <Button variant="gold" size="sm" onClick={() => setIndex((current) => current + 1)}>
                  Siguiente
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <ActionForm
                  action={finishTutorialAction}
                  hideSuccess
                  className="space-y-0"
                  onSuccess={() => {
                    setNeverAgainConfirmed(true);
                    window.setTimeout(() => dismissThisSession(), 1200);
                  }}
                >
                  <SubmitButton variant="gold" size="sm" pendingLabel="Guardando…">
                    Finalizar recorrido
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>

          {neverAgainConfirmed ? (
            <p className="mt-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 ring-1 ring-emerald-300/20">
              Ok, no volverás a ver el tutorial. Puedes activarlo cuando quieras desde Mi perfil.
            </p>
          ) : (
            <ActionForm
              action={finishTutorialAction}
              hideSuccess
              className="mt-2 space-y-0 text-center"
              onSuccess={() => {
                setNeverAgainConfirmed(true);
                window.setTimeout(() => dismissThisSession(), 1500);
              }}
            >
              <SubmitButton variant="ghost" size="sm" pendingLabel="Guardando…">
                No volver a mostrar el tutorial
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {interactionPrompt ? (
        <div
          data-tutorial-ui="true"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-petrol-950/45 p-4 no-print"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-interaction-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-petrol-50 p-2 text-petrol-800">
                <MousePointer2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="tutorial-interaction-title" className="font-semibold text-petrol-950">
                  ¿Quieres interactuar con el Libro?
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Hemos detectado que quieres usar la interfaz mientras el tutorial está activo.
                  Puedes cerrarlo sólo por esta vez o dejar de mostrarlo automáticamente.
                </p>
              </div>
            </div>

            {neverAgainConfirmed ? (
              <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                Ok, no volverás a ver el tutorial. Puedes activarlo cuando quieras desde Mi perfil.
              </p>
            ) : (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setInteractionPrompt(false);
                    dismissThisSession();
                  }}
                >
                  Cerrar esta vez
                </Button>
                <ActionForm
                  action={finishTutorialAction}
                  hideSuccess
                  className="space-y-0"
                  onSuccess={() => {
                    setNeverAgainConfirmed(true);
                    window.setTimeout(() => {
                      setInteractionPrompt(false);
                      dismissThisSession();
                    }, 1500);
                  }}
                >
                  <SubmitButton variant="gold" pendingLabel="Guardando…">
                    No volver a mostrar
                  </SubmitButton>
                </ActionForm>
              </div>
            )}

            {!neverAgainConfirmed ? (
              <button
                type="button"
                onClick={() => setInteractionPrompt(false)}
                className="mt-3 w-full text-center text-xs font-medium text-slate-500 hover:text-petrol-700"
              >
                Seguir con el tutorial
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
