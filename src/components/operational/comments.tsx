import { MessageSquare } from 'lucide-react';
import { formatDateTime, initials } from '@/lib/format';
import { listComments } from '@/server/services/comments';
import { CommentForm } from './comment-form';

type Target = {
  entryId?: string;
  taskId?: string;
  followUpId?: string;
  alertId?: string;
  handoverId?: string;
};

/** Hilo de comentarios de cualquier objeto operativo. */
export async function Comments({ target }: { target: Target }) {
  const comments = await listComments(target);

  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {comments.length === 0 ? (
          <li className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Sin comentarios. Usa este espacio para coordinar entre turnos.
          </li>
        ) : null}
        {comments.map((comment) => (
          <li key={comment.id} className="flex gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-petrol-100 text-xs font-semibold text-petrol-700">
              {initials(comment.author.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-petrol-900">{comment.author.name}</span>
                <time className="text-xs tabular text-slate-400">
                  {formatDateTime(comment.createdAt)}
                </time>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{comment.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-200 px-4 py-3">
        <CommentForm target={target} />
      </div>
    </div>
  );
}
