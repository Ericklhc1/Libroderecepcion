'use client';

import { Dumbbell } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { createGymPassAction } from '@/server/actions/live-cash';

export type GymPassContext = {
  stayId: string;
  reservationCode: string;
  roomNumber: string;
  guestName: string;
};

export function GymPassDialog({
  context,
}: {
  context: GymPassContext;
  /** Compatibilidad temporal con llamadas antiguas; el pase ya no tiene precio. */
  prices?: { CLP: number; USD: number };
}) {
  return (
    <Dialog
      triggerVariant="secondary"
      width="sm"
      trigger={
        <>
          <Dumbbell className="h-4 w-4" aria-hidden="true" />
          Pase gimnasio
        </>
      }
      title={`Pase de gimnasio · habitación ${context.roomNumber}`}
      description="Genera un folio por cada pax. El pase es informativo y no crea ingresos ni egresos en Caja."
    >
      <ActionForm action={createGymPassAction} closeOnSuccess resetOnSuccess>
        <input type="hidden" name="stayId" value={context.stayId} />

        <div className="rounded-xl bg-petrol-50 p-3 ring-1 ring-petrol-100">
          <p className="font-semibold text-petrol-900">Habitación {context.roomNumber}</p>
          <p className="text-sm text-slate-700">{context.guestName}</p>
          <p className="text-xs tabular text-slate-500">Reserva {context.reservationCode}</p>
        </div>

        <Field
          label="Cantidad de pax"
          name="pax"
          required
          hint="1 pax = 1 folio. La cantidad de habitaciones no cambia este cálculo."
        >
          <Input
            name="pax"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            step={1}
            defaultValue={1}
            required
          />
        </Field>

        <div className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-petrol-900 ring-1 ring-gold-200">
          Los folios nuevos usan cuatro dígitos y comienzan en 1000. Se generan de forma correlativa y nunca dependen de un precio o medio de pago.
        </div>

        <SubmitButton pendingLabel="Generando…">Generar pase de gimnasio</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
