'use client';

import { useFormStatus } from 'react-dom';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { markNotificationsReadAction } from '@/server/actions/notifications';

export function MarkAllReadForm() {
  return (
    <ActionForm action={markNotificationsReadAction} hideSuccess className="space-y-0">
      <SubmitButton variant="secondary" size="sm" pendingLabel="Marcando…">
        Marcar todas como leídas
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * Marcar una notificación como leída no tiene vuelta atrás operativa ni
 * consecuencia sobre la operación, así que el botón anuncia el resultado en el
 * mismo clic en lugar de decir "guardando".
 */
function MarkOneReadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-petrol-700 transition-colors hover:bg-petrol-50 active:bg-petrol-100 disabled:cursor-wait disabled:text-slate-400"
    >
      {pending ? 'Leída' : 'Marcar leída'}
    </button>
  );
}

export function MarkOneReadForm({ id }: { id: string }) {
  return (
    <ActionForm action={markNotificationsReadAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={id} />
      <MarkOneReadButton />
    </ActionForm>
  );
}
