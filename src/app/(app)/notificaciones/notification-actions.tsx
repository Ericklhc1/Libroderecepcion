'use client';

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

export function MarkOneReadForm({ id }: { id: string }) {
  return (
    <ActionForm action={markNotificationsReadAction} hideSuccess className="space-y-0">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="…">
        Marcar leída
      </SubmitButton>
    </ActionForm>
  );
}
