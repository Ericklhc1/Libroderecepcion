'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { restartTutorialAction } from '@/server/actions/tutorial';

/** Vuelve a ofrecer el recorrido guiado. Útil para quien lo saltó con prisa. */
export function RestartTutorialButton() {
  return (
    <ActionForm action={restartTutorialAction} className="space-y-0" refreshOnSuccess>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Preparando…">
        Ver el recorrido guiado otra vez
      </SubmitButton>
    </ActionForm>
  );
}
