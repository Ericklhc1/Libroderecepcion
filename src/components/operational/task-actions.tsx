'use client';

import { useFormStatus } from 'react-dom';

import { TaskStatus } from '@prisma/client';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TASK_STATUS_LABEL } from '@/domain/labels';
import {
  assignTaskAction,
  changeTaskStatusAction,
  deleteTaskAction,
  restoreTaskAction,
  toggleChecklistAction,
  updateTaskAction,
} from '@/server/actions/tasks';

const STATUS_OPTIONS = Object.values(TaskStatus).map((status) => ({
  value: status,
  label: TASK_STATUS_LABEL[status],
}));

/** Avance rápido de estado: un clic para lo más frecuente. */
export function QuickStatusForm({
  taskId,
  status,
  label,
  variant = 'secondary',
}: {
  taskId: string;
  status: TaskStatus;
  label: string;
  variant?: 'primary' | 'secondary' | 'gold';
}) {
  return (
    <ActionForm action={changeTaskStatusAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={taskId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant} size="sm" pendingLabel="Guardando…">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function TaskStatusDialog({
  taskId,
  currentStatus,
}: {
  taskId: string;
  currentStatus: TaskStatus;
}) {
  return (
    <Dialog
      title="Cambiar estado de la tarea"
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Cambiar estado"
    >
      <ActionForm action={changeTaskStatusAction} closeOnSuccess>
        <input type="hidden" name="id" value={taskId} />
        <Field label="Estado" name="status" required>
          <Select name="status" defaultValue={currentStatus} options={STATUS_OPTIONS} />
        </Field>
        <Field
          label="Motivo del bloqueo"
          name="blockedReason"
          hint="Obligatorio sólo si la tarea queda bloqueada."
        >
          <Textarea name="blockedReason" rows={2} />
        </Field>
        <Field label="Comentario para la auditoría" name="reason">
          <Input name="reason" />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Actualizar estado</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function AssignTaskDialog({
  taskId,
  currentAssigneeId,
  users,
}: {
  taskId: string;
  currentAssigneeId: string | null;
  users: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog
      title="Reasignar tarea"
      description="Sólo puede asignarse a personal operativo."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Reasignar"
    >
      <ActionForm action={assignTaskAction} closeOnSuccess>
        <input type="hidden" name="id" value={taskId} />
        <Field label="Responsable" name="assigneeId">
          <Select
            name="assigneeId"
            placeholder="Sin asignar"
            defaultValue={currentAssigneeId ?? ''}
            options={users}
          />
        </Field>
        <Field label="Motivo" name="reason" hint="Queda en la auditoría.">
          <Input name="reason" />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Reasignar</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function EditTaskDialog({
  task,
  departments,
}: {
  task: {
    id: string;
    title: string;
    description: string;
    priority: string;
    dueAt: string;
    departmentId: string | null;
    tags: string[];
  };
  departments: Array<{ value: string; label: string }>;
}) {
  return (
    <Dialog title="Editar tarea" triggerVariant="secondary" triggerSize="sm" trigger="Editar">
      <ActionForm action={updateTaskAction} closeOnSuccess>
        <input type="hidden" name="id" value={task.id} />
        <Field label="Título" name="title" required>
          <Input name="title" defaultValue={task.title} required maxLength={200} />
        </Field>
        <Field label="Detalle" name="description">
          <Textarea name="description" rows={3} defaultValue={task.description} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridad" name="priority">
            <Select
              name="priority"
              defaultValue={task.priority}
              options={[
                { value: 'BAJA', label: 'Baja' },
                { value: 'MEDIA', label: 'Media' },
                { value: 'ALTA', label: 'Alta' },
                { value: 'CRITICA', label: 'Crítica' },
              ]}
            />
          </Field>
          <Field label="Fecha límite" name="dueAt">
            <Input type="datetime-local" name="dueAt" defaultValue={task.dueAt} />
          </Field>
        </div>
        <Field label="Área" name="departmentId">
          <Select
            name="departmentId"
            placeholder="Sin área"
            defaultValue={task.departmentId ?? ''}
            options={departments}
          />
        </Field>
        <Field label="Etiquetas" name="tags" hint="Separadas por coma.">
          <Input name="tags" defaultValue={task.tags.join(', ')} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/**
 * Paso de la lista de una tarea.
 *
 * Marcar un paso es reversible y no tiene consecuencia operativa, así que la
 * casilla cambia en el mismo clic, antes de que el servidor responda. Si el
 * servidor rechaza el cambio, la página se revalida con el estado real y la
 * casilla vuelve sola: no hay estado inventado que quede pegado.
 *
 * El botón queda deshabilitado mientras la acción viaja, para que dos clics
 * seguidos no cancelen el cambio.
 */
function ChecklistToggleButton({ done, text }: { done: boolean; text: string }) {
  const { pending } = useFormStatus();
  const shown = pending ? !done : done;

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-sm transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:cursor-wait"
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[0.6rem] transition-colors ${
          shown
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-300 bg-white text-transparent'
        }`}
        aria-hidden="true"
      >
        ✓
      </span>
      <span className={shown ? 'text-slate-400 line-through' : 'text-petrol-900'}>{text}</span>
      <span className="sr-only">
        {shown ? `Desmarcar ${text}` : `Marcar ${text} como hecho`}
      </span>
    </button>
  );
}

export function ChecklistToggleForm({
  itemId,
  done,
  text,
}: {
  itemId: string;
  done: boolean;
  text: string;
}) {
  return (
    <ActionForm action={toggleChecklistAction} hideSuccess className="space-y-0">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="done" value={done ? 'false' : 'true'} />
      <ChecklistToggleButton done={done} text={text} />
    </ActionForm>
  );
}

export function DeleteTaskDialog({ taskId }: { taskId: string }) {
  return (
    <Dialog
      title="Eliminar tarea"
      description="Eliminación lógica: la tarea se conserva y puede restaurarse."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Eliminar"
    >
      <ActionForm action={deleteTaskAction} closeOnSuccess>
        <input type="hidden" name="id" value={taskId} />
        <Field label="Motivo de la eliminación" name="reason" required>
          <Textarea name="reason" rows={3} required minLength={5} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Eliminando…">
            Eliminar tarea
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function RestoreTaskForm({ taskId }: { taskId: string }) {
  return (
    <ActionForm action={restoreTaskAction} className="space-y-0">
      <input type="hidden" name="id" value={taskId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">
        Restaurar tarea
      </SubmitButton>
    </ActionForm>
  );
}
