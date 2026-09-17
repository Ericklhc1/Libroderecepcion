'use client';

import { FileUp } from 'lucide-react';
import { ActionForm, Field } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { prepareGuestReservationImportAction } from '@/server/actions/guest-reservation-imports';

export function GuestReservationImportForm() {
  return (
    <ActionForm action={prepareGuestReservationImportAction} hideSuccess>
      <Field
        label="Cargar informes de huéspedes & reservas"
        name="reports"
        required
        hint="Habitaciones con actividad, entradas, in house y salidas. Puedes adjuntar varios PDF a la vez."
      >
        <input
          type="file"
          name="reports"
          accept="application/pdf"
          multiple
          required
          className="block w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-petrol-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:border-petrol-400"
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Leyendo los informes…">
        <FileUp className="h-4 w-4" aria-hidden="true" />
        Leer y revisar
      </SubmitButton>
    </ActionForm>
  );
}
