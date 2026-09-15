'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cancelShiftAction } from '@/server/actions/shifts';

export function CancelShiftDialog({ shiftId }: { shiftId: string }) {
  return (
    <Dialog
      title="Anular turno"
      description="Sólo se pueden anular turnos que aún no han iniciado. El turno queda fuera del ciclo de entregas."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Anular"
    >
      <ActionForm action={cancelShiftAction} closeOnSuccess>
        <input type="hidden" name="shiftId" value={shiftId} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={3} required minLength={5} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Anulando…">
            Anular turno
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
