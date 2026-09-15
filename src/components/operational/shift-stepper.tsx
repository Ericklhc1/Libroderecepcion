import { ShiftStatus } from '@prisma/client';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SHIFT_STATUS_LABEL } from '@/domain/shift';

const STEPS: ShiftStatus[] = [
  ShiftStatus.PROGRAMADO,
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
  ShiftStatus.ENTREGA_ENVIADA,
  ShiftStatus.RECIBIDO,
  ShiftStatus.CERRADO,
];

/** Ciclo del turno, con el paso actual resaltado. */
export function ShiftStepper({ status }: { status: ShiftStatus }) {
  if (status === ShiftStatus.ANULADO) {
    return (
      <p className="text-xs font-medium text-slate-500">
        Turno anulado: no participa del ciclo de entregas.
      </p>
    );
  }

  const currentIndex = STEPS.indexOf(status);

  return (
    <ol className="flex flex-wrap items-center gap-1 text-[0.7rem]">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-1">
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
              {SHIFT_STATUS_LABEL[step]}
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
  );
}
