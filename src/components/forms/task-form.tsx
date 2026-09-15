'use client';

import { Priority } from '@prisma/client';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { PRIORITY_LABEL } from '@/domain/labels';
import type { ActionState } from '@/server/action';
import type { FormOptions } from '@/server/services/options';

const PRIORITY_OPTIONS = Object.values(Priority).map((priority) => ({
  value: priority,
  label: PRIORITY_LABEL[priority],
}));

export function TaskForm({
  action,
  options,
  entryId,
  followUpId,
  alertId,
  defaultAssigneeId,
  showOrigin = true,
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  options: FormOptions;
  entryId?: string;
  followUpId?: string;
  alertId?: string;
  defaultAssigneeId?: string;
  showOrigin?: boolean;
}) {
  return (
    <ActionForm action={action} closeOnSuccess resetOnSuccess>
      {entryId ? <input type="hidden" name="entryId" value={entryId} /> : null}
      {followUpId ? <input type="hidden" name="followUpId" value={followUpId} /> : null}
      {alertId ? <input type="hidden" name="alertId" value={alertId} /> : null}

      <Field label="Qué hay que hacer" name="title" required>
        <Input
          name="title"
          required
          maxLength={200}
          placeholder="Ej: Confirmar traslado al aeropuerto con la empresa de transporte"
        />
      </Field>

      <Field label="Detalle" name="description">
        <Textarea name="description" rows={3} placeholder="Instrucciones o contexto necesario." />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Asignada a" name="assigneeId" hint="Sólo personal operativo.">
          <Select
            name="assigneeId"
            placeholder="Sin asignar"
            defaultValue={defaultAssigneeId}
            options={options.users}
          />
        </Field>
        <Field label="Prioridad" name="priority" required>
          <Select name="priority" defaultValue={Priority.MEDIA} options={PRIORITY_OPTIONS} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha límite" name="dueAt">
          <Input type="datetime-local" name="dueAt" />
        </Field>
        <Field label="Área" name="departmentId">
          <Select name="departmentId" placeholder="Sin área" options={options.departments} />
        </Field>
      </div>

      {showOrigin && !entryId && !followUpId && !alertId ? (
        <Field
          label="Registro de origen"
          name="entryId"
          hint="Opcional: vincula la tarea al registro que la motivó."
        >
          <Select name="entryId" placeholder="Sin vínculo" options={options.openEntries} />
        </Field>
      ) : null}

      <Field
        label="Checklist"
        name="checklist"
        hint="Un paso por línea. Opcional."
      >
        <Textarea name="checklist" rows={3} placeholder={'Llamar a la empresa\nRegistrar patente\nInformar al huésped'} />
      </Field>

      <Field label="Etiquetas" name="tags" hint="Separadas por coma.">
        <Input name="tags" placeholder="traslado, vip" />
      </Field>

      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel="Creando…">Crear tarea</SubmitButton>
      </div>
    </ActionForm>
  );
}
