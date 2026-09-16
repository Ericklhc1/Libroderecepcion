'use client';

import { RefreshCw } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { reconcileKeysAction } from '@/server/actions/rooms';

/**
 * Reconciliación del inventario, a petición de una persona.
 *
 * Aplica la misma regla que la importación sobre **todas** las estadías
 * activas: existe para arreglar las que se cargaron antes de que la regla
 * existiera y quedaron con su llave en el inventario.
 *
 * Es idempotente, así que pulsarla dos veces no hace nada la segunda. No es
 * un proceso automático: alguien decide ejecutarla.
 */
export function ReconcileKeysForm() {
  return (
    <ActionForm action={reconcileKeysAction} className="space-y-0">
      <SubmitButton variant="secondary" pendingLabel="Revisando el inventario…">
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Reconciliar con las estadías
      </SubmitButton>
    </ActionForm>
  );
}
