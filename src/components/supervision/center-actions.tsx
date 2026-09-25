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
      title="Iniciar turno de Supervisión"
      description="Tu turno marca cuándo ejerces Supervisión. Tus seguimientos y pendientes continúan aunque cierres la jornada."
      trigger="Iniciar turno"
      triggerVariant="gold"
    >
      <ActionForm action={startSupervisionShiftAction} closeOnSuccess refreshOnSuccess>
        <Field
          label="Prioridades del turno"
          name="priorities"
          hint="Una prioridad por línea. Puedes ajustarlas mediante los asuntos que registres."
        >
          <Textarea
            name="priorities"
            rows={5}
            placeholder={'Validar cierres pendientes\nRevisar caja del turno diurno\nCerrar seguimiento de mantenimiento'}
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Iniciando…">Iniciar turno</SubmitButton>
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

export function FinishSupervisionShiftForm({ shiftId }: { shiftId: string }) {
  return (
    <ActionForm action={finishSupervisionShiftAction} hideSuccess refreshOnSuccess className="space-y-0">
      <input type="hidden" name="shiftId" value={shiftId} />
      <SubmitButton pendingLabel="Finalizando…">Finalizar turno</SubmitButton>
    </ActionForm>
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
