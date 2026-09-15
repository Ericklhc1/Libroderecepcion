'use client';

import { useState } from 'react';
import { EntryType, Impact, Priority, Severity } from '@prisma/client';
import { ActionForm, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { ENTRY_TYPE_LABEL, IMPACT_LABEL, PRIORITY_LABEL, SEVERITY_LABEL } from '@/domain/labels';
import type { ActionState } from '@/server/action';
import type { FormOptions } from '@/server/services/options';

const TYPE_OPTIONS = Object.values(EntryType).map((type) => ({
  value: type,
  label: ENTRY_TYPE_LABEL[type],
}));

const PRIORITY_OPTIONS = Object.values(Priority).map((priority) => ({
  value: priority,
  label: PRIORITY_LABEL[priority],
}));

const SEVERITY_OPTIONS = Object.values(Severity).map((severity) => ({
  value: severity,
  label: SEVERITY_LABEL[severity],
}));

const IMPACT_OPTIONS = Object.values(Impact).map((impact) => ({
  value: impact,
  label: IMPACT_LABEL[impact],
}));

/**
 * Formulario único para novedades e incidencias.
 *
 * Al elegir "Incidencia" aparecen los campos adicionales (gravedad, impacto y
 * acción inmediata): un solo formulario breve que se adapta, en lugar de dos
 * módulos separados.
 */
export function EntryForm({
  action,
  options,
  defaultType = EntryType.NOVEDAD,
  lockType = false,
  closeOnSuccess = true,
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  options: FormOptions;
  defaultType?: EntryType;
  lockType?: boolean;
  closeOnSuccess?: boolean;
}) {
  const [type, setType] = useState<EntryType>(defaultType);
  const isIncident = type === EntryType.INCIDENCIA;

  return (
    <ActionForm action={action} closeOnSuccess={closeOnSuccess} resetOnSuccess>
      {lockType ? <input type="hidden" name="type" value={type} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {lockType ? null : (
          <Field label="Tipo de registro" name="type" required>
            <Select
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as EntryType)}
              options={TYPE_OPTIONS}
            />
          </Field>
        )}
        <Field label="Prioridad" name="priority" required>
          <Select name="priority" defaultValue={Priority.MEDIA} options={PRIORITY_OPTIONS} />
        </Field>
      </div>

      <Field label="Título" name="title" required hint="Qué pasó, en una línea.">
        <Input name="title" required maxLength={200} placeholder="Ej: Aire acondicionado sin enfriar en habitación 318" />
      </Field>

      <Field label="Descripción" name="description" required>
        <Textarea
          name="description"
          required
          rows={4}
          placeholder="Detalle de lo ocurrido, qué se hizo y qué queda pendiente."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Área" name="departmentId">
          <Select name="departmentId" placeholder="Sin área" options={options.departments} />
        </Field>
        <Field label="Responsable" name="ownerId" hint="Opcional. Sólo personal operativo.">
          <Select name="ownerId" placeholder="Sin responsable" options={options.users} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Huésped relacionado" name="guestId">
          <Select name="guestId" placeholder="Ninguno" options={options.guests} />
        </Field>
        <Field label="Reserva relacionada" name="reservationId">
          <Select name="reservationId" placeholder="Ninguna" options={options.reservations} />
        </Field>
      </div>

      {isIncident ? (
        <div className="space-y-4 rounded-lg bg-red-50/60 p-3 ring-1 ring-red-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800">
            Datos de la incidencia
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Gravedad" name="severity" required>
              <Select
                name="severity"
                defaultValue={Severity.MEDIA}
                options={SEVERITY_OPTIONS}
              />
            </Field>
            <Field label="Impacto" name="impact">
              <Select name="impact" defaultValue={Impact.OPERACION} options={IMPACT_OPTIONS} />
            </Field>
          </div>
          <Field
            label="Acción inmediata"
            name="immediateAction"
            hint="Qué se hizo en el momento para contener la situación."
          >
            <Textarea name="immediateAction" rows={2} />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha del hecho" name="occurredAt" hint="Por defecto, ahora.">
          <Input type="datetime-local" name="occurredAt" />
        </Field>
        <Field label="Vencimiento" name="dueAt" hint="Opcional: cuándo debe quedar resuelto.">
          <Input type="datetime-local" name="dueAt" />
        </Field>
      </div>

      <Field label="Etiquetas" name="tags" hint="Separadas por coma. Ej: climatizacion, vip">
        <Input name="tags" placeholder="climatizacion, vip" />
      </Field>

      <Checkbox
        name="requiresFollowUp"
        label="Requiere seguimiento"
        hint="Marca esto si el asunto no queda cerrado en este turno."
      />

      <div className="flex justify-end gap-2 pt-1">
        <SubmitButton pendingLabel="Guardando…">Guardar registro</SubmitButton>
      </div>
    </ActionForm>
  );
}
