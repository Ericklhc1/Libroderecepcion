'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
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


export function OpenNotificationButton({
  id,
  href,
  unread,
}: {
  id: string;
  href: string;
  unread: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (unread) {
        const response = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id }),
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
      }
    } finally {
      if (/^https?:\/\//i.test(href)) {
        window.location.assign(href);
      } else {
        router.push(href);
      }
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void open()}
      className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline disabled:opacity-60"
    >
      {busy ? 'Abriendo…' : 'Abrir'}
    </button>
  );
}
