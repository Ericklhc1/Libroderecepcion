'use client';

import { useState } from 'react';
import { Banknote, Dumbbell } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Select } from '@/components/ui/form';
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
  prices,
}: {
  context: GymPassContext;
  prices: { CLP: number; USD: number };
}) {
  const [currency, setCurrency] = useState<'CLP' | 'USD'>('CLP');
  const price = currency === 'CLP' ? prices.CLP : prices.USD;

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
      description="Disponible sólo para huéspedes IN_HOUSE o CHECK_OUT cuya salida todavía no se ha confirmado."
    >
      <ActionForm action={createGymPassAction} closeOnSuccess resetOnSuccess>
        <input type="hidden" name="stayId" value={context.stayId} />

        <div className="rounded-xl bg-petrol-50 p-3 ring-1 ring-petrol-100">
          <p className="font-semibold text-petrol-900">Habitación {context.roomNumber}</p>
          <p className="text-sm text-slate-700">{context.guestName}</p>
          <p className="text-xs tabular text-slate-500">Reserva {context.reservationCode}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Moneda" name="currency" required>
            <Select
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as 'CLP' | 'USD')}
              options={[
                { value: 'CLP', label: `CLP $${prices.CLP.toLocaleString('es-CL')}` },
                { value: 'USD', label: `USD ${prices.USD}` },
              ]}
            />
          </Field>
          <Field label="Medio de pago" name="paymentMethod" required>
            <Select
              name="paymentMethod"
              defaultValue="EFECTIVO"
              options={[
                { value: 'EFECTIVO', label: 'Efectivo' },
                { value: 'TARJETA', label: 'Tarjeta' },
                { value: 'OTRO', label: 'Otro' },
              ]}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gold-200 bg-gold-50 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-petrol-900">
            <Banknote className="h-4 w-4" aria-hidden="true" />
            Total
          </span>
          <strong className="tabular text-lg text-petrol-900">
            {currency} {price.toLocaleString('es-CL')}
          </strong>
        </div>

        <p className="text-xs text-slate-500">
          Se generará un folio correlativo de seis dígitos. Si el pago es en efectivo, el monto entra automáticamente a Caja.
        </p>

        <SubmitButton pendingLabel="Generando…">Generar folio</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
