'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Check,
  Link2,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  CHAT_BODY_MAX,
  CHAT_STICKERS,
  chatStickerGlyph,
  type ChatBootstrap,
  type ChatConversationSnapshot,
  type ChatPerson,
} from '@/domain/chat';

type View = 'list' | 'direct' | 'group' | 'conversation';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Sesión vencida.');
  }
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la operación.');
  return payload;
}

function presenceLabel(person: ChatPerson): string {
  if (person.presence.inShift) {
    return `En turno ${person.presence.shiftType === 'NOCHE' ? 'NOCHE' : 'DÍA'}`;
  }
  return 'Fuera de turno';
}

function previewText(item: ChatBootstrap['conversations'][number]): string {
  const message = item.lastMessage;
  if (!message) return 'Sin mensajes todavía';
  if (message.stickerKey) {
    return `${chatStickerGlyph(message.stickerKey) ?? '💬'} Sticker`;
  }
  return message.body?.replace(/\s+/g, ' ').trim() || 'Compartió un contexto del Libro';
}

function PersonPresence({ person, compact = false }: { person: ChatPerson; compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] text-slate-500">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          person.presence.online ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
        aria-label={person.presence.online ? 'En línea' : 'Sin actividad reciente'}
      />
      <span className="truncate">
        {person.presence.online ? 'En línea' : 'Sin conexión'}
        {!compact ? ` · ${presenceLabel(person)}` : ''}
      </span>
    </span>
  );
}

export function ChatWidget({
  currentUserId,
  initialUnread,
  attachmentsEnabled = false,
}: {
  currentUserId: string;
  initialUnread: number;
  attachmentsEnabled?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  const [snapshot, setSnapshot] = useState<ChatConversationSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [context, setContext] = useState<{ label: string; href: string } | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<Set<string>>(() => new Set());
  const listEndRef = useRef<HTMLDivElement>(null);
  const openedFromQuery = useRef(false);

  useEffect(() => setMounted(true), []);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await requestJson<ChatBootstrap>('/api/chat/bootstrap');
      setBootstrap(data);
      setUnread(data.totalUnread);
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el chat.');
      return null;
    }
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    try {
      await requestJson<{ ok: true }>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/read`,
        { method: 'POST', body: '{}' },
      );
      setBootstrap((current) => {
        if (!current) return current;
        const conversations = current.conversations.map((item) =>
          item.id === conversationId ? { ...item, unreadCount: 0 } : item,
        );
        const totalUnread = conversations.reduce((sum, item) => sum + item.unreadCount, 0);
        setUnread(totalUnread);
        return { ...current, conversations, totalUnread };
      });
    } catch {
      // La siguiente sincronización vuelve a intentarlo.
    }
  }, []);

  const loadConversation = useCallback(
    async (conversationId: string, options: { mark?: boolean; busy?: boolean } = {}) => {
      if (options.busy !== false) setLoading(true);
      setError(null);
      try {
        const data = await requestJson<ChatConversationSnapshot>(
          `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
        );
        setSnapshot(data);
        setSelectedId(conversationId);
        setView('conversation');
        if (options.mark !== false) void markRead(conversationId);
        window.setTimeout(() => listEndRef.current?.scrollIntoView({ block: 'end' }), 10);
        return data;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo abrir la conversación.');
        return null;
      } finally {
        if (options.busy !== false) setLoading(false);
      }
    },
    [markRead],
  );

  useEffect(() => {
    if (!open) return;
    void loadBootstrap();
  }, [open, loadBootstrap]);

  useEffect(() => {
    if (!mounted || openedFromQuery.current) return;
    const params = new URLSearchParams(window.location.search);
    const chat = params.get('chat');
    if (!chat) return;
    openedFromQuery.current = true;
    setOpen(true);
    void loadConversation(chat);
  }, [mounted, loadConversation]);

  useEffect(() => {
    const onFeed = (event: Event) => {
      const detail = (event as CustomEvent<{ items?: Array<{ type: string; readAt: string | null }> }>).detail;
      if (!detail?.items?.some((item) => item.type === 'CHAT_MENSAJE' && !item.readAt)) return;
      void loadBootstrap();
    };
    window.addEventListener('libro:notification-feed', onFeed);
    return () => window.removeEventListener('libro:notification-feed', onFeed);
  }, [loadBootstrap]);

  useEffect(() => {
    if (!open || !selectedId || view !== 'conversation') return;
    const source = new EventSource(
      `/api/chat/stream?conversationId=${encodeURIComponent(selectedId)}`,
    );
    const refresh = () => {
      void loadConversation(selectedId, { mark: true, busy: false });
      void loadBootstrap();
    };
    source.addEventListener('chat-change', refresh);
    return () => {
      source.removeEventListener('chat-change', refresh);
      source.close();
    };
  }, [open, selectedId, view, loadConversation, loadBootstrap]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const filteredPeople = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es-CL');
    const people = bootstrap?.people ?? [];
    if (!needle) return people;
    return people.filter(
      (person) =>
        person.name.toLocaleLowerCase('es-CL').includes(needle) ||
        person.username.toLocaleLowerCase('es-CL').includes(needle),
    );
  }, [bootstrap?.people, query]);

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es-CL');
    const conversations = bootstrap?.conversations ?? [];
    if (!needle) return conversations;
    return conversations.filter((item) =>
      item.title.toLocaleLowerCase('es-CL').includes(needle),
    );
  }, [bootstrap?.conversations, query]);

  async function createDirect(person: ChatPerson) {
    setLoading(true);
    setError(null);
    try {
      const created = await requestJson<{ id: string }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'DIRECTO', userId: person.id }),
      });
      await loadBootstrap();
      await loadConversation(created.id, { busy: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el chat.');
    } finally {
      setLoading(false);
    }
  }

  async function createGroup() {
    if (!groupTitle.trim() || groupMembers.size < 1) return;
    setLoading(true);
    setError(null);
    try {
      const created = await requestJson<{ id: string }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          type: 'GRUPO',
          title: groupTitle,
          userIds: Array.from(groupMembers),
        }),
      });
      setGroupTitle('');
      setGroupMembers(new Set());
      await loadBootstrap();
      await loadConversation(created.id, { busy: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el grupo.');
    } finally {
      setLoading(false);
    }
  }

  async function postMessage(payload: {
    body?: string;
    stickerKey?: string;
    contextLabel?: string;
    contextHref?: string;
  }) {
    if (!selectedId) return;
    setError(null);
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      await loadConversation(selectedId, { mark: true, busy: false });
      void loadBootstrap();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje.');
    }
  }

  async function sendMessage() {
    const text = body.trim();
    if (!text && !context) return;
    setBody('');
    const attached = context;
    setContext(null);
    await postMessage({
      body: text || undefined,
      contextLabel: attached?.label,
      contextHref: attached?.href,
    });
  }

  function attachCurrentContext() {
    const url = new URL(window.location.href);
    url.searchParams.delete('chat');
    const search = url.searchParams.toString();
    const href = url.pathname + (search ? `?${search}` : '');
    const heading = document.querySelector('h1')?.textContent?.trim();
    setContext({
      href,
      label: heading ? heading.slice(0, 100) : 'Abrir esta pantalla del Libro',
    });
  }

  function goBack() {
    setSnapshot(null);
    setSelectedId(null);
    setView('list');
    setQuery('');
    void loadBootstrap();
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-label={unread > 0 ? `Chat, ${unread} mensajes sin leer` : 'Abrir chat'}
      aria-expanded={open}
      className="relative rounded-lg p-2 text-petrol-700 hover:bg-petrol-50"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      {unread > 0 ? (
        <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[0.6rem] font-bold text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </button>
  );

  if (!mounted) return trigger;

  const panel = open ? (
    <div className="fixed inset-0 z-[120] flex flex-col bg-white shadow-2xl sm:inset-auto sm:right-4 sm:top-16 sm:h-[min(720px,calc(100vh-5rem))] sm:w-[420px] sm:overflow-hidden sm:rounded-2xl sm:ring-1 sm:ring-slate-200">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-3">
        {view !== 'list' ? (
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Volver a conversaciones"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-petrol-800 text-gold-300">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-petrol-950">
            {view === 'conversation' && snapshot
              ? snapshot.title
              : view === 'direct'
                ? 'Nuevo mensaje'
                : view === 'group'
                  ? 'Nuevo grupo'
                  : 'Chat operativo'}
          </p>
          <p className="truncate text-[0.7rem] text-slate-500">
            {view === 'conversation' && snapshot
              ? `${snapshot.participants.length} participante${snapshot.participants.length === 1 ? '' : 's'}`
              : 'Mensajería interna del Libro'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Cerrar chat"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {error ? (
        <div className="shrink-0 border-b border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}

      {view === 'list' ? (
        <>
          <div className="shrink-0 space-y-2 border-b border-slate-100 px-3 py-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setView('direct');
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-petrol-800 px-3 py-2 text-xs font-semibold text-white hover:bg-petrol-700"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Mensaje
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setView('group');
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-petrol-900 hover:bg-slate-200"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                Grupo
              </button>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar conversación…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-petrol-400 focus:bg-white"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !bootstrap ? (
              <p className="p-6 text-center text-sm text-slate-500">Cargando chat…</p>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center">
                <MessageCircle className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-slate-700">No hay conversaciones</p>
                <p className="mt-1 text-xs text-slate-500">Inicia un mensaje directo o crea un grupo.</p>
              </div>
            ) : (
              filteredConversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadConversation(item.id)}
                  className="flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50"
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-sm font-semibold text-petrol-800">
                    {item.type === 'GRUPO' ? (
                      <Users className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      item.title.slice(0, 1).toUpperCase()
                    )}
                    {item.counterpart?.presence.online ? (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                        {item.title}
                      </span>
                      {item.unreadCount > 0 ? (
                        <span className="rounded-full bg-petrol-800 px-1.5 py-0.5 text-[0.62rem] font-bold text-white">
                          {item.unreadCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {previewText(item)}
                    </span>
                    {item.counterpart ? (
                      <span className="mt-1 block">
                        <PersonPresence person={item.counterpart} />
                      </span>
                    ) : (
                      <span className="mt-1 block text-[0.68rem] text-slate-400">
                        {item.participantCount} participantes
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}

      {view === 'direct' ? (
        <>
          <div className="shrink-0 border-b border-slate-100 px-3 py-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre o usuario…"
                autoFocus
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-petrol-400 focus:bg-white"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredPeople.map((person) => (
              <button
                key={person.id}
                type="button"
                disabled={loading}
                onClick={() => void createDirect(person)}
                className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-petrol-800">
                  {person.name.slice(0, 1).toUpperCase()}
                  <span
                    className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                      person.presence.online ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{person.name}</span>
                  <span className="block truncate text-xs text-slate-500">@{person.username} · {person.roleName}</span>
                  <PersonPresence person={person} />
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {view === 'group' ? (
        <>
          <div className="shrink-0 space-y-3 border-b border-slate-100 px-3 py-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Nombre del grupo</span>
              <input
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
                maxLength={80}
                placeholder="Ej. Recepción turno noche"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-petrol-400"
              />
            </label>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar personas…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-petrol-400 focus:bg-white"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredPeople.map((person) => {
              const selected = groupMembers.has(person.id);
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() =>
                    setGroupMembers((current) => {
                      const next = new Set(current);
                      if (next.has(person.id)) next.delete(person.id);
                      else next.add(person.id);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                    selected
                      ? 'border-petrol-700 bg-petrol-800 text-white'
                      : 'border-slate-300 bg-white text-transparent'
                  }`}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{person.name}</span>
                    <PersonPresence person={person} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="shrink-0 border-t border-slate-200 p-3">
            <button
              type="button"
              disabled={loading || groupMembers.size < 1 || groupTitle.trim().length < 2}
              onClick={() => void createGroup()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-petrol-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-petrol-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Crear grupo · {groupMembers.size + 1}
            </button>
          </div>
        </>
      ) : null}

      {view === 'conversation' && snapshot ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4">
            <div className="space-y-2">
              {snapshot.messages.map((message) => {
                const mine = message.senderId === currentUserId;
                const sticker = chatStickerGlyph(message.stickerKey);
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[84%] ${
                      sticker
                        ? 'px-2 py-1'
                        : mine
                          ? 'rounded-2xl rounded-br-md bg-petrol-800 px-3 py-2 text-white'
                          : 'rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-800 shadow-sm ring-1 ring-slate-100'
                    }`}>
                      {!mine && !sticker ? (
                        <p className="mb-0.5 text-[0.67rem] font-semibold text-petrol-700">
                          {message.senderName}
                        </p>
                      ) : null}
                      {sticker ? (
                        <div className="text-center">
                          <span className="text-5xl" role="img" aria-label="Sticker">{sticker}</span>
                          {!mine ? (
                            <p className="mt-1 text-[0.65rem] font-medium text-slate-500">{message.senderName}</p>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          {message.body ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
                          ) : null}
                          {message.contextHref ? (
                            <a
                              href={message.contextHref}
                              className={`mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium ${
                                mine
                                  ? 'bg-white/10 text-white hover:bg-white/20'
                                  : 'bg-petrol-50 text-petrol-800 hover:bg-petrol-100'
                              }`}
                            >
                              <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="truncate">{message.contextLabel || 'Abrir en el Libro'}</span>
                            </a>
                          ) : null}
                          {message.attachments.map((attachment) => (
                            <div key={attachment.id} className="mt-2 rounded-lg bg-black/5 px-2 py-1.5 text-xs">
                              <Paperclip className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                              {attachment.fileName}
                            </div>
                          ))}
                        </>
                      )}
                      {!sticker ? (
                        <p className={`mt-1 text-right text-[0.6rem] ${
                          mine ? 'text-petrol-100' : 'text-slate-400'
                        }`}>
                          {new Intl.DateTimeFormat('es-CL', {
                            timeZone: 'America/Santiago',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          }).format(new Date(message.createdAt))}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={listEndRef} />
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {context ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-petrol-50 px-2.5 py-2 text-xs text-petrol-800">
                <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{context.label}</span>
                <button type="button" onClick={() => setContext(null)} className="rounded p-1 hover:bg-petrol-100" aria-label="Quitar contexto">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {stickersOpen ? (
              <div className="mb-2 grid grid-cols-8 gap-1 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                {CHAT_STICKERS.map((sticker) => (
                  <button
                    key={sticker.key}
                    type="button"
                    title={sticker.label}
                    onClick={() => {
                      setStickersOpen(false);
                      void postMessage({ stickerKey: sticker.key });
                    }}
                    className="rounded-lg p-1.5 text-2xl hover:bg-white hover:shadow-sm"
                  >
                    {sticker.glyph}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex items-end gap-1">
              <button
                type="button"
                onClick={() => setStickersOpen((value) => !value)}
                className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Stickers"
              >
                <Smile className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={attachCurrentContext}
                className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Adjuntar pantalla actual del Libro"
                title="Adjuntar enlace a la pantalla actual"
              >
                <Link2 className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={!attachmentsEnabled}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Adjuntar archivo"
                title={attachmentsEnabled ? 'Adjuntar archivo' : 'Adjuntos disponibles al activar almacenamiento de objetos'}
              >
                <Paperclip className="h-5 w-5" aria-hidden="true" />
              </button>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value.slice(0, CHAT_BODY_MAX))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder="Mensaje…"
                className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-petrol-400 focus:bg-white"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!body.trim() && !context}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-petrol-800 text-white hover:bg-petrol-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {trigger}
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
