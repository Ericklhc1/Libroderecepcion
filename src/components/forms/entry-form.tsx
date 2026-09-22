'use client';

import { useState } from 'react';
import { EntryType, Impact, Priority, Severity } from '@prisma/client';
import { ActionForm, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { IMPACT_LABEL, PRIORITY_LABEL, SEVERITY_LABEL } from '@/domain/labels';
import type { ActionState } from '@/server/action';
import type { FormOptions } from '@/server/services/options';

const TYPE_OPTIONS = [
  { value: EntryType.NOVEDAD, label: 'Novedad' },
  { value: EntryType.INCIDENCIA, label: 'Incidencia' },
];

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
 * Formulario canónico del Libro desde v1.4.0.
 *
 * Novedades e Incidencias describen la operación directamente. No consultan
 * habitaciones, huéspedes, reservas ni estadías del PMS. Si una habitación es
 * relevante, se escribe en el título/descripcion o en la categoría.
 *
 * defaultRoomId y defaultStayId se aceptan sólo para compatibilidad de páginas
 * antiguas todavía compilables; se ignoran deliberadamente.
 */
export function EntryForm({
  action,
  options,
  defaultType = EntryType.NOVEDAD,
  lockType = false,
  closeOnSuccess = true,
  defaultRoomId: _defaultRoomId = '',
  defaultStayId: _defaultStayId = '',
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  options: FormOptions;
  defaultType?: EntryType;
  lockType?: boolean;
  closeOnSuccess?: boolean;
  defaultRoomId?: string;
  defaultStayId?: string;
}) {
  const initial =
    defaultType === EntryType.INCIDENCIA ? EntryType.INCIDENCIA : EntryType.NOVEDAD;
  const [type, setType] = useState<EntryType>(initial);
  const isIncident = type === EntryType.INCIDENCIA;

  return (
    <ActionForm action={action} closeOnSuccess={closeOnSuccess} resetOnSuccess>
      {lockType ? <input type="hidden" name="type" value={type} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {lockType ? null : (
          <Field label="Tipo" name="type" required>
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

      <Field label="Título" name="title" required>
        <Input
          name="title"
          required
          maxLength={200}
          placeholder={isIncident ? 'Ej.: Filtración en habitación 512' : 'Ej.: Proveedor llegará a las 16:00'}
        />
      </Field>

      <Field
        label="Descripción"
        name="description"
        required
        hint="Describe qué ocurrió y qué necesita saber el siguiente turno. Habitación, huésped o referencia pueden escribirse aquí cuando aporten contexto."
      >
        <Textarea name="description" required rows={4} maxLength={8000} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría" name="category" hint="Opcional. Ej.: mantenimiento, caja, seguridad.">
          <Input name="category" maxLength={120} placeholder="Categoría" />
        </Field>

        <Field label="Área responsable" name="departmentId">
          <Select
            name="departmentId"
            placeholder="Sin área específica"
            options={options.departments}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Responsable" name="ownerId">
          <Select name="ownerId" placeholder="Sin responsable individual" options={options.users} />
        </Field>

        <Field label="Fecha límite" name="dueAt">
          <Input name="dueAt" type="datetime-local" />
        </Field>
      </div>

      {isIncident ? (
        <div className="grid gap-4 rounded-xl bg-red-50/60 p-3 ring-1 ring-red-100 sm:grid-cols-2">
          <Field label="Gravedad" name="severity" required>
            <Select name="severity" options={SEVERITY_OPTIONS} defaultValue={Severity.MEDIA} />
          </Field>
          <Field label="Impacto" name="impact">
            <Select name="impact" options={IMPACT_OPTIONS} placeholder="Sin clasificar" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Acción inmediata" name="immediateAction">
              <Textarea
                name="immediateAction"
                rows={2}
                placeholder="Qué se hizo de inmediato, si aplica."
              />
            </Field>
          </div>
        </div>
      ) : null}

      <Field label="Etiquetas" name="tags" hint="Opcional. Separa con comas.">
        <Input name="tags" placeholder="turno-noche, mantenimiento" />
      </Field>

      <Checkbox
        name="requiresFollowUp"
        label="Requiere seguimiento"
        hint="Mantener visible hasta que alguien registre el resultado o próximo paso."
      />

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Registrando…">
          {isIncident ? 'Registrar incidencia' : 'Registrar novedad'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
