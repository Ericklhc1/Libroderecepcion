import { notificationPresentation } from '@/domain/notification-summary';

export function NotificationMessage({ notification }: {
  notification: { type: string; title: string; body: string | null };
}) {
  const presentation = notificationPresentation(notification);
  const hasDetail = Boolean(notification.body && notification.body !== presentation.body);
  return (
    <>
      <p className="mt-1 text-sm font-semibold text-petrol-900">{presentation.title}</p>
      {presentation.body ? <p className="mt-0.5 text-sm leading-5 text-slate-600">{presentation.body}</p> : null}
      {hasDetail ? (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-petrol-700">Ver detalle</summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-5">{notification.body}</p>
        </details>
      ) : null}
    </>
  );
}
