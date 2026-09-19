'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { resolveAllConflictsAction } from '@/server/actions/conflicts';

export function ResolveAllConflictsDialog({ count }: { count: number }) {
  return (
    <Dialog
      trigger="Resolver todos los conflictos"
      triggerVariant="danger"
      triggerSize="sm"
      title="Resolver todos los conflictos"
      description={
        `Se intentarán resolver ${count} conflicto(s) con reglas verificables: ` +
        'se colapsan duplicados activos, se retiran ocupaciones antiguas reemplazadas por un PMS más reciente, ' +
        'se confirman check-outs vencidos después de la hora límite y se reconcilian llaves. ' +
        'Las contradicciones ambiguas no se inventan: quedan escaladas como incidencia crítica. ' +
        'La operación queda auditada y se notifica a todos los usuarios.'
      }
    >
      <ActionForm action={resolveAllConflictsAction} closeOnSuccess={false}>
        <div className="space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            Esta es una reparación global. Puede cerrar salidas vencidas y modificar el estado de llaves
            y estadías duplicadas cuando la regla sea determinística.
          </p>
          <SubmitButton variant="danger" pendingLabel="Resolviendo conflictos…">
            Confirmar y resolver todos
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
