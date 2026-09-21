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
import type { Option } from '@/server/services/options';

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
    category?: string;
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
        <Field label="Tipo de control" name="category">
          <Select
            name="category"
            defaultValue={template?.category ?? 'OTRO'}
            options={[
              { value: 'CAJA_MOVIMIENTOS', label: 'Caja y movimientos' },
              { value: 'GARANTIAS', label: 'Garantías' },
              { value: 'LLAVES', label: 'Llaves' },
              { value: 'RESERVAS', label: 'Reservas' },
              { value: 'HABITACIONES', label: 'Habitaciones' },
              { value: 'CALIDAD_REGISTROS', label: 'Calidad de registros' },
              { value: 'ENTREGA_CIERRE_TURNO', label: 'Entrega y cierre de turno' },
              { value: 'CUMPLIMIENTO_PROCEDIMIENTOS', label: 'Cumplimiento de procedimientos' },
              { value: 'OTRO', label: 'Otro control' },
            ]}
          />
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

export function StartAuditDialog({
  templateId,
  templateName,
  users,
  shifts,
  departments,
}: {
  templateId: string;
  templateName: string;
  users: Option[];
  shifts: Option[];
  departments: Option[];
}) {
  return (
    <Dialog
      trigger="Iniciar auditoría"
      triggerVariant="secondary"
      triggerSize="sm"
      width="lg"
      title={`Preparar «${templateName}»`}
      description="La preparación es reservada y no envía avisos a las personas revisadas."
    >
      <ActionForm action={startChecklistRunAction} closeOnSuccess>
        <input type="hidden" name="templateId" value={templateId} />
        <Field label="Alcance" name="scope" required>
          <Textarea
            name="scope"
            rows={3}
            required
            maxLength={1000}
            placeholder="Qué proceso, área o periodo se revisará."
          />
        </Field>
        <Field label="Muestra seleccionada" name="sample" required>
          <Textarea
            name="sample"
            rows={2}
            required
            maxLength={1000}
            placeholder="Ej: 10 movimientos escogidos al azar entre las 08:00 y las 14:00."
          />
        </Field>
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-petrol-700">
            Personas, turnos y áreas revisadas
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Personas" name="participantIds">
              <select name="participantIds" multiple size={5} className="input-base w-full">
                {users.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Turnos" name="reviewedShiftIds">
              <select name="reviewedShiftIds" multiple size={5} className="input-base w-full">
                {shifts.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Áreas" name="reviewedDepartmentIds">
              <select name="reviewedDepartmentIds" multiple size={5} className="input-base w-full">
                {departments.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </details>
        <SubmitButton variant="gold" pendingLabel="Preparando…">
          Iniciar sin avisar al equipo
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Marca un punto de la ronda abierta. La falla pide observación. */
export function MarkItemForm({
  itemId,
  result,
  observation,
  evidence,
  critical,
  text,
}: {
  itemId: string;
  result: string;
  observation: string | null;
  evidence?: string | null;
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
            { value: 'CUMPLE', label: 'Cumple' },
            { value: 'OBSERVACION', label: 'Observación' },
            { value: 'INCUMPLIMIENTO', label: 'Incumplimiento' },
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
        <Input
          name="evidence"
          defaultValue={evidence ?? ''}
          placeholder="Evidencia o referencia"
          maxLength={1000}
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
      trigger="Cerrar la auditoría"
      triggerVariant="gold"
      triggerSize="sm"
      width="sm"
      title="Cerrar la auditoría"
      description="No se puede cerrar con puntos sin revisar: una lista a medias da la impresión de haberse recorrido sin haberlo hecho."
    >
      <ActionForm action={finishChecklistRunAction} closeOnSuccess>
        <input type="hidden" name="runId" value={runId} />
        <Field label="Observaciones de la ronda" name="notes">
          <Textarea name="notes" rows={3} maxLength={1000} />
        </Field>
        <Field label="Resultado objetivo" name="resultSummary">
          <Textarea name="resultSummary" rows={3} maxLength={2000} />
        </Field>
        <Field label="Comunicación de resultados" name="disclosure">
          <Select
            name="disclosure"
            defaultValue="RESERVADO"
            options={[
              { value: 'RESERVADO', label: 'Reservado' },
              { value: 'PERSONA', label: 'Comunicar a una persona' },
              { value: 'SUPERVISION', label: 'Compartir con Supervisión' },
              { value: 'OPERATIVO', label: 'Compartir como resultado operativo' },
            ]}
          />
        </Field>
        <SubmitButton variant="gold" pendingLabel="Cerrando…">
          Cerrar
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
