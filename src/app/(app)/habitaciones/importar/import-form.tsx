'use client';

import { FileUp } from 'lucide-react';
import { ActionForm, Field } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { prepareImportAction } from '@/server/actions/rooms';

/**
 * Carga de los tres informes.
 *
 * No aplica nada: deja un borrador y lleva a la revisión. El sistema jamás
 * cambia el estado del mesón sin que alguien vea antes lo que va a cambiar.
 */
export function ImportForm() {
  return (
    <ActionForm action={prepareImportAction} hideSuccess>
      <Field
        label="Informes del PMS en PDF"
        name="reports"
        required
        hint="Entradas, in house y salidas. Puedes adjuntar los tres a la vez; el sistema reconoce cada uno."
      >
        <input
          type="file"
          name="reports"
          accept="application/pdf"
          multiple
          required
          className="block w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-sm text-slate-600
            file:mr-3 file:rounded-md file:border-0 file:bg-petrol-800 file:px-3 file:py-1.5 file:text-sm
            file:font-medium file:text-white hover:border-petrol-400"
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Leyendo los informes…">
        <FileUp className="h-4 w-4" aria-hidden="true" />
        Leer y revisar
      </SubmitButton>
    </ActionForm>
  );
}
