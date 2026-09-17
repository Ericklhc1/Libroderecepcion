'use client';

import { Check, X } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import {
  applyGuestReservationImportAction,
  discardGuestReservationImportAction,
} from '@/server/actions/guest-reservation-imports';

export function GuestReservationReviewActions({
  batchId,
  returnTo,
}: {
  batchId: string;
  returnTo?: 'turno';
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ActionForm action={applyGuestReservationImportAction} className="flex-1 space-y-2">
        <input type="hidden" name="batchId" value={batchId} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        <SubmitButton className="w-full" size="lg" pendingLabel="Aplicando…">
          <Check className="h-4 w-4" aria-hidden="true" />
          Aplicar a huéspedes & reservas
        </SubmitButton>
      </ActionForm>
      <ActionForm action={discardGuestReservationImportAction} className="sm:w-56 space-y-2">
        <input type="hidden" name="batchId" value={batchId} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        <SubmitButton className="w-full" size="lg" variant="secondary" pendingLabel="Descartando…">
          <X className="h-4 w-4" aria-hidden="true" />
          Descartar
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
