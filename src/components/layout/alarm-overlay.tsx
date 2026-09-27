'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Clock3 } from 'lucide-react';
import type { NotificationFeedSnapshot, NotificationFeedItem } from '@/domain/notifications';
import { playChime, primeNotificationAudio } from '@/components/layout/notification-chime';

const MUTE_KEY = 'libro.avisoSonoro.silenciado';

function alarmFrom(items: NotificationFeedItem[]): NotificationFeedItem | null {
  return (
    items.find(
      (item) =>
        item.type === 'ALARMA' &&
        !item.readAt &&
        item.entity === 'AlarmRecipient' &&
        Boolean(item.entityId),
    ) ?? null
  );
}

export function AlarmOverlay({
  initialSnapshot,
}: {
  initialSnapshot: NotificationFeedSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const current = useMemo(() => alarmFrom(snapshot.items), [snapshot]);

  useEffect(() => {
    const onFeed = (event: Event) => {
      setSnapshot((event as CustomEvent<NotificationFeedSnapshot>).detail);
    };
    window.addEventListener('libro:notification-feed', onFeed);
    return () => window.removeEventListener('libro:notification-feed', onFeed);
  }, []);

  useEffect(() => {
    if (!current) return;
    primeNotificationAudio();
    const ring = () => {
      try {
        if (window.localStorage.getItem(MUTE_KEY) !== '1') playChime(true, 'chime');
      } catch {
        playChime(true, 'chime');
      }
    };
    ring();
    const id = window.setInterval(ring, 8_000);
    return () => window.clearInterval(id);
  }, [current?.id]);

  const respond = async (action: 'ACK' | 'SNOOZE', minutes?: number) => {
    if (!current?.entityId || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/alarms/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          action === 'ACK'
            ? { recipientId: current.entityId, action }
            : { recipientId: current.entityId, action, minutes },
        ),
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (response.ok) {
        setSnapshot((state) => ({
          ...state,
          unread: Math.max(0, state.unread - 1),
          items: state.items.map((item) =>
            item.id === current.id ? { ...item, readAt: new Date().toISOString() } : item,
          ),
        }));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  const isTimer = current.body?.startsWith('Timer') ?? false;

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-petrol-950/70 p-4 no-print">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="global-alarm-title"
        className="w-full max-w-lg rounded-3xl bg-white p-6 text-center shadow-2xl ring-1 ring-gold-300"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold-100 text-petrol-900">
          {isTimer ? <Clock3 className="h-8 w-8" aria-hidden="true" /> : <AlarmClock className="h-8 w-8" aria-hidden="true" />}
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-gold-700">
          {isTimer ? 'Timer' : 'Reminder'}
        </p>
        <h2 id="global-alarm-title" className="mt-1 text-2xl font-semibold text-petrol-950">
          {current.title}
        </h2>
        {current.body ? (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {current.body.replace(/^(Timer|Reminder) ·?\s*/, '') || 'Es hora.'}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-3 gap-2">
          {[5, 10, 15].map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={busy}
              onClick={() => void respond('SNOOZE', minutes)}
              className="rounded-xl bg-slate-100 px-3 py-3 text-sm font-semibold text-petrol-800 hover:bg-slate-200 disabled:opacity-50"
            >
              +{minutes} min
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void respond('ACK')}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-petrol-900 px-4 py-3 text-base font-semibold text-white hover:bg-petrol-800 disabled:opacity-50"
        >
          {busy ? 'Guardando…' : 'DETENER'}
        </button>
        <p className="mt-3 text-xs text-slate-500">
          Detener afecta sólo a tu alarma. En avisos grupales, cada destinatario confirma por separado.
        </p>
      </section>
    </div>
  );
}
