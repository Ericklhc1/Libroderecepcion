import { EntryType } from '@prisma/client';
import { AlertTriangle, ListChecks, NotebookPen, Repeat } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { EntryForm } from '@/components/forms/entry-form';
import { TaskForm } from '@/components/forms/task-form';
import { FollowUpForm } from '@/components/forms/followup-form';
import { createEntryAction } from '@/server/actions/entries';
import { createTaskAction } from '@/server/actions/tasks';
import { createFollowUpAction } from '@/server/actions/followups';
import { getFormOptions } from '@/server/services/options';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Acciones rápidas siempre visibles: las cuatro cosas que un recepcionista
 * necesita registrar sin navegar a otra pantalla.
 */
export async function QuickActions({
  user,
  compact = false,
}: {
  user: CurrentUser;
  compact?: boolean;
}) {
  const options = await getFormOptions();
  const can = (permission: string) => user.permissions.includes(permission as never);

  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      {can('entry.create') ? (
        <Dialog
          title="Nueva novedad"
          description="Queda registrada en el libro operativo y en la entrega del turno."
          triggerVariant="gold"
          triggerSize={compact ? 'sm' : 'md'}
          trigger={
            <>
              <NotebookPen className="h-4 w-4" aria-hidden="true" />
              Nueva novedad
            </>
          }
        >
          <EntryForm action={createEntryAction} options={options} defaultType={EntryType.NOVEDAD} />
        </Dialog>
      ) : null}

      {can('incident.create') ? (
        <Dialog
          title="Nueva incidencia"
          description="Requiere gravedad. Si es crítica, se avisa a supervisión."
          triggerVariant="secondary"
          triggerSize={compact ? 'sm' : 'md'}
          trigger={
            <>
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Nueva incidencia
            </>
          }
        >
          <EntryForm
            action={createEntryAction}
            options={options}
            defaultType={EntryType.INCIDENCIA}
            lockType
          />
        </Dialog>
      ) : null}

      {can('task.create') ? (
        <Dialog
          title="Nueva tarea"
          description="Asigna responsable y fecha límite para que no se pierda."
          triggerVariant="secondary"
          triggerSize={compact ? 'sm' : 'md'}
          trigger={
            <>
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              Nueva tarea
            </>
          }
        >
          <TaskForm action={createTaskAction} options={options} defaultAssigneeId={user.id} />
        </Dialog>
      ) : null}

      {can('followup.create') ? (
        <Dialog
          title="Nuevo seguimiento"
          description="Registra qué se hizo y cuándo hay que volver a revisar."
          triggerVariant="secondary"
          triggerSize={compact ? 'sm' : 'md'}
          trigger={
            <>
              <Repeat className="h-4 w-4" aria-hidden="true" />
              Nuevo seguimiento
            </>
          }
        >
          <FollowUpForm action={createFollowUpAction} options={options} defaultOwnerId={user.id} />
        </Dialog>
      ) : null}
    </div>
  );
}
