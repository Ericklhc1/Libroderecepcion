'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  deleteChecklistTemplateAction,
  finishChecklistRunAction,
  markChecklistItemAction,
  saveChecklistTemplateAction,
  startChecklistRunAction,
} from '@/server/actions/checklists';

/**
 * Configuración y ejecución de las listas de control.
 *
 * Los puntos se escriben uno por línea, y un `*` al inicio marca el punto como
 * crítico. Es un campo de texto y no un constructor de filas a propósito: el
 * Supervisor arma la lista de una sentada, y un formulario con «agregar punto»
 * convierte cinco segundos de escritura en veinte clics.
 */
export function TemplateDialog({
  template,
}: {
  template?: {
    id: string;
    name: string;
    description: string | null;
    cadence: string | null;
    active: boolean;
    items: Array<{ text: string; critical: boolean }>;
  };
}) {
  const asText = template
    ? template.items.map((item) => (item.critical ? `*${item.text}` : item.text)).join('\n')
    : '';

  return (
    <Dialog
      trigger={template ? 'Editar' : 'Nueva lista de control'}
      triggerVariant={template ? 'ghost' : 'gold'}
      triggerSize="sm"
      title={template ? `Editar «${template.name}»` : 'Nueva lista de control'}
      description="Un punto por línea. Empieza con * los puntos críticos: si uno falla, la ronda queda marcada como crítica."
    >
      <ActionForm action={saveChecklistTemplateAction} closeOnSuccess>
        {template ? <input type="hidden" name="id" value={template.id} /> : null}
        <Field label="Nombre" name="name" required>
          <Input
            name="name"
            required
            maxLength={120}
            defaultValue={template?.name}
            placeholder="Ronda de pisos"
          />
        </Field>
        <Field label="Para qué sirve" name="description">
          <Input name="description" maxLength={300} defaultValue={template?.description ?? ''} />
        </Field>
        <Field
          label="Cuándo se recorre"
          name="cadence"
          hint="Texto libre: «cada turno», «los lunes», «antes de entregar»."
        >
          <Input name="cadence" maxLength={80} defaultValue={template?.cadence ?? ''} />
        </Field>
        <Field
          label="Puntos"
          name="items"
          required
          hint="Uno por línea. Un * al inicio lo marca como crítico."
        >
          <Textarea
            name="items"
            rows={8}
            required
            defaultValue={asText}
            placeholder={'*Extintores con carga vigente\nPasillos sin objetos\nLuces de emergencia'}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="active"
            defaultChecked={template?.active ?? true}
            className="h-4 w-4 rounded border-slate-300 text-petrol-600"
          />
          Activa (se puede recorrer)
        </label>
        <SubmitButton pendingLabel="Guardando…">
          {template ? 'Guardar cambios' : 'Crear la lista'}
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteTemplateDialog({ templateId }: { templateId: string }) {
  return (
    <Dialog
      trigger="Eliminar"
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      title="Eliminar la lista de control"
      description="Las rondas ya recorridas se conservan: guardan su propia copia de los puntos."
    >
      <ActionForm action={deleteChecklistTemplateAction} closeOnSuccess>
        <input type="hidden" name="templateId" value={templateId} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={2} required maxLength={500} />
        </Field>
        <SubmitButton variant="danger" pendingLabel="Eliminando…">
          Eliminar
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function StartRunForm({ templateId }: { templateId: string }) {
  return (
    <ActionForm action={startChecklistRunAction} className="space-y-0" hideSuccess>
      <input type="hidden" name="templateId" value={templateId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Iniciando…">
        Recorrer
      </SubmitButton>
    </ActionForm>
  );
}

/** Marca un punto de la ronda abierta. La falla pide observación. */
export function MarkItemForm({
  itemId,
  result,
  observation,
  critical,
  text,
}: {
  itemId: string;
  result: string;
  observation: string | null;
  critical: boolean;
  text: string;
}) {
  return (
    <ActionForm action={markChecklistItemAction} hideSuccess className="space-y-2">
      <input type="hidden" name="itemId" value={itemId} />
      <p className="text-sm text-petrol-900">
        {critical ? <span className="font-semibold text-red-700">Crítico · </span> : null}
        {text}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          name="result"
          defaultValue={result}
          className="w-auto"
          options={[
            { value: 'PENDIENTE', label: 'Sin revisar' },
            { value: 'OK', label: 'Conforme' },
            { value: 'FALLA', label: 'Falla' },
            { value: 'NO_APLICA', label: 'No aplica' },
          ]}
        />
        <Input
          name="observation"
          defaultValue={observation ?? ''}
          placeholder="Observación (obligatoria si falla)"
          maxLength={500}
          className="min-w-0 flex-1"
        />
        <SubmitButton variant="ghost" size="sm" pendingLabel="…">
          Guardar
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FinishRunDialog({ runId }: { runId: string }) {
  return (
    <Dialog
      trigger="Cerrar la ronda"
      triggerVariant="gold"
      triggerSize="sm"
      width="sm"
      title="Cerrar la ronda"
      description="No se puede cerrar con puntos sin revisar: una lista a medias da la impresión de haberse recorrido sin haberlo hecho."
    >
      <ActionForm action={finishChecklistRunAction} closeOnSuccess>
        <input type="hidden" name="runId" value={runId} />
        <Field label="Observaciones de la ronda" name="notes">
          <Textarea name="notes" rows={3} maxLength={1000} />
        </Field>
        <SubmitButton variant="gold" pendingLabel="Cerrando…">
          Cerrar
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
