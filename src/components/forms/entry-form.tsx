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
 * Novedades e Incidencias pueden vincularse a una habitación del catálogo
 * operativo. Ese vínculo alimenta el monitor Novedades / habitación y no
 * representa ocupación, check-in ni estado PMS.
 */
export function EntryForm({
  action,
  options,
  defaultType = EntryType.NOVEDAD,
  lockType = false,
  closeOnSuccess = true,
  defaultRoomId = '',
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

      {!isIncident ? (
        <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-900 ring-1 ring-gold-200">
          Una garantía en efectivo recibida se registra en Caja → Nueva garantía. Usa Novedad sólo si existe un hecho operativo adicional que deba quedar informado.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Habitación"
          name="roomId"
          hint="Opcional. Sirve para agrupar la operación en Novedades / habitación."
        >
          <Select
            name="roomId"
            placeholder="Sin habitación"
            defaultValue={defaultRoomId}
            options={options.rooms}
          />
        </Field>
        <Field label="Área responsable" name="departmentId">
          <Select
            name="departmentId"
            placeholder="Sin área específica"
            options={options.departments}
          />
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
        hint="Describe qué ocurrió y qué necesita saber el siguiente turno. Si aplica una habitación, selecciónala arriba para que aparezca en su monitor."
      >
        <Textarea name="description" required rows={4} maxLength={8000} />
      </Field>

      <Field label="Categoría" name="category" hint="Opcional. Ej.: mantenimiento, caja, seguridad.">
        <Input name="category" maxLength={120} placeholder="Categoría" />
      </Field>

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
