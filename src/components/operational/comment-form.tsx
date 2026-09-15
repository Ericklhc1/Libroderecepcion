'use client';

import { ActionForm, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { addCommentAction } from '@/server/actions/comments';

export function CommentForm({
  target,
}: {
  target: {
    entryId?: string;
    taskId?: string;
    followUpId?: string;
    alertId?: string;
    handoverId?: string;
  };
}) {
  return (
    <ActionForm action={addCommentAction} resetOnSuccess hideSuccess className="space-y-2">
      {target.entryId ? <input type="hidden" name="entryId" value={target.entryId} /> : null}
      {target.taskId ? <input type="hidden" name="taskId" value={target.taskId} /> : null}
      {target.followUpId ? (
        <input type="hidden" name="followUpId" value={target.followUpId} />
      ) : null}
      {target.alertId ? <input type="hidden" name="alertId" value={target.alertId} /> : null}
      {target.handoverId ? (
        <input type="hidden" name="handoverId" value={target.handoverId} />
      ) : null}
      <Textarea
        name="body"
        rows={2}
        required
        placeholder="Escribe un comentario para el equipo…"
        aria-label="Nuevo comentario"
      />
      <div className="flex justify-end">
        <SubmitButton size="sm" pendingLabel="Publicando…">
          Comentar
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
