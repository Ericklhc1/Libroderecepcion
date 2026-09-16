'use client';

import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { assignTaskAction } from '@/server/actions/tasks';
import { updateEntryAction } from '@/server/actions/entries';

type Option = { value: string; label: string };

/**
 * Asigna un responsable sin salir del tablero.
 *
 * Reutiliza las acciones que ya existen —`assignTaskAction` y
 * `updateEntryAction`— en lugar de crear una tercera: si hubiera una acción
 * propia del tablero, las reglas de asignación vivirían en dos sitios y
 * acabarían divergiendo.
 */
export function AssignDialog({
  kind,
  id,
  title,
  people,
}: {
  kind: 'task' | 'entry';
  id: string;
  title: string;
  people: Option[];
}) {
  return (
    <Dialog
      trigger="Asignar"
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      title="Asignar responsable"
      description={title}
    >
      {kind === 'task' ? (
        <ActionForm action={assignTaskAction} closeOnSuccess>
          <input type="hidden" name="id" value={id} />
          <Field label="Responsable" name="assigneeId" required>
            <Select name="assigneeId" required options={people} placeholder="Elige a quién" />
          </Field>
          <Field label="Motivo" name="reason" hint="Queda en el historial de la tarea.">
            <Textarea name="reason" rows={2} maxLength={500} />
          </Field>
          <SubmitButton pendingLabel="Asignando…">Asignar</SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={updateEntryAction} closeOnSuccess>
          <input type="hidden" name="id" value={id} />
          <Field label="Responsable" name="ownerId" required>
            <Select name="ownerId" required options={people} placeholder="Elige a quién" />
          </Field>
          <SubmitButton pendingLabel="Asignando…">Asignar</SubmitButton>
        </ActionForm>
      )}
    </Dialog>
  );
}
