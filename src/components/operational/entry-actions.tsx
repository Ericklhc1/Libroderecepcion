'use client';

import { EntryStatus, EntryType } from '@prisma/client';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ENTRY_STATUS_LABEL } from '@/domain/labels';
import {
  changeEntryStatusAction,
  deleteEntryAction,
  restoreEntryAction,
  updateEntryAction,
} from '@/server/actions/entries';
import { updateFollowUpAction } from '@/server/actions/followups';

const STATUS_OPTIONS = Object.values(EntryStatus).map((status) => ({
  value: status,
  label: ENTRY_STATUS_LABEL[status],
}));

/**
 * Cambio de estado. Para cerrar una incidencia el servidor exige resolución,
 * por eso el formulario la pide en el mismo paso.
 */
export function EntryStatusForm({
  entryId,
  currentStatus,
  type,
  resolution,
  rootCause,
}: {
  entryId: string;
  currentStatus: EntryStatus;
  type: EntryType;
  resolution: string | null;
  rootCause: string | null;
}) {
  const isIncident = type === EntryType.INCIDENCIA;
  return (
    <ActionForm action={changeEntryStatusAction}>
      <input type="hidden" name="id" value={entryId} />
      <Field label="Estado" name="status" required>
        <Select name="status" defaultValue={currentStatus} options={STATUS_OPTIONS} />
      </Field>
      {isIncident ? (
        <>
          <Field
            label="Causa"
            name="rootCause"
            hint="Por qué ocurrió. Ayuda a evitar que se repita."
          >
            <Textarea name="rootCause" rows={2} defaultValue={rootCause ?? ''} />
          </Field>
          <Field
            label="Resolución"
            name="resolution"
            hint="Obligatoria para cerrar una incidencia."
          >
            <Textarea name="resolution" rows={2} defaultValue={resolution ?? ''} />
          </Field>
        </>
      ) : null}
      <Field label="Motivo del cambio" name="reason" hint="Queda en la auditoría.">
        <Input name="reason" placeholder="Opcional" />
      </Field>
      <SubmitButton pendingLabel="Actualizando…">Actualizar estado</SubmitButton>
    </ActionForm>
  );
}

export function DeleteEntryDialog({ entryId, label }: { entryId: string; label: string }) {
  return (
    <Dialog
      title="Eliminar registro"
      description="La eliminación es lógica: el registro deja de verse en la operación, pero se conserva y puede restaurarse."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger={label}
    >
      <ActionForm action={deleteEntryAction} closeOnSuccess>
        <input type="hidden" name="id" value={entryId} />
        <Field
          label="Motivo de la eliminación"
          name="reason"
          required
          hint="Queda registrado en la auditoría junto a tu nombre."
        >
          <Textarea name="reason" rows={3} required minLength={5} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Eliminando…">
            Eliminar registro
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function RestoreEntryForm({ entryId }: { entryId: string }) {
  return (
    <ActionForm action={restoreEntryAction} className="space-y-0">
      <input type="hidden" name="id" value={entryId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">
        Restaurar registro
      </SubmitButton>
    </ActionForm>
  );
}

/** Edición breve en modal: los campos que más cambian en la operación. */
export function EditEntryDialog({
  entry,
  departments,
  users,
}: {
  entry: {
    id: string;
    title: string;
    description: string;
    dueAt: string;
    departmentId: string | null;
    ownerId: string | null;
    priority: string;
    tags: string[];
  };
  departments: Array<{ value: string; label: string }>;
  users: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog
      title="Editar registro"
      triggerVariant="secondary"
      triggerSize="sm"
      trigger="Editar"
    >
      <ActionForm action={updateEntryAction} closeOnSuccess>
        <input type="hidden" name="id" value={entry.id} />
        <Field label="Título" name="title" required>
          <Input name="title" defaultValue={entry.title} required maxLength={200} />
        </Field>
        <Field label="Descripción" name="description" required>
          <Textarea name="description" rows={4} defaultValue={entry.description} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridad" name="priority">
            <Select
              name="priority"
              defaultValue={entry.priority}
              options={[
                { value: 'BAJA', label: 'Baja' },
                { value: 'MEDIA', label: 'Media' },
                { value: 'ALTA', label: 'Alta' },
                { value: 'CRITICA', label: 'Crítica' },
              ]}
            />
          </Field>
          <Field label="Vencimiento" name="dueAt">
            <Input type="datetime-local" name="dueAt" defaultValue={entry.dueAt} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Área" name="departmentId">
            <Select
              name="departmentId"
              placeholder="Sin área"
              defaultValue={entry.departmentId ?? ''}
              options={departments}
            />
          </Field>
          <Field label="Responsable" name="ownerId">
            <Select
              name="ownerId"
              placeholder="Sin responsable"
              defaultValue={entry.ownerId ?? ''}
              options={users}
            />
          </Field>
        </div>
        <Field label="Etiquetas" name="tags" hint="Separadas por coma.">
          <Input name="tags" defaultValue={entry.tags.join(', ')} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Cierre de un seguimiento con su resultado. */
export function CloseFollowUpDialog({ followUpId }: { followUpId: string }) {
  return (
    <Dialog
      title="Cerrar seguimiento"
      description="Registra el resultado: es obligatorio para poder cerrarlo."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Cerrar seguimiento"
    >
      <ActionForm action={updateFollowUpAction} closeOnSuccess>
        <input type="hidden" name="id" value={followUpId} />
        <input type="hidden" name="status" value="CUMPLIDO" />
        <Field label="Resultado" name="result" required>
          <Textarea name="result" rows={3} required />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Cerrando…">Cerrar seguimiento</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
