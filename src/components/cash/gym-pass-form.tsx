'use client';

import { useState } from 'react';
import { Banknote, Dumbbell } from 'lucide-react';
import { ActionForm, Field, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { createGymPassAction } from '@/server/actions/live-cash';

export function GymPassForm({
  reservation,
  prices,
}: {
  reservation: {
    id: string;
    code: string;
    roomNumber: string;
    guestName: string;
  };
  prices: { CLP: number; USD: number };
}) {
  const [currency, setCurrency] = useState<'CLP' | 'USD'>('CLP');
  const price = currency === 'CLP' ? prices.CLP : prices.USD;

  return (
    <ActionForm action={createGymPassAction} className="space-y-4">
      <input type="hidden" name="reservationReferenceId" value={reservation.id} />

      <div className="rounded-xl bg-petrol-50 p-4 ring-1 ring-petrol-100">
        <div className="flex items-start gap-3">
          <Dumbbell className="mt-0.5 h-5 w-5 text-petrol-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-petrol-900">Habitación {reservation.roomNumber}</p>
            <p className="text-sm text-slate-700">{reservation.guestName}</p>
            <p className="text-xs tabular text-slate-500">Reserva {reservation.code}</p>
          </div>
        </div>
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
        El sistema asignará un folio correlativo de seis dígitos. Si el pago es en efectivo, el
        monto entra automáticamente a Caja viva.
      </p>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Generando folio…">Generar folio</SubmitButton>
      </div>
    </ActionForm>
  );
}
