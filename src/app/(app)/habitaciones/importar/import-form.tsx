'use client';

import { FileUp } from 'lucide-react';
import { ActionForm, Field } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { prepareImportAction } from '@/server/actions/rooms';

/**
 * Carga de informes para «Huéspedes & reservas».
 *
 * No aplica nada: deja un borrador y lleva a revisión. El sistema nunca cambia
 * el estado operativo sin que alguien vea antes qué información se incorporará.
 */
export function ImportForm({ returnTo }: { returnTo?: 'turno' | 'habitaciones' }) {
  return (
    <ActionForm action={prepareImportAction} hideSuccess>
      {returnTo ? <input type="hidden" name="volverA" value={returnTo} /> : null}
      <Field
        label="Informes de huéspedes & reservas"
        name="reports"
        required
        hint="PDF, Excel (.xlsx), CSV o TSV. Puedes adjuntar varios; se reconocen por sus datos y encabezados, no por una plantilla fija."
      >
        <input
          type="file"
          name="reports"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.csv,text/csv,.tsv,text/tab-separated-values"
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
