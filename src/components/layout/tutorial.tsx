'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import { Button, SubmitButton } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/form';
import { finishTutorialAction } from '@/server/actions/tutorial';
import type { TutorialStep } from '@/domain/tutorial-tour';

type Rect = { top: number; left: number; width: number; height: number };

function visibleTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return (
    nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }) ?? null
  );
}

/**
 * Recorrido guiado con foco real sobre la interfaz.
 *
 * Cada paso puede navegar a su pantalla y señalar un elemento visible. El
 * recuadro y la flecha se calculan en el navegador, por lo que siguen al
 * elemento incluso si cambia el tamaño de la ventana. Si una sección no está
 * disponible en esa resolución, el recorrido conserva el texto y no bloquea.
 */
export function TutorialTour({
  steps,
  userName,
}: {
  steps: TutorialStep[];
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const first = index === 0;

  useEffect(() => {
    if (!step?.route || pathname === step.route || pathname.startsWith(`${step.route}/`)) return;
    router.push(step.route);
  }, [pathname, router, step]);

  useEffect(() => {
    if (!step) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const locate = () => {
      const target = visibleTarget(step.target);
      if (!target) {
        setTargetRect(null);
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      timer = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      }, 220);
    };

    timer = setTimeout(locate, 180);
    window.addEventListener('resize', locate);
    window.addEventListener('scroll', locate, true);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', locate);
      window.removeEventListener('scroll', locate, true);
    };
  }, [pathname, step]);

  const pointer = useMemo(() => {
    if (!targetRect) return null;
    const cx = targetRect.left + targetRect.width / 2;
    const cy = targetRect.top + targetRect.height / 2;
    return { x: cx, y: cy };
  }, [targetRect]);

  if (dismissed || steps.length === 0 || !step) return null;

  return (
    <>
      {targetRect ? (
        <div className="pointer-events-none fixed inset-0 z-[60] no-print" aria-hidden="true">
          <div
            className="absolute rounded-xl ring-4 ring-gold-400 shadow-[0_0_0_9999px_rgba(6,31,41,0.64)] transition-all duration-200"
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
              style={{
                left: Math.min(window.innerWidth - 24, Math.max(24, pointer.x)),
                top: Math.min(window.innerHeight - 90, Math.max(24, targetRect.top - 28)),
              }}
            >
              ↓
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-20 lg:bottom-4 lg:left-auto lg:right-4 lg:w-[26rem] lg:px-0 lg:pb-0 no-print">
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

          {step.route ? (
            <p className="mt-2 text-xs text-petrol-300">
              Pantalla: <span className="font-medium text-gold-300">{step.route}</span>
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-petrol-800 pt-3">
            <ActionForm action={finishTutorialAction} hideSuccess className="space-y-0" refreshOnSuccess>
              <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                {isLast ? 'Terminar' : 'Saltar'}
              </SubmitButton>
            </ActionForm>

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
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-2 w-full text-center text-xs text-petrol-300 hover:text-petrol-100"
          >
            Ahora no, recuérdamelo la próxima vez
          </button>
        </div>
      </div>
    </>
  );
}
