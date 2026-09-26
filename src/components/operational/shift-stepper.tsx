import { ShiftStatus } from '@prisma/client';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

const STEPS = [
  'Iniciar turno',
  'Operar',
  'Cerrar Caja',
  'Enviar entrega',
  'Cerrar turno',
] as const;

function currentStep(status: ShiftStatus): number {
  switch (status) {
    case ShiftStatus.PROGRAMADO:
    case ShiftStatus.INICIADO:
      return 0;
    case ShiftStatus.ACTIVO:
      return 1;
    case ShiftStatus.PREPARANDO_ENTREGA:
      return 2;
    case ShiftStatus.ENTREGA_ENVIADA:
    case ShiftStatus.RECIBIDO:
      return 4;
    case ShiftStatus.CERRADO:
      return STEPS.length;
    default:
      return 0;
  }
}

/**
 * Guía operativa del turno. Deliberadamente usa acciones concretas y no los
 * nombres técnicos de la máquina de estados.
 */
export function ShiftStepper({ status }: { status: ShiftStatus }) {
  if (status === ShiftStatus.ANULADO) {
    return (
      <p className="text-xs font-medium text-slate-500">
        Turno anulado: no participa del ciclo operativo.
      </p>
    );
  }

  const activeIndex = currentStep(status);
  const completed = status === ShiftStatus.CERRADO;
  const visibleIndex = completed ? STEPS.length - 1 : activeIndex;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-petrol-800">
        {completed
          ? 'Turno completado · 5 de 5'
          : `Paso ${visibleIndex + 1} de ${STEPS.length} · ${STEPS[visibleIndex]}`}
      </p>
      <ol className="flex flex-wrap items-center gap-1 text-[0.7rem]">
        {STEPS.map((label, index) => {
          const done = completed || index < activeIndex;
          const current = !completed && index === activeIndex;
          return (
            <li key={label} className="flex items-center gap-1">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium',
                  current
                    ? 'bg-petrol-700 text-white'
                    : done
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500',
                )}
                aria-current={current ? 'step' : undefined}
              >
                {done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                {label}
              </span>
              {index < STEPS.length - 1 ? (
                <span className="text-slate-300" aria-hidden="true">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
