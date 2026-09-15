'use client';

import { Check, X } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { applyImportAction, discardImportAction } from '@/server/actions/rooms';

/** Los dos únicos caminos desde la revisión: aplicar o descartar. */
export function ReviewDecision({
  batchId,
  returnTo,
}: {
  batchId: string;
  /** Clave del destino al que volver tras aplicar. La traduce el servidor. */
  returnTo?: 'turno' | 'habitaciones';
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ActionForm action={applyImportAction} className="flex-1 space-y-2">
        <input type="hidden" name="batchId" value={batchId} />
        {returnTo ? <input type="hidden" name="volverA" value={returnTo} /> : null}
        <SubmitButton className="w-full" size="lg" pendingLabel="Aplicando…">
          <Check className="h-4 w-4" aria-hidden="true" />
          Aplicar al estado operativo
        </SubmitButton>
      </ActionForm>
      <ActionForm action={discardImportAction} className="sm:w-56 space-y-2">
        <input type="hidden" name="batchId" value={batchId} />
        <SubmitButton className="w-full" size="lg" variant="secondary" pendingLabel="Descartando…">
          <X className="h-4 w-4" aria-hidden="true" />
          Descartar
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
