'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Star,
  Settings2,
  Smile,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import {
  CHAT_AVATARS,
  CHAT_BODY_MAX,
  CHAT_EMOJIS,
  CHAT_NOTIFICATION_TONES,
  CHAT_STATUS_MAX,
  CHAT_STICKERS,
  avatarGlyph,
  chatStickerGlyph,
  type ChatBootstrap,
  type ChatConversationSnapshot,
  type ChatGifItem,
  type ChatMessageItem,
  type ChatPerson,
  type ChatProfile,
} from '@/domain/chat';
import { playChime } from '@/components/layout/notification-chime';

type View = 'list' | 'direct' | 'group' | 'conversation' | 'profile';
type HomeTab = 'chats' | 'online' | 'groups';

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
  if (message.mediaUrl) return 'GIF';
  if (message.kind === 'CONTEXTO') return 'Compartió un contexto del Libro';
  return message.body?.replace(/\s+/g, ' ').trim() || 'Nuevo mensaje';
}

function relativeActivity(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit' }).format(
    new Date(value),
  );
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
  const [homeTab, setHomeTab] = useState<HomeTab>('chats');
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  const [snapshot, setSnapshot] = useState<ChatConversationSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessageItem | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null);
  const [context, setContext] = useState<{ label: string; href: string } | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [emojisOpen, setEmojisOpen] = useState(false);
  const [gifsOpen, setGifsOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifItems, setGifItems] = useState<ChatGifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ChatProfile | null>(null);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<Set<string>>(() => new Set());
  const listEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const openedFromQuery = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingLastSentAtRef = useRef(0);

  useEffect(() => setMounted(true), []);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await requestJson<ChatBootstrap>('/api/chat/bootstrap');
      setBootstrap(data);
      setUnread(data.totalUnread);
      window.dispatchEvent(
        new CustomEvent('libro:chat-profile', { detail: data.profile }),
      );
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
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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
    if (!mounted) return;
    const source = new EventSource('/api/chat/stream');
    const refresh = () => {
      void loadBootstrap();
      const conversationId = selectedIdRef.current;
      if (conversationId) {
        void loadConversation(conversationId, { mark: true, busy: false });
      }
    };
    source.addEventListener('chat-change', refresh);
    return () => {
      source.removeEventListener('chat-change', refresh);
      source.close();
    };
  }, [mounted, loadConversation, loadBootstrap]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!gifsOpen) return;
    const q = gifQuery.trim();
    if (q.length < 2) {
      setGifItems([]);
      setGifLoading(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setGifLoading(true);
      void requestJson<{ items: ChatGifItem[] }>(
        `/api/chat/gifs?q=${encodeURIComponent(q)}`,
      )
        .then((data) => {
          if (active) setGifItems(data.items);
        })
        .catch((cause) => {
          if (active) {
            setGifItems([]);
            setError(cause instanceof Error ? cause.message : 'No se pudieron buscar GIF.');
          }
        })
        .finally(() => {
          if (active) setGifLoading(false);
        });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [gifQuery, gifsOpen]);

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
    const scoped = homeTab === 'groups'
      ? conversations.filter((item) => item.type === 'GRUPO')
      : conversations;
    if (!needle) return scoped;
    return scoped.filter((item) =>
      item.title.toLocaleLowerCase('es-CL').includes(needle),
    );
  }, [bootstrap?.conversations, homeTab, query]);

  const onlinePeople = useMemo(() => {
    const people = filteredPeople.filter((person) => person.presence.online);
    return people.sort((a, b) => {
      if (a.presence.inShift !== b.presence.inShift) return a.presence.inShift ? -1 : 1;
      return a.name.localeCompare(b.name, 'es');
    });
  }, [filteredPeople]);

  const visibleMessages = useMemo(() => {
    const messages = snapshot?.messages ?? [];
    const needle = conversationQuery.trim().toLocaleLowerCase('es-CL');
    if (!needle) return messages;
    return messages.filter((message) =>
      [message.body, message.senderName, message.contextLabel, message.mediaAlt]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('es-CL').includes(needle)),
    );
  }, [snapshot?.messages, conversationQuery]);

  const mentionState = useMemo(() => {
    const match = body.match(/(^|\s)@([A-Za-z0-9._-]*)$/);
    if (!match) return null;
    const fragment = (match[2] ?? '').toLocaleLowerCase('es-CL');
    const start = body.length - (match[2]?.length ?? 0) - 1;
    const candidates = (snapshot?.participants ?? [])
      .filter((person) => person.id !== currentUserId)
      .filter((person) =>
        !fragment ||
        person.username.toLocaleLowerCase('es-CL').includes(fragment) ||
        person.name.toLocaleLowerCase('es-CL').includes(fragment),
      )
      .slice(0, 6);
    return { start, candidates };
  }, [body, currentUserId, snapshot?.participants]);


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
    mediaUrl?: string;
    mediaPageUrl?: string;
    mediaSource?: 'WIKIMEDIA_COMMONS';
    mediaAlt?: string;
    contextLabel?: string;
    contextHref?: string;
    replyToId?: string;
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
    const quoted = replyTo;
    setContext(null);
    setReplyTo(null);
    await stopTyping();
    await postMessage({
      body: text || undefined,
      contextLabel: attached?.label,
      contextHref: attached?.href,
      replyToId: quoted?.id,
    });
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!selectedId) return;
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(messageId)}/reactions`,
        { method: 'POST', body: JSON.stringify({ emoji }) },
      );
      setReactionMessageId(null);
      await loadConversation(selectedId, { mark: true, busy: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la reacción.');
    }
  }

  async function toggleSaved(messageId: string) {
    if (!selectedId) return;
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(messageId)}/saved`,
        { method: 'POST', body: '{}' },
      );
      await loadConversation(selectedId, { mark: true, busy: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el mensaje.');
    }
  }

  async function postTyping(active: boolean) {
    const conversationId = selectedIdRef.current;
    if (!conversationId) return;
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/typing`,
        { method: 'POST', body: JSON.stringify({ active }) },
      );
    } catch {
      // El typing es efímero: un fallo no debe interrumpir la conversación.
    }
  }

  async function stopTyping() {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = null;
    if (!typingActiveRef.current) return;
    typingActiveRef.current = false;
    await postTyping(false);
  }

  function signalTyping(nextBody: string) {
    if (!selectedId || view !== 'conversation') return;
    if (!nextBody.trim()) {
      void stopTyping();
      return;
    }

    const now = Date.now();
    if (!typingActiveRef.current || now - typingLastSentAtRef.current > 2_000) {
      typingActiveRef.current = true;
      typingLastSentAtRef.current = now;
      void postTyping(true);
    }

    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      typingActiveRef.current = false;
      void postTyping(false);
    }, 2_500);
  }

  function insertMention(person: ChatPerson) {
    if (!mentionState) return;
    const next = `${body.slice(0, mentionState.start)}@${person.username} `;
    setBody(next.slice(0, CHAT_BODY_MAX));
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function openChatProfile() {
    const data = bootstrap ?? (await loadBootstrap());
    if (!data) return;
    setProfileDraft({ ...data.profile });
    setView('profile');
  }

  async function saveChatProfile() {
    if (!profileDraft) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await requestJson<ChatProfile>('/api/chat/profile', {
        method: 'PATCH',
        body: JSON.stringify(profileDraft),
      });
      setProfileDraft(profile);
      setBootstrap((current) => (current ? { ...current, profile } : current));
      window.dispatchEvent(
        new CustomEvent('libro:chat-profile', { detail: profile }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el perfil de chat.');
    } finally {
      setLoading(false);
    }
  }

  function testProfileTone() {
    if (!profileDraft?.soundEnabled) return;
    const tone =
      CHAT_NOTIFICATION_TONES.find((item) => item.key === profileDraft.notificationTone)?.key ??
      'chime';
    playChime(false, tone);
  }

  function closeComposerPickers() {
    setEmojisOpen(false);
    setStickersOpen(false);
    setGifsOpen(false);
  }

  function insertEmoji(emoji: string) {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? start;
    const next = (body.slice(0, start) + emoji + body.slice(end)).slice(0, CHAT_BODY_MAX);
    const caret = Math.min(start + emoji.length, next.length);
    setBody(next);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(caret, caret);
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
    setProfileDraft(null);
    setReplyTo(null);
    setReactionMessageId(null);
    setConversationQuery('');
    setConversationSearchOpen(false);
    void stopTyping();
    closeComposerPickers();
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
                  : view === 'profile'
                    ? 'Mi perfil de chat'
                    : 'Chat operativo'}
          </p>
          <p className="truncate text-[0.7rem] text-slate-500">
            {view === 'conversation' && snapshot
              ? `${snapshot.participants.length} participante${snapshot.participants.length === 1 ? '' : 's'}`
              : 'Mensajería interna del Libro'}
          </p>
        </div>
        {view === 'list' ? (
          <button
            type="button"
            onClick={() => void openChatProfile()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-petrol-50 text-xl hover:bg-petrol-100"
            aria-label="Mi perfil de chat"
            title="Mi perfil de chat"
          >
            {avatarGlyph(bootstrap?.profile.avatarKey)}
          </button>
        ) : null}
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
          <div className="shrink-0 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-1 px-3 pt-3">
              {([
                ['chats', 'CHATS'],
                ['online', 'EN LÍNEA'],
                ['groups', 'GRUPOS'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setHomeTab(tab);
                    setQuery('');
                  }}
                  className={`flex-1 rounded-lg px-2 py-2 text-[0.7rem] font-bold tracking-wide ${
                    homeTab === tab
                      ? 'bg-petrol-800 text-white'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-petrol-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 px-3 py-3">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={homeTab === 'online' ? 'Buscar persona…' : 'Buscar conversación…'}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-petrol-400 focus:bg-white"
                />
              </label>

              {homeTab === 'chats' ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setView('direct');
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-800 text-white hover:bg-petrol-700"
                  aria-label="Nuevo mensaje"
                  title="Nuevo mensaje"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              {homeTab === 'groups' ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setView('group');
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-800 text-white hover:bg-petrol-700"
                  aria-label="Crear grupo"
                  title="Crear grupo"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !bootstrap ? (
              <p className="p-6 text-center text-sm text-slate-500">Cargando chat…</p>
            ) : homeTab === 'online' ? (
              onlinePeople.length === 0 ? (
                <div className="p-8 text-center">
                  <Users className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-slate-700">Nadie aparece en línea</p>
                  <p className="mt-1 text-xs text-slate-500">
                    La presencia se actualiza automáticamente.
                  </p>
                </div>
              ) : (
                onlinePeople.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={loading}
                    onClick={() => void createDirect(person)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-2xl">
                      {avatarGlyph(person.avatarKey)}
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{person.name}</span>
                      <span className="block truncate text-xs text-slate-500">@{person.username}</span>
                      {person.statusText ? (
                        <span className="mt-0.5 block truncate text-xs italic text-slate-500">
                          {person.statusText}
                        </span>
                      ) : null}
                      <span className="mt-1 block">
                        <PersonPresence person={person} />
                      </span>
                    </span>
                  </button>
                ))
              )
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center">
                {homeTab === 'groups' ? (
                  <Users className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                ) : (
                  <MessageCircle className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                )}
                <p className="mt-2 text-sm font-medium text-slate-700">
                  {homeTab === 'groups' ? 'No hay grupos' : 'No hay conversaciones'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {homeTab === 'groups'
                    ? 'Crea un grupo para conversar con varios integrantes.'
                    : 'Inicia un mensaje directo para comenzar.'}
                </p>
              </div>
            ) : (
              filteredConversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadConversation(item.id)}
                  className="flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50"
                >
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-2xl text-petrol-800">
                    {item.type === 'GRUPO' ? (
                      <Users className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      avatarGlyph(item.counterpart?.avatarKey)
                    )}
                    {item.counterpart?.presence.online ? (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[0.66rem] text-slate-400">
                        {relativeActivity(item.lastMessageAt)}
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
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-petrol-800">
                  {avatarGlyph(person.avatarKey)}
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

      {view === 'profile' && profileDraft ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
          <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-petrol-50 text-4xl">
                {avatarGlyph(profileDraft.avatarKey)}
              </div>
              <p className="mt-2 text-sm font-semibold text-petrol-950">Editar avatar, estado y sonido</p>
              <p className="text-xs text-slate-500">Tu identidad dentro del IM del Libro.</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Avatar</p>
              <div className="grid grid-cols-7 gap-1.5">
                {CHAT_AVATARS.map((avatar) => (
                  <button
                    key={avatar.key}
                    type="button"
                    title={avatar.label}
                    onClick={() =>
                      setProfileDraft((current) =>
                        current ? { ...current, avatarKey: avatar.key } : current,
                      )
                    }
                    className={`flex aspect-square items-center justify-center rounded-xl text-2xl ${
                      profileDraft.avatarKey === avatar.key
                        ? 'bg-petrol-100 ring-2 ring-petrol-700'
                        : 'bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    {avatar.glyph}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Estado personal
              </span>
              <input
                value={profileDraft.statusText ?? ''}
                onChange={(event) =>
                  setProfileDraft((current) =>
                    current
                      ? { ...current, statusText: event.target.value.slice(0, CHAT_STATUS_MAX) }
                      : current,
                  )
                }
                maxLength={CHAT_STATUS_MAX}
                placeholder="Ej. En recepción ☕"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-petrol-400"
              />
              <span className="mt-1 block text-right text-[0.65rem] text-slate-400">
                {(profileDraft.statusText ?? '').length}/{CHAT_STATUS_MAX}
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tono de notificación
              </span>
              <select
                value={profileDraft.notificationTone}
                onChange={(event) =>
                  setProfileDraft((current) =>
                    current ? { ...current, notificationTone: event.target.value } : current,
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-petrol-400"
              >
                {CHAT_NOTIFICATION_TONES.map((tone) => (
                  <option key={tone.key} value={tone.key}>{tone.label}</option>
                ))}
              </select>
            </label>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Sonido</p>
                <p className="text-xs text-slate-500">Usar el tono seleccionado para mensajes.</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setProfileDraft((current) =>
                    current ? { ...current, soundEnabled: !current.soundEnabled } : current,
                  )
                }
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  profileDraft.soundEnabled
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-600'
                }`}
              >
                {profileDraft.soundEnabled ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!profileDraft.soundEnabled}
                onClick={testProfileTone}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-petrol-900 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Volume2 className="h-4 w-4" aria-hidden="true" />
                Probar tono
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void saveChatProfile()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-petrol-800 px-3 py-2.5 text-sm font-semibold text-white hover:bg-petrol-700 disabled:opacity-50"
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'conversation' && snapshot ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-4">
            <div className="space-y-2">
              {snapshot.messages.map((message) => {
                const mine = message.senderId === currentUserId;
                const sticker = chatStickerGlyph(message.stickerKey);
                const gif = message.kind === 'GIF' && Boolean(message.mediaUrl);
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[84%] ${
                      sticker || gif
                        ? 'px-2 py-1'
                        : mine
                          ? 'rounded-2xl rounded-br-md bg-petrol-800 px-3 py-2 text-white'
                          : 'rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-800 shadow-sm ring-1 ring-slate-100'
                    }`}>
                      {!mine && !sticker && !gif ? (
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
                      ) : gif && message.mediaUrl ? (
                        <div className="max-w-[280px]">
                          {!mine ? (
                            <p className="mb-1 text-[0.67rem] font-semibold text-petrol-700">
                              {message.senderName}
                            </p>
                          ) : null}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={message.mediaUrl}
                            alt={message.mediaAlt || 'GIF'}
                            loading="lazy"
                            className="max-h-64 w-auto max-w-full rounded-xl object-contain"
                          />
                          {message.mediaPageUrl ? (
                            <a
                              href={message.mediaPageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 block text-right text-[0.62rem] text-slate-400 hover:text-petrol-700"
                            >
                              Wikimedia Commons
                            </a>
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
                      {!sticker && !gif ? (
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

            {emojisOpen ? (
              <div className="mb-2 max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <div className="grid grid-cols-10 gap-1">
                  {CHAT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="rounded-lg p-1.5 text-xl hover:bg-white hover:shadow-sm"
                      aria-label={`Insertar emoji ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {stickersOpen ? (
              <div className="mb-2 max-h-44 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <div className="grid grid-cols-8 gap-1">
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
              </div>
            ) : null}

            {gifsOpen ? (
              <div className="mb-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    value={gifQuery}
                    onChange={(event) => setGifQuery(event.target.value)}
                    placeholder="Buscar GIF en Wikimedia Commons…"
                    autoFocus
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-petrol-400"
                  />
                </label>
                <div className="mt-2 max-h-52 overflow-y-auto">
                  {gifLoading ? (
                    <p className="py-6 text-center text-xs text-slate-500">Buscando GIF…</p>
                  ) : gifQuery.trim().length < 2 ? (
                    <p className="py-6 text-center text-xs text-slate-500">Escribe al menos 2 caracteres.</p>
                  ) : gifItems.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">No se encontraron GIF compatibles.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {gifItems.map((gif) => (
                        <button
                          key={gif.url}
                          type="button"
                          onClick={() => {
                            setGifsOpen(false);
                            setGifQuery('');
                            setGifItems([]);
                            void postMessage({
                              mediaUrl: gif.url,
                              mediaPageUrl: gif.pageUrl,
                              mediaSource: gif.source,
                              mediaAlt: gif.title,
                            });
                          }}
                          className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 hover:ring-petrol-400"
                          title={gif.title}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={gif.url}
                            alt={gif.title}
                            loading="lazy"
                            className="h-24 w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex items-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setEmojisOpen((value) => !value);
                  setStickersOpen(false);
                  setGifsOpen(false);
                }}
                className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Emojis"
                title="Emojis"
              >
                <Smile className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setStickersOpen((value) => !value);
                  setEmojisOpen(false);
                  setGifsOpen(false);
                }}
                className="shrink-0 rounded-lg px-2 py-2 text-base text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="Stickers"
                title="Stickers"
              >
                🀄
              </button>
              <button
                type="button"
                onClick={() => {
                  setGifsOpen((value) => !value);
                  setEmojisOpen(false);
                  setStickersOpen(false);
                }}
                className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
                aria-label="GIF"
                title="GIF"
              >
                <ImageIcon className="h-5 w-5" aria-hidden="true" />
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
                ref={composerRef}
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
