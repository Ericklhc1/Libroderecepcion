'use client';

import { Printer, Trash2 } from 'lucide-react';
import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import {
  prepareHandoverAction,
  removeHandoverNoteAction,
} from '@/server/actions/shifts';
import { saveSingleHandoverNoteAction } from '@/server/actions/handover-note';

/** Una sola nota operativa para el turno siguiente. Volver a guardar reemplaza la anterior. */
export function AddHandoverNoteForm({ handoverId }: { handoverId: string }) {
  return (
    <ActionForm action={saveSingleHandoverNoteAction} resetOnSuccess hideSuccess>
      <input type="hidden" name="handoverId" value={handoverId} />
      <Field label="Observación" name="observation" required>
        <Textarea
          name="observation"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          placeholder="Qué debe saber el turno entrante."
        />
      </Field>
      <Field label="Siguiente acción (turno entrante)" name="nextAction">
        <Textarea
          name="nextAction"
          rows={2}
          maxLength={500}
          placeholder="Qué debe hacer después, si corresponde."
        />
      </Field>
      <p className="text-xs text-slate-500">
        Sólo existe una nota manual por entrega. Guardarla nuevamente reemplaza la anterior.
      </p>
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingLabel="Guardando…">
          Guardar nota para el turno siguiente
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RemoveHandoverNoteForm({ itemId }: { itemId: string }) {
  return (
    <ActionForm action={removeHandoverNoteAction} hideSuccess className="space-y-0">
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="Quitando…"
        aria-label="Quitar nota manual"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Quitar
      </SubmitButton>
    </ActionForm>
  );
}

/** Regenera el resumen automático conservando la nota manual. */
export function RegenerateSummaryForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={prepareHandoverAction} hideSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Actualizando…">
        Actualizar resumen automático
      </SubmitButton>
    </ActionForm>
  );
}

export function PrintButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => window.print()}
      className="no-print"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Imprimir
    </Button>
  );
}
