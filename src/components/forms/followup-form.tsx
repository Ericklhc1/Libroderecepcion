'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import type { ActionState } from '@/server/action';
import type { FormOptions } from '@/server/services/options';

/**
 * Seguimiento: qué se hizo, qué resultó y qué viene después.
 * Si llega la fecha programada y sigue abierto, el motor de alertas avisa.
 */
export function FollowUpForm({
  action,
  options,
  entryId,
  taskId,
  defaultOwnerId,
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  options: FormOptions;
  entryId?: string;
  taskId?: string;
  defaultOwnerId?: string;
}) {
  const linked = Boolean(entryId || taskId);
  return (
    <ActionForm action={action} closeOnSuccess resetOnSuccess>
      {entryId ? <input type="hidden" name="entryId" value={entryId} /> : null}
      {taskId ? <input type="hidden" name="taskId" value={taskId} /> : null}

      {linked ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Registro asociado"
            name="entryId"
            hint="Un seguimiento siempre cuelga de un registro o de una tarea."
          >
            <Select name="entryId" placeholder="Ninguno" options={options.openEntries} />
          </Field>
          <Field label="Tarea asociada" name="taskId">
            <Select name="taskId" placeholder="Ninguna" options={options.openTasks} />
          </Field>
        </div>
      )}

      <Field label="Acción realizada" name="action" required>
        <Input
          name="action"
          required
          maxLength={300}
          placeholder="Ej: Se contactó al huésped para regularizar el medio de pago"
        />
      </Field>

      <Field label="Resultado" name="result">
        <Textarea name="result" rows={2} placeholder="Qué respondió o qué se logró." />
      </Field>

      <Field label="Próxima acción" name="nextAction">
        <Input name="nextAction" maxLength={300} placeholder="Ej: Reintentar contacto y escalar a Administración" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Fecha programada"
          name="scheduledAt"
          hint="Si llega y sigue abierto, se genera alerta."
        >
          <Input type="datetime-local" name="scheduledAt" />
        </Field>
        <Field label="Responsable" name="ownerId">
          <Select
            name="ownerId"
            placeholder="Yo"
            defaultValue={defaultOwnerId}
            options={options.users}
          />
        </Field>
      </div>

      <Field label="Notas" name="notes">
        <Textarea name="notes" rows={2} />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Guardando…">Registrar seguimiento</SubmitButton>
      </div>
    </ActionForm>
  );
}
