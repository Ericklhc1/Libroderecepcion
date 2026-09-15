'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { restoreFollowUpAction } from '@/server/actions/followups';
import { restoreAlertAction } from '@/server/actions/alerts';

export function RestoreFollowUpForm({ followUpId }: { followUpId: string }) {
  return (
    <ActionForm action={restoreFollowUpAction} className="space-y-0">
      <input type="hidden" name="id" value={followUpId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">
        Restaurar
      </SubmitButton>
    </ActionForm>
  );
}

export function RestoreAlertForm({ alertId }: { alertId: string }) {
  return (
    <ActionForm action={restoreAlertAction} className="space-y-0">
      <input type="hidden" name="id" value={alertId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">
        Restaurar
      </SubmitButton>
    </ActionForm>
  );
}
