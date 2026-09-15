'use client';

import { HandoverLevel } from '@prisma/client';
import { Printer, Trash2 } from 'lucide-react';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { HANDOVER_LEVEL_LABEL } from '@/domain/labels';
import {
  addHandoverNoteAction,
  prepareHandoverAction,
  removeHandoverNoteAction,
} from '@/server/actions/shifts';

const LEVEL_OPTIONS = Object.values(HandoverLevel).map((level) => ({
  value: level,
  label: HANDOVER_LEVEL_LABEL[level],
}));

/** Nota manual: lo que el resumen automático no puede saber. */
export function AddHandoverNoteForm({ handoverId }: { handoverId: string }) {
  return (
    <ActionForm action={addHandoverNoteAction} resetOnSuccess hideSuccess>
      <input type="hidden" name="handoverId" value={handoverId} />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Clasificación" name="level" required>
          <Select name="level" defaultValue={HandoverLevel.IMPORTANTE} options={LEVEL_OPTIONS} />
        </Field>
        <Field label="Nota" name="title" required>
          <Input
            name="title"
            required
            minLength={3}
            maxLength={300}
            placeholder="Ej: El ascensor de servicio queda con llave en recepción"
          />
        </Field>
      </div>
      <Field label="Detalle" name="detail">
        <Textarea name="detail" rows={2} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingLabel="Agregando…">
          Agregar nota
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

/** Regenera el resumen automático conservando las notas manuales. */
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
