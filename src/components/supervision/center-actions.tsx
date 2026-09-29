'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  addPerformanceObservationAction,
  changeCorrectiveMeasureStatusAction,
  createCorrectiveMeasureAction,
  createSupervisionNoteAction,
  deleteSupervisionNoteAction,
  deliverSupervisionShiftAction,
  finishSupervisionShiftAction,
  followSupervisionSourceAction,
  receiveSupervisionHandoverAction,
  startSupervisionShiftAction,
} from '@/server/actions/supervision-center';
import { updateFollowUpAction } from '@/server/actions/followups';

export function StartSupervisionShiftDialog() {
  return (
    <Dialog
      title="Comenzar apertura de Supervisión"
      description="Antes de activar tu turno revisarás el estado recibido, Caja, garantías, llaves e informes PMS. Las prioridades se construirán desde pendientes reales, no desde un bloc de notas."
      trigger="Iniciar turno"
      triggerVariant="gold"
      width="sm"
    >
      <ActionForm action={startSupervisionShiftAction} closeOnSuccess refreshOnSuccess>
        <div className="space-y-3">
          <div className="rounded-lg bg-petrol-50 px-3 py-3 text-sm text-petrol-900 ring-1 ring-petrol-100">
            El turno quedará en <strong>preparación</strong> hasta completar la recepción operacional. No se considerará iniciado por abrir este formulario.
          </div>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Preparando apertura…">COMENZAR APERTURA</SubmitButton>
          </div>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function DeliverSupervisionShiftDialog({ shiftId }: { shiftId: string }) {
  return (
    <Dialog
      title="Entregar turno de Supervisión"
      description="Se guardará una copia inalterable de tareas, seguimientos, decisiones, auditorías y medidas."
      trigger="Entregar"
      triggerVariant="gold"
    >
      <ActionForm action={deliverSupervisionShiftAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="shiftId" value={shiftId} />
        <Field label="Nota de entrega" name="note">
          <Textarea name="note" rows={4} placeholder="Contexto que necesita el siguiente supervisor." />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Generando entrega…">Generar entrega</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function FinishSupervisionShiftForm({
  shiftId,
  criticalCount,
  continuityCount,
  auditPendingCount,
}: {
  shiftId: string;
  criticalCount: number;
  continuityCount: number;
  auditPendingCount: number;
}) {
  return (
    <Dialog
      title="Finalizar turno de Supervisión"
      description="Antes de cerrar, confirma que revisaste las tres fuentes que pueden dejar trabajo sin dueño. Los pendientes continúan al próximo turno; no se borran."
      trigger="FINALIZAR TURNO"
      triggerVariant="gold"
      width="sm"
    >
      <ActionForm action={finishSupervisionShiftAction} closeOnSuccess refreshOnSuccess className="space-y-3">
        <input type="hidden" name="shiftId" value={shiftId} />

        <label className="flex items-start gap-3 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-950 ring-1 ring-red-200">
          <input type="checkbox" name="reviewedCritical" required className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Revisé las señales críticas y cierres que requieren atención
            {criticalCount > 0 ? ` (${criticalCount} visibles ahora)` : ''}.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
          <input type="checkbox" name="reviewedAudit" required className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Revisé la auditoría diaria y sus controles incompletos o inciertos
            {auditPendingCount > 0 ? ` (${auditPendingCount} punto(s) pendientes)` : ''}.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
          <input type="checkbox" name="reviewedContinuity" required className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Revisé tareas, delegaciones y seguimientos que continuarán después de mi jornada
            {continuityCount > 0 ? ` (${continuityCount} abiertos)` : ''}.
          </span>
        </label>

        <p className="text-xs text-slate-500">
          Finalizar genera automáticamente la copia inalterable del turno. Los asuntos abiertos
          reaparecerán en tu continuidad cuando vuelvas a iniciar Supervisión.
        </p>

        <div className="flex justify-end">
          <SubmitButton variant="gold" pendingLabel="Finalizando…">
            CONFIRMAR Y FINALIZAR
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function ReceiveSupervisionHandoverForm({ handoverId }: { handoverId: string }) {
  return (
    <ActionForm action={receiveSupervisionHandoverAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="handoverId" value={handoverId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Recibiendo…">
        Confirmar recepción
      </SubmitButton>
    </ActionForm>
  );
}

export function FollowSupervisionSourceForm({
  sourceEntity,
  sourceId,
}: {
  sourceEntity: string;
  sourceId: string;
}) {
  return (
    <ActionForm action={followSupervisionSourceAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="sourceEntity" value={sourceEntity} />
      <input type="hidden" name="sourceId" value={sourceId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Siguiendo…">
        Seguir
      </SubmitButton>
    </ActionForm>
  );
}

export function StopFollowingSupervisionForm({ followUpId }: { followUpId: string }) {
  return (
    <ActionForm action={updateFollowUpAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="id" value={followUpId} />
      <input type="hidden" name="status" value="CANCELADO" />
      <input type="hidden" name="resolution" value="Supervisión decidió dejar de seguir esta fuente." />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Dejando de seguir…">
        Dejar de seguir
      </SubmitButton>
    </ActionForm>
  );
}

export function NewSupervisionNoteDialog() {
  return (
    <Dialog title="Nueva nota" trigger="Nueva nota" triggerVariant="secondary" width="sm">
      <ActionForm action={createSupervisionNoteAction} closeOnSuccess refreshOnSuccess>
        <Field label="Título" name="title" required>
          <Input name="title" required maxLength={160} />
        </Field>
        <Field label="Contenido" name="body" required>
          <Textarea name="body" required rows={5} />
        </Field>
        <Field label="Visibilidad" name="visibility" required>
          <Select
            name="visibility"
            defaultValue="PRIVADO"
            options={[
              { value: 'PRIVADO', label: 'Privado · sólo yo' },
              { value: 'SUPERVISION', label: 'Supervisión · para relevos' },
              { value: 'OPERATIVO', label: 'Operativo · visible al convertir en instrucción' },
            ]}
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar nota</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function DeleteSupervisionNoteDialog({ noteId }: { noteId: string }) {
  return (
    <Dialog
      title="Eliminar nota"
      description="La nota quedará fuera del Centro, pero podrá restaurarse desde Administración."
      trigger="Eliminar"
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
    >
      <ActionForm action={deleteSupervisionNoteAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="id" value={noteId} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={3} required maxLength={500} />
        </Field>
        <SubmitButton variant="danger" pendingLabel="Eliminando…">Eliminar lógicamente</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function CorrectiveMeasureDialog({
  findingId,
  findingTitle,
  users,
}: {
  findingId: string;
  findingTitle: string;
  users: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog title="Crear medida correctiva" trigger="Crear medida" triggerVariant="secondary" triggerSize="sm">
      <ActionForm action={createCorrectiveMeasureAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="findingId" value={findingId} />
        <Field label="Título" name="title" required>
          <Input name="title" required defaultValue={`Corregir: ${findingTitle}`} />
        </Field>
        <Field label="Acción correctiva" name="action" required>
          <Textarea name="action" required rows={4} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsable" name="assigneeId" required>
            <Select name="assigneeId" options={users} placeholder="Seleccionar" />
          </Field>
          <Field label="Vencimiento" name="dueAt">
            <Input type="datetime-local" name="dueAt" />
          </Field>
        </div>
        <Field label="Evidencia requerida" name="evidenceRequired">
          <Input name="evidenceRequired" placeholder="Qué prueba permitirá validar la corrección." />
        </Field>
        <div className="flex justify-end"><SubmitButton pendingLabel="Creando…">Crear medida y tarea</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ValidateCorrectiveMeasureDialog({ measureId }: { measureId: string }) {
  return (
    <Dialog title="Validar medida correctiva" trigger="Validar" triggerVariant="gold" triggerSize="sm" width="sm">
      <ActionForm action={changeCorrectiveMeasureStatusAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="id" value={measureId} />
        <input type="hidden" name="status" value="VALIDADA" />
        <Field label="Evidencia revisada" name="evidence" required>
          <Textarea name="evidence" required rows={3} />
        </Field>
        <div className="flex justify-end"><SubmitButton pendingLabel="Validando…">Validar cierre</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function PerformanceObservationDialog({
  subjectId,
  subjectName,
  periodStart,
  periodEnd,
}: {
  subjectId: string;
  subjectName: string;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <Dialog title={`Observación para ${subjectName}`} trigger="Añadir observación" triggerVariant="secondary" triggerSize="sm">
      <ActionForm action={addPerformanceObservationAction} closeOnSuccess refreshOnSuccess>
        <input type="hidden" name="subjectId" value={subjectId} />
        <input type="hidden" name="periodStart" value={periodStart} />
        <input type="hidden" name="periodEnd" value={periodEnd} />
        <Field label="Tipo" name="kind">
          <Select
            name="kind"
            defaultValue="OBSERVACION_SUPERVISOR"
            options={[
              { value: 'OBSERVACION_SUPERVISOR', label: 'Observación del Supervisor' },
              { value: 'EXPLICACION_TRABAJADOR', label: 'Explicación del trabajador' },
              { value: 'CORRECCION_POSTERIOR', label: 'Corrección posterior' },
            ]}
          />
        </Field>
        <Field label="Contenido" name="content" required>
          <Textarea name="content" required rows={5} />
        </Field>
        <div className="flex justify-end"><SubmitButton pendingLabel="Guardando…">Guardar observación</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
