'use client';

import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { restartTutorialAction } from '@/server/actions/tutorial';

/** Reactiva el recorrido y limpia cualquier cierre temporal de esta sesión. */
export function RestartTutorialButton({ userId }: { userId: string }) {
  return (
    <ActionForm
      action={restartTutorialAction}
      className="space-y-0"
      onSuccess={() => {
        window.sessionStorage.removeItem(`libro:tutorial:dismissed:${userId}`);
        window.location.reload();
      }}
    >
      <SubmitButton variant="secondary" size="sm" pendingLabel="Preparando…">
        Activar tutorial guiado
      </SubmitButton>
    </ActionForm>
  );
}
