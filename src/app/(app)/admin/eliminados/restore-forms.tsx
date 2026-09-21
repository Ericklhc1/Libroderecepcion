'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { restoreFollowUpAction } from '@/server/actions/followups';
import { restoreAlertAction } from '@/server/actions/alerts';
import {
  restoreCorrectiveMeasureAction,
  restoreSupervisionNoteAction,
} from '@/server/actions/supervision-center';

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

export function RestoreSupervisionNoteForm({ noteId }: { noteId: string }) {
  return (
    <ActionForm action={restoreSupervisionNoteAction} className="space-y-0">
      <input type="hidden" name="id" value={noteId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">Restaurar</SubmitButton>
    </ActionForm>
  );
}

export function RestoreCorrectiveMeasureForm({ measureId }: { measureId: string }) {
  return (
    <ActionForm action={restoreCorrectiveMeasureAction} className="space-y-0">
      <input type="hidden" name="id" value={measureId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">Restaurar</SubmitButton>
    </ActionForm>
  );
}
