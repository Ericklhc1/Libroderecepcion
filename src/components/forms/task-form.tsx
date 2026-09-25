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

      <Field label="Criterio de cumplimiento" name="fulfillmentCriteria">
        <Textarea
          name="fulfillmentCriteria"
          rows={2}
          placeholder="Qué debe quedar comprobado para considerarla realizada."
        />
      </Field>

      <Field label="Evidencia requerida" name="evidenceRequired">
        <Input name="evidenceRequired" placeholder="Ej: fotografía, folio, comprobante o comentario." />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Asignar a" name="targetType">
          <Select
            name="targetType"
            defaultValue="PERSONA"
            options={[
              { value: 'PERSONA', label: 'Una persona' },
              { value: 'MULTIPLES', label: 'Varias personas' },
              { value: 'TURNO', label: 'Un turno' },
              { value: 'EQUIPO', label: 'Equipo completo' },
              { value: 'PROPIO', label: 'Para mí' },
            ]}
          />
        </Field>
        <Field label="Turno objetivo" name="targetShiftId" hint="Sólo si asignas a un turno.">
          <Select name="targetShiftId" placeholder="Sin turno" options={options.activeShifts} />
        </Field>
      </div>

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

      <fieldset className="rounded-xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-petrol-900">Colaboradores</legend>
        <p className="mb-2 text-xs text-slate-500">
          Opcional. Marca a quienes colaboran; funciona igual con ratón, teclado o pantalla táctil.
        </p>
        {options.users.length === 0 ? (
          <p className="text-sm text-slate-500">No hay personal operativo disponible.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.users.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-petrol-900 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name="collaboratorIds"
                  value={option.value}
                  className="h-4 w-4 rounded border-slate-300 text-petrol-700 focus:ring-gold-500"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

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
        <SubmitButton pendingLabel="Asignando…">Asignar tarea</SubmitButton>
      </div>
    </ActionForm>
  );
}
