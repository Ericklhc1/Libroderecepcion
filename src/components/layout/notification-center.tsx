'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellRing,
  CheckCheck,
  ExternalLink,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  NOTIFICATION_WIDGET_LABELS,
  URGENT_NOTIFICATION_TYPES,
  type NotificationFeedItem,
  type NotificationFeedSnapshot,
} from '@/domain/notifications';
import { playChime, primeNotificationAudio } from './notification-chime';
import { NotificationMessage } from './notification-message';
import { groupNotificationItems, notificationDeviceItems, notificationPresentation } from '@/domain/notification-summary';
import type { ChatNotificationTone, ChatProfile } from '@/domain/chat';
import {
  disableDeviceNotifications,
  enableDeviceNotifications,
  getDeviceNotificationState,
  reconcileDeviceNotifications,
  showDeviceNotification,
  syncAppBadge,
  testDevicePush,
  type DeviceNotificationState,
} from './device-notifications';

const MUTE_KEY = 'libro.avisoSonoro.silenciado';
const KEEP_ALIVE_MS = 4 * 60_000;
const RECENT_ACTIVITY_MS = 10 * 60_000;
const NOTIFICATION_POLL_MS = 20_000;
const HIDDEN_ALARM_PULSE_MS = 30_000;

type ConnectionState = 'connecting' | 'live' | 'reconnecting';

function relativeLabel(value: string): string {
  const timestamp = new Date(value).getTime();
  const diffMs = Date.now() - timestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'ahora';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `hace ${hours} h`;

  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function typeLabel(type: string): string {
  return NOTIFICATION_WIDGET_LABELS[type] ?? type.replaceAll('_', ' ').toLowerCase();
}

function isUrgent(item: NotificationFeedItem): boolean {
  return URGENT_NOTIFICATION_TYPES.has(item.type) ||
    (item.type === 'FRONTI_HALLAZGO' && (/^Crítica ·/i.test(item.title) || /Prioridad:\s*CRITICA\b/i.test(item.body ?? '')));
}

function NotificationListItem({ item, onOpen, onRead }: {
  item: NotificationFeedItem;
  onOpen: (item: NotificationFeedItem) => Promise<void>;
  onRead: (id: string) => Promise<void>;
}) {
  const urgent = isUrgent(item);
  return (
    <li className={item.readAt ? 'bg-white' : 'bg-gold-50/40'}>
      <div className="flex gap-3 px-4 py-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
          item.readAt ? 'bg-slate-300' : urgent ? 'bg-red-600' : 'bg-gold-500'
        }`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">{typeLabel(item.type)}</span>
            <span className="ml-auto shrink-0 text-[0.68rem] tabular text-slate-400">{relativeLabel(item.createdAt)}</span>
          </div>
          <NotificationMessage notification={item} />
          <div className="mt-2 flex items-center gap-2">
            {item.link ? (
              <button type="button" onClick={() => void onOpen(item)} className="inline-flex items-center gap-1 text-xs font-semibold text-petrol-700 hover:underline">
                Abrir <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
            {!item.readAt ? (
              <button type="button" onClick={() => void onRead(item.id)} className="text-xs font-medium text-slate-500 hover:text-petrol-700">Marcar leída</button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function NotificationCenter({
  initialSnapshot,
}: {
  initialSnapshot: NotificationFeedSnapshot;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialSnapshot.items);
  const [unread, setUnread] = useState(initialSnapshot.unread);
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [muted, setMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [toast, setToast] = useState<NotificationFeedItem | null>(null);
  const [devicePermission, setDevicePermission] =
    useState<DeviceNotificationState>('unsupported');
  const [deviceEnabled, setDeviceEnabled] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [pushTestMessage, setPushTestMessage] = useState<string | null>(null);

  const mutedRef = useRef(false);
  const profileSoundEnabledRef = useRef(true);
  const notificationToneRef = useRef<ChatNotificationTone>('chime');
  const knownVersions = useRef(
    new Map(initialSnapshot.items.map((item) => [item.id, item.createdAt])),
  );
  const blockingAnnouncementSignature = useRef(
    initialSnapshot.blockingAnnouncementIds.join('|'),
  );
  const lastActivityAt = useRef(Date.now());
  const lastKeepAliveAt = useRef(0);
  const deviceEnabledRef = useRef(false);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const onChatProfile = (event: Event) => {
      const profile = (event as CustomEvent<ChatProfile>).detail;
      if (!profile) return;
      profileSoundEnabledRef.current = profile.soundEnabled;
      notificationToneRef.current = profile.notificationTone as ChatNotificationTone;
    };
    window.addEventListener('libro:chat-profile', onChatProfile);
    return () => window.removeEventListener('libro:chat-profile', onChatProfile);
  }, []);

  useEffect(() => {
    try {
      const nextMuted = window.localStorage.getItem(MUTE_KEY) === '1';
      mutedRef.current = nextMuted;
      setMuted(nextMuted);
    } catch {
      // Si storage está bloqueado, el aviso sonoro queda activo para esta sesión.
    }
    setAudioReady(true);
  }, []);

  useEffect(() => {
    const state = getDeviceNotificationState();
    setDevicePermission(state.permission);
    setDeviceEnabled(state.enabled);
    deviceEnabledRef.current = state.enabled;

    if (state.enabled) {
      void reconcileDeviceNotifications().then((healthy) => {
        if (!healthy) return;
        setDeviceEnabled(true);
        deviceEnabledRef.current = true;
      });
    }
  }, []);

  useEffect(() => {
    deviceEnabledRef.current = deviceEnabled;
  }, [deviceEnabled]);

  useEffect(() => {
    void syncAppBadge(unread);
  }, [unread]);

  useEffect(() => {
    const prime = () => primeNotificationAudio();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  const applySnapshot = useCallback(
    (snapshot: NotificationFeedSnapshot, announceNew: boolean) => {
      const fresh = announceNew
        ? snapshot.items.filter(
            (item) =>
              !item.readAt && knownVersions.current.get(item.id) !== item.createdAt,
          )
        : [];

      for (const item of snapshot.items) {
        knownVersions.current.set(item.id, item.createdAt);
      }

      setItems(snapshot.items);
      setUnread(snapshot.unread);

      const nextBlockingSignature = snapshot.blockingAnnouncementIds.join('|');
      if (nextBlockingSignature !== blockingAnnouncementSignature.current) {
        blockingAnnouncementSignature.current = nextBlockingSignature;
        // Un comunicado obligatorio nuevo, retirado o confirmado cambia el
        // layout completo: el gate debe aparecer/desaparecer sin navegar.
        router.refresh();
      }

      window.dispatchEvent(
        new CustomEvent('libro:notification-feed', { detail: snapshot }),
      );

      if (fresh.length > 0) {
        const newest = fresh[0];

        if (
          document.visibilityState !== 'visible' &&
          deviceEnabledRef.current
        ) {
          for (const item of notificationDeviceItems(fresh).slice(0, 3)) {
            void showDeviceNotification(item);
          }
        }

        if (newest) {
          setToast(newest);
          if (!mutedRef.current && profileSoundEnabledRef.current) {
            playChime(isUrgent(newest), notificationToneRef.current);
          }
        }
      }
    },
    [router],
  );

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const clearScheduled = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = () => {
      clearScheduled();
      if (!active) return;
      const delay =
        document.visibilityState === 'visible'
          ? NOTIFICATION_POLL_MS
          : HIDDEN_ALARM_PULSE_MS;
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (!active) return;

      controller?.abort();
      const nextController = new AbortController();
      controller = nextController;
      const hidden = document.visibilityState !== 'visible';
      const backgroundPush = hidden && deviceEnabledRef.current;

      try {
        const response = await fetch(
          hidden
            ? backgroundPush
              ? '/api/notifications/stream?mode=background'
              : '/api/notifications/stream?mode=alarm'
            : '/api/notifications/stream',
          {
            cache: 'no-store',
            signal: nextController.signal,
          },
        );

        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        if (!response.ok) throw new Error('No se pudieron actualizar las notificaciones.');

        if (hidden && !backgroundPush) {
          const payload = (await response.json()) as {
            dispatched: number;
            snapshot?: NotificationFeedSnapshot;
          };
          if (active && payload.snapshot) applySnapshot(payload.snapshot, true);
        } else {
          const snapshot = (await response.json()) as NotificationFeedSnapshot;
          if (!active) return;
          applySnapshot(snapshot, true);
          if (!hidden) setConnection('live');
        }
      } catch (error) {
        const aborted =
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError';
        if (!aborted && active && document.visibilityState === 'visible') {
          setConnection('reconnecting');
        }
      } finally {
        if (controller === nextController) controller = null;
        scheduleNext();
      }
    };

    const onVisibilityChange = () => {
      clearScheduled();
      controller?.abort();
      controller = null;
      if (document.visibilityState === 'visible') setConnection('connecting');
      void poll();
    };

    void poll();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      clearScheduled();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [applySnapshot]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 7_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /*
   * Conserva la política existente de sesión: sólo renueva si la pestaña está
   * visible y hubo actividad humana reciente. La sincronización no mantiene viva una
   * sesión abandonada por sí sola.
   */
  useEffect(() => {
    const keepAlive = async () => {
      const now = Date.now();
      if (document.visibilityState !== 'visible') return;
      if (now - lastActivityAt.current > RECENT_ACTIVITY_MS) return;
      if (now - lastKeepAliveAt.current < KEEP_ALIVE_MS - 10_000) return;

      lastKeepAliveAt.current = now;
      try {
        const response = await fetch('/api/session/heartbeat', {
          cache: 'no-store',
        });
        if (response.status === 401) window.location.assign('/login');
      } catch {
        // El siguiente pulso vuelve a intentar.
      }
    };

    const markActivity = () => {
      lastActivityAt.current = Date.now();
      void keepAlive();
    };

    const interval = window.setInterval(() => void keepAlive(), KEEP_ALIVE_MS);
    window.addEventListener('pointerdown', markActivity, { passive: true });
    window.addEventListener('keydown', markActivity);
    window.addEventListener('touchstart', markActivity, { passive: true });
    window.addEventListener('scroll', markActivity, { passive: true });

    const onVisible = () => {
      if (document.visibilityState === 'visible') markActivity();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('touchstart', markActivity);
      window.removeEventListener('scroll', markActivity);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const markRead = useCallback(
    async (id?: string) => {
      const now = new Date().toISOString();

      if (id) {
        setItems((current) =>
          current.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: now } : item)),
        );
        setUnread((current) => Math.max(0, current - 1));
      } else {
        setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
        setUnread(0);
      }

      try {
        const response = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(id ? { id } : { all: true }),
        });

        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }

        if (!response.ok) return;
        const snapshot = (await response.json()) as NotificationFeedSnapshot;
        applySnapshot(snapshot, false);
      } catch {
        // La siguiente sincronización reconciliará el estado real.
      }
    },
    [applySnapshot],
  );

  const openItem = async (item: NotificationFeedItem) => {
    if (!item.readAt) await markRead(item.id);
    if (!item.link) return;

    setOpen(false);
    setToast(null);

    if (/^https?:\/\//i.test(item.link)) {
      window.location.assign(item.link);
      return;
    }

    router.push(item.link);
  };

  const toggleSound = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);

    try {
      window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
      // La preferencia seguirá funcionando hasta cerrar esta pestaña.
    }

    if (!next) {
      primeNotificationAudio();
      playChime(false, notificationToneRef.current);
    }
  };

  const toggleDeviceNotifications = async () => {
    if (deviceEnabled) {
      await disableDeviceNotifications();
      deviceEnabledRef.current = false;
      setDeviceEnabled(false);
      return;
    }

    const permission = await enableDeviceNotifications();
    setDevicePermission(permission);
    const enabled = permission === 'granted';
    deviceEnabledRef.current = enabled;
    setDeviceEnabled(enabled);
  };

  const testPush = async () => {
    if (!deviceEnabled || pushTestBusy) return;
    setPushTestBusy(true);
    setPushTestMessage(null);
    try {
      const result = await testDevicePush();
      setPushTestMessage(result.message);
    } finally {
      setPushTestBusy(false);
    }
  };

  const toastPresentation = toast ? notificationPresentation(toast) : null;

  return (
    <>
      <button
        type="button"
        onClick={toggleSound}
        className={`rounded-lg p-2 transition-colors ${
          audioReady && muted
            ? 'text-slate-400 hover:bg-slate-100'
            : 'text-petrol-700 hover:bg-petrol-50'
        }`}
        aria-label={muted ? 'Aviso sonoro silenciado. Activarlo' : 'Aviso sonoro activo. Silenciarlo'}
        title={muted ? 'Aviso sonoro silenciado' : 'Aviso sonoro activo'}
      >
        {audioReady && muted ? (
          <VolumeX className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Volume2 className="h-5 w-5" aria-hidden="true" />
        )}
      </button>

      {devicePermission !== 'unsupported' ? (
        <button
          type="button"
          onClick={() => void toggleDeviceNotifications()}
          className={`relative rounded-lg p-2 transition-colors ${
            deviceEnabled
              ? 'text-emerald-700 hover:bg-emerald-50'
              : 'text-slate-400 hover:bg-slate-100'
          }`}
          aria-label={
            deviceEnabled
              ? 'Push del sistema activo. Desactivarlo'
              : devicePermission === 'denied'
                ? 'Notificaciones del dispositivo bloqueadas por el navegador'
                : devicePermission === 'requires-install'
                  ? 'En iPhone/iPad, añade AROH a la pantalla de inicio para activar push'
                  : 'Activar push del sistema'
          }
          title={
            deviceEnabled
              ? 'Push del sistema activo'
              : devicePermission === 'denied'
                ? 'Permiso bloqueado en el navegador'
                : devicePermission === 'requires-install'
                  ? 'iPhone/iPad: Añadir a pantalla de inicio'
                  : 'Activar push del sistema'
          }
        >
          <BellRing className="h-5 w-5" aria-hidden="true" />
          {deviceEnabled ? (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-white"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setToast(null);
        }}
        className="relative rounded-lg p-2 text-petrol-700 transition-colors hover:bg-petrol-50"
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-semibold tabular text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {toast && !open ? createPortal(
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setToast(null);
          }}
          className={`fixed right-3 top-20 z-[60] w-[min(24rem,calc(100vw-1.5rem))] rounded-md bg-white p-3 text-left shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)] ring-1 ${
            isUrgent(toast) ? 'ring-red-200' : 'ring-slate-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                isUrgent(toast) ? 'bg-red-600' : 'bg-gold-500'
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-slate-500">
                {typeLabel(toast.type)}
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-petrol-900">
                {toastPresentation?.title}
              </span>
              {toastPresentation?.body ? (
                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">
                  {toastPresentation.body}
                </span>
              ) : null}
            </span>
          </div>
        </button>,
        document.body,
      ) : null}

      {open ? createPortal(
        <div className="fixed inset-0 z-[70] no-print" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-petrol-950/30"
            aria-label="Cerrar notificaciones"
            onClick={() => setOpen(false)}
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-label="Notificaciones"
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-[0_18px_48px_-28px_rgba(9,24,32,0.48)]"
          >
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-petrol-900">Notificaciones</h2>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                  {connection === 'live' ? (
                    <>
                      <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Sincronizado</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" />
                      <span>{connection === 'connecting' ? 'Conectando…' : 'Reconectando…'}</span>
                    </>
                  )}
                </div>
              </div>

              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => void markRead()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-petrol-700 hover:bg-petrol-50"
                >
                  <CheckCheck className="h-4 w-4" aria-hidden="true" />
                  Marcar leídas
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-4 py-2.5 text-xs">
              {deviceEnabled ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-emerald-700">
                    Push del sistema activo en este dispositivo.
                  </p>
                  <button
                    type="button"
                    disabled={pushTestBusy}
                    onClick={() => void testPush()}
                    className="rounded-lg border border-emerald-200 px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {pushTestBusy ? 'Enviando…' : 'Probar push'}
                  </button>
                </div>
              ) : devicePermission === 'requires-install' ? (
                <p className="leading-5 text-amber-700">
                  En iPhone/iPad: abre AROH, usa Compartir → Añadir a pantalla de inicio,
                  entra desde el icono de AROH y activa la campana con ondas.
                </p>
              ) : devicePermission === 'denied' ? (
                <p className="leading-5 text-red-700">
                  El sistema operativo o navegador bloqueó las notificaciones. Debes
                  habilitarlas en los permisos del sitio/dispositivo.
                </p>
              ) : devicePermission === 'unsupported' ? (
                <p className="leading-5 text-slate-500">
                  Este navegador no ofrece Web Push compatible.
                </p>
              ) : (
                <p className="leading-5 text-slate-500">
                  Activa la campana con ondas para recibir avisos de Windows, macOS o
                  teléfono incluso con AROH cerrado.
                </p>
              )}
              {pushTestMessage ? (
                <p className="mt-1.5 leading-5 text-slate-600">{pushTestMessage}</p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                  <Bell className="h-8 w-8 text-slate-300" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-petrol-900">Todo al día</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Los avisos nuevos aparecerán aquí sin actualizar la página.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {groupNotificationItems(items).map((group) => group.title ? (
                    <li key={group.id} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-semibold text-petrol-900">{group.title}</p>
                        <span className="shrink-0 text-[0.68rem] text-slate-400">{relativeLabel(group.items[0]!.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-sm leading-5 text-slate-600">{group.body}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-petrol-700">
                          Ver {group.items.length} avisos · {group.items.filter((item) => !item.readAt).length} sin leer
                        </summary>
                        <ul className="mt-2 divide-y divide-slate-100">
                          {group.items.map((item) => <NotificationListItem key={item.id} item={item} onOpen={openItem} onRead={markRead} />)}
                        </ul>
                      </details>
                    </li>
                  ) : group.items.map((item) => <NotificationListItem key={item.id} item={item} onOpen={openItem} onRead={markRead} />))}
                </ul>
              )}
            </div>

            <div className="border-t border-slate-200 px-4 py-3 text-center text-[0.68rem] text-slate-400">
              Mostrando las {items.length} notificaciones más recientes.
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
