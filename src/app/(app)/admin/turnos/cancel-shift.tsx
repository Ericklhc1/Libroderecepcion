'use client';

import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cancelShiftAction, unarchiveShiftAction } from '@/server/actions/shifts';
import { removeShiftFromOperationAction } from '@/server/actions/admin-shifts';

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
 * Retira o restaura un turno del circuito operativo.
 *
 * Para perfiles administrativos normales equivale a archivar y conserva la
 * regla de no retirar un turno en curso. El Administrador de sistema puede
 * retirar incluso un turno aún abierto; el servidor lo anula de forma segura,
 * lo saca del ciclo operativo y conserva toda la trazabilidad.
 */
export function ArchiveShiftDialog({
  shiftId,
  archived,
  systemAdmin = false,
}: {
  shiftId: string;
  archived: boolean;
  systemAdmin?: boolean;
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
      title={systemAdmin ? 'Eliminar turno de la operación' : 'Archivar turno'}
      description={
        systemAdmin
          ? 'Puedes retirar el turno aunque todavía no esté cerrado. Se elimina del circuito operativo, pero su historial, registros y auditoría se conservan.'
          : 'El turno sale de las listas de operación, pero conserva su historia, sus registros y su entrega. Los turnos en curso deben cerrarse antes.'
      }
      triggerVariant={systemAdmin ? 'danger' : 'ghost'}
      triggerSize="sm"
      width="sm"
      trigger={systemAdmin ? 'Eliminar' : 'Archivar'}
    >
      <ActionForm action={removeShiftFromOperationAction} closeOnSuccess>
        <input type="hidden" name="shiftId" value={shiftId} />
        <Field label="Motivo (opcional)" name="reason">
          <Textarea
            name="reason"
            rows={2}
            maxLength={500}
            placeholder={systemAdmin ? 'Ej.: turno abierto por error' : undefined}
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton
            variant={systemAdmin ? 'danger' : 'secondary'}
            pendingLabel={systemAdmin ? 'Eliminando…' : 'Archivando…'}
          >
            {systemAdmin ? 'Eliminar de la operación' : 'Archivar turno'}
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
