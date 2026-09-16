import { EntryType } from '@prisma/client';
import { AlertTriangle, NotebookPen } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { EntryForm } from '@/components/forms/entry-form';
import { createEntryAction } from '@/server/actions/entries';
import { getFormOptions } from '@/server/services/options';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Acciones rápidas del mesón.
 *
 * Una tarea y un seguimiento no son hechos aislados cuando nacen de una
 * incidencia: son pasos de ese mismo caso. Por eso no se crean desde la barra
 * global. Se registran dentro del detalle de la novedad/incidencia, donde el
 * vínculo queda explícito y el recepcionista no tiene que reconstruirlo a
 * mano. Las tareas realmente independientes conservan su servicio y pueden
 * seguir creándose desde su contexto especializado.
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
          description="Requiere gravedad. Desde su ficha puedes asignar tareas y registrar seguimientos del mismo caso."
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
    </div>
  );
}
