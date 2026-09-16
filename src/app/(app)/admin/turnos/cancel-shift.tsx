'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  archiveShiftAction,
  cancelShiftAction,
  unarchiveShiftAction,
} from '@/server/actions/shifts';

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

/**
 * Archivar o desarchivar un turno.
 *
 * Archivar lo saca de las listas sin borrarlo, y es lo contrario de anular:
 * anular vale antes de empezar, archivar vale cuando ya terminó. El motivo es
 * opcional porque archivar no destruye nada.
 */
export function ArchiveShiftDialog({
  shiftId,
  archived,
}: {
  shiftId: string;
  archived: boolean;
}) {
  if (archived) {
    return (
      <ActionForm action={unarchiveShiftAction} className="space-y-0">
        <input type="hidden" name="shiftId" value={shiftId} />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Restaurando…">
          Desarchivar
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <Dialog
      title="Archivar turno"
      description="El turno sale de las listas de programación y deja de ofrecerse, pero conserva su historia, sus registros y su entrega. Se puede desarchivar."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger="Archivar"
    >
      <ActionForm action={archiveShiftAction} closeOnSuccess>
        <input type="hidden" name="shiftId" value={shiftId} />
        <Field label="Motivo (opcional)" name="reason">
          <Textarea name="reason" rows={2} maxLength={500} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="secondary" pendingLabel="Archivando…">
            Archivar turno
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
