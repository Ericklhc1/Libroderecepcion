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
 * Una incidencia es el caso operativo: sus tareas y seguimientos se gestionan
 * desde la propia ficha para conservar contexto, responsable y trazabilidad.
 * Por eso tarea y seguimiento no aparecen como acciones globales paralelas.
 * Las tareas independientes siguen disponibles en su módulo específico.
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
          description="Registra lo ocurrido. Habitación, huésped y reserva son contexto opcional: agrégalos sólo cuando aporten información útil."
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
          description="La incidencia concentra el caso. Desde su ficha se asignan las tareas y se registran todos sus seguimientos."
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
