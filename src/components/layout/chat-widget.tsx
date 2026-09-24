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
  Mic,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  Send,
  Star,
  Settings2,
  Trash2,
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
  avatarGlyph,
  chatStickerGlyph,
  type ChatBootstrap,
  type ChatConversationSnapshot,
  type ChatGifItem,
  type ChatMessageItem,
  type ChatPerson,
  type ChatProfile,
  type ChatStickerItem,
} from '@/domain/chat';
import { playChime } from '@/components/layout/notification-chime';

type View = 'list' | 'direct' | 'group' | 'conversation' | 'profile' | 'settings';
type HomeTab = 'chats' | 'online' | 'groups' | 'saved';

type SavedChatItem = {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  senderName: string;
  body: string | null;
  kind: string;
  createdAt: string;
  savedAt: string;
};

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

function renderMessageBody(body: string) {
  const parts = body.split(/(https?:\/\/[^\s]+|@[A-Za-z0-9._-]{2,40})/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`link-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          {part}
        </a>
      );
    }
    if (/^@[A-Za-z0-9._-]{2,40}$/.test(part)) {
      return (
        <span key={`mention-${index}`} className="rounded bg-gold-200/50 px-0.5 font-semibold">
          {part}
        </span>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
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
  const [savedItems, setSavedItems] = useState<SavedChatItem[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
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
  const [editingMessage, setEditingMessage] = useState<ChatMessageItem | null>(null);
  const [reactionMessageId, setReactionMessageId] = useState<string | null>(null);
  const [context, setContext] = useState<{ label: string; href: string } | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [emojisOpen, setEmojisOpen] = useState(false);
  const [gifsOpen, setGifsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [customStickers, setCustomStickers] = useState<ChatStickerItem[]>([]);
  const [stickerTab, setStickerTab] = useState<'favorites' | 'recent' | 'mine' | 'all'>('favorites');
  const [gifTab, setGifTab] = useState<'search' | 'favorites' | 'recent'>('search');
  const [gifPreferences, setGifPreferences] = useState<Array<{
    refKey: string;
    payload: unknown;
    favorite: boolean;
    usedAt: string;
  }>>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifItems, setGifItems] = useState<ChatGifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ChatProfile | null>(null);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<Set<string>>(() => new Set());
  const [groupSettingsTitle, setGroupSettingsTitle] = useState('');
  const [groupManageQuery, setGroupManageQuery] = useState('');
  const listEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const openedFromQuery = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingLastSentAtRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const storageAvailable = attachmentsEnabled || bootstrap?.storageEnabled === true;

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
    if (!recording) return;
    const started = Date.now();
    setRecordingSeconds(0);
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!pendingFile || !pendingFile.type.startsWith('image/')) {
      setPendingPreview(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

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

  const visibleCustomStickers = useMemo(() => {
    const rows = [...customStickers];
    if (stickerTab === 'favorites') return rows.filter((item) => item.favorite);
    if (stickerTab === 'mine') return rows.filter((item) => item.mine);
    if (stickerTab === 'recent') {
      return rows
        .filter((item) => item.usedAt)
        .sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt)));
    }
    return rows;
  }, [customStickers, stickerTab]);

  const savedGifItems = useMemo(() => {
    return gifPreferences
      .filter((item) => gifTab === 'favorites' ? item.favorite : true)
      .map((item) => {
        const payload = item.payload as Partial<ChatGifItem> | null;
        if (
          !payload ||
          typeof payload.url !== 'string' ||
          typeof payload.pageUrl !== 'string' ||
          typeof payload.title !== 'string' ||
          (payload.source !== 'TENOR' && payload.source !== 'WIKIMEDIA_COMMONS')
        ) return null;
        return {
          title: payload.title,
          url: payload.url,
          pageUrl: payload.pageUrl,
          width: typeof payload.width === 'number' ? payload.width : null,
          height: typeof payload.height === 'number' ? payload.height : null,
          source: payload.source,
        } satisfies ChatGifItem;
      })
      .filter((item): item is ChatGifItem => item !== null);
  }, [gifPreferences, gifTab]);

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


  async function loadSavedMessages() {
    setSavedLoading(true);
    try {
      const data = await requestJson<{ items: SavedChatItem[] }>('/api/chat/saved');
      setSavedItems(data.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los mensajes guardados.');
      setSavedItems([]);
    } finally {
      setSavedLoading(false);
    }
  }

  async function loadStickerLibrary() {
    try {
      const data = await requestJson<{ items: ChatStickerItem[] }>('/api/chat/stickers');
      setCustomStickers(data.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los stickers.');
    }
  }

  async function loadGifPreferences() {
    try {
      const data = await requestJson<{ items: Array<{
        refKey: string;
        payload: unknown;
        favorite: boolean;
        usedAt: string;
      }> }>('/api/chat/media?kind=gif');
      setGifPreferences(data.items);
    } catch {
      setGifPreferences([]);
    }
  }

  async function toggleMediaFavorite(
    kind: 'gif' | 'sticker',
    refKey: string,
    payload?: unknown,
  ) {
    try {
      await requestJson('/api/chat/media', {
        method: 'POST',
        body: JSON.stringify({ kind, refKey, payload }),
      });
      if (kind === 'gif') await loadGifPreferences();
      else await loadStickerLibrary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar favoritos.');
    }
  }

  function selectIncomingFile(file: File) {
    if (!storageAvailable) {
      setError('Activa Cloudflare R2 para enviar imágenes y archivos.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('El archivo debe pesar como máximo 20 MB.');
      return;
    }
    setPendingFile(file);
    setPlusOpen(false);
  }

  async function uploadAttachment(file: File, text?: string, quotedId?: string) {
    if (!selectedId) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      if (text) form.set('body', text);
      if (quotedId) form.set('replyToId', quotedId);
      const response = await fetch(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/attachments`,
        { method: 'POST', body: form },
      );
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo subir el archivo.');
      await loadConversation(selectedId, { mark: true, busy: false });
      void loadBootstrap();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(false);
    }
  }

  async function createStickerFromFile(file: File) {
    if (!selectedId || !storageAvailable) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('conversationId', selectedId);
      const response = await fetch('/api/chat/stickers', { method: 'POST', body: form });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'No se pudo crear el sticker.');
      await loadStickerLibrary();
      setStickersOpen(true);
      setStickerTab('mine');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el sticker.');
    } finally {
      setUploading(false);
    }
  }

  async function startVoiceRecording() {
    if (!storageAvailable) {
      setError('Activa Cloudflare R2 para enviar notas de voz.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar notas de voz.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const preferred = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const actualType = recorder.mimeType || voiceChunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(voiceChunksRef.current, { type: actualType });
        const ext = actualType.includes('mp4') ? 'm4a' : actualType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `nota-de-voz-${Date.now()}.${ext}`, { type: actualType.split(';')[0] });
        voiceChunksRef.current = [];
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
        if (blob.size > 0) selectIncomingFile(file);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setPlusOpen(false);
      setRecording(true);
    } catch {
      setError('No se pudo acceder al micrófono.');
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    }
  }

  function stopVoiceRecording(cancel = false) {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (cancel) {
      recorder.onstop = () => {
        voiceChunksRef.current = [];
        voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        setRecording(false);
      };
    }
    recorder.stop();
  }

  async function createStickerFromAttachment(attachment: ChatMessageItem['attachments'][number]) {
    if (!storageAvailable || !attachment.mimeType.startsWith('image/')) return;
    setUploading(true);
    setError(null);
    try {
      const response = await fetch(attachment.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo leer la imagen.');
      const blob = await response.blob();
      const file = new File([blob], attachment.fileName, { type: attachment.mimeType });
      await createStickerFromFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el sticker.');
    } finally {
      setUploading(false);
    }
  }

  async function editMessage(messageId: string, nextBody: string) {
    if (!selectedId) return;
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'PATCH', body: JSON.stringify({ body: nextBody }) },
      );
      setEditingMessage(null);
      setBody('');
      await loadConversation(selectedId, { mark: true, busy: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo editar el mensaje.');
    }
  }

  async function deleteMessage(messageId: string) {
    if (!selectedId) return;
    if (!window.confirm('¿Eliminar este mensaje?')) return;
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}/messages/${encodeURIComponent(messageId)}`,
        { method: 'DELETE', body: '{}' },
      );
      await loadConversation(selectedId, { mark: true, busy: false });
      void loadBootstrap();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el mensaje.');
    }
  }

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

  async function manageGroup(
    payload:
      | { action: 'rename'; title: string }
      | { action: 'add'; userId: string }
      | { action: 'remove'; userId: string }
      | { action: 'promote'; userId: string }
      | { action: 'demote'; userId: string }
      | { action: 'mute'; muted: boolean }
      | { action: 'leave' },
  ) {
    if (!selectedId) return false;
    setLoading(true);
    setError(null);
    try {
      await requestJson(
        `/api/chat/conversations/${encodeURIComponent(selectedId)}`,
        { method: 'PATCH', body: JSON.stringify(payload) },
      );
      if (payload.action === 'leave') {
        goBack();
        return true;
      }
      await loadConversation(selectedId, { mark: true, busy: false });
      await loadBootstrap();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el grupo.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  function openGroupSettings() {
    if (!snapshot || snapshot.type !== 'GRUPO') return;
    setGroupSettingsTitle(snapshot.title);
    setGroupManageQuery('');
    setView('settings');
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
    stickerId?: string;
    mediaUrl?: string;
    mediaPageUrl?: string;
    mediaSource?: 'TENOR' | 'WIKIMEDIA_COMMONS';
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
    if (editingMessage) {
      if (!text) return;
      await stopTyping();
      await editMessage(editingMessage.id, text);
      return;
    }

    const file = pendingFile;
    if (!text && !context && !file) return;
    setBody('');
    setPendingFile(null);
    const attached = context;
    const quoted = replyTo;
    setContext(null);
    setReplyTo(null);
    await stopTyping();

    if (file) {
      await uploadAttachment(file, text || undefined, quoted?.id);
      if (attached) {
        await postMessage({
          contextLabel: attached.label,
          contextHref: attached.href,
        });
      }
      return;
    }

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

  function insertMentionToken(token: string) {
    if (!mentionState) return;
    const next = `${body.slice(0, mentionState.start)}@${token} `;
    setBody(next.slice(0, CHAT_BODY_MAX));
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function insertMention(person: ChatPerson) {
    insertMentionToken(person.username);
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
    setPlusOpen(false);
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
    setEditingMessage(null);
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
            onClick={() => {
              if (view === 'settings') {
                setView('conversation');
                return;
              }
              goBack();
            }}
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
                    : view === 'settings'
                      ? 'Información del grupo'
                      : 'Chat operativo'}
          </p>
          <p className="truncate text-[0.7rem] text-slate-500">
            {view === 'conversation' && snapshot
              ? `${snapshot.participants.length} participante${snapshot.participants.length === 1 ? '' : 's'}`
              : view === 'settings' && snapshot
                ? snapshot.title
                : 'Mensajería interna del Libro'}
          </p>
        </div>
        {view === 'conversation' && snapshot?.type === 'GRUPO' ? (
          <button
            type="button"
            onClick={openGroupSettings}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Información del grupo"
            title="Información del grupo"
          >
            <Users className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        {view === 'conversation' ? (
          <button
            type="button"
            onClick={() => {
              setConversationSearchOpen((value) => !value);
              if (conversationSearchOpen) setConversationQuery('');
            }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Buscar en esta conversación"
            title="Buscar en esta conversación"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
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

      {view === 'conversation' && conversationSearchOpen ? (
        <div className="shrink-0 border-b border-slate-100 bg-white px-3 py-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.target.value)}
              placeholder="Buscar dentro del chat…"
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-base outline-none focus:border-petrol-400 focus:bg-white sm:text-sm"
            />
            {conversationQuery ? (
              <button
                type="button"
                onClick={() => setConversationQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>
      ) : null}

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
                ['saved', '★ GUARDADOS'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setHomeTab(tab);
                    setQuery('');
                    if (tab === 'saved') void loadSavedMessages();
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
                  placeholder={
                    homeTab === 'online'
                      ? 'Buscar persona…'
                      : homeTab === 'saved'
                        ? 'Buscar guardados…'
                        : 'Buscar conversación…'
                  }
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
            ) : homeTab === 'saved' ? (
              savedLoading ? (
                <p className="p-6 text-center text-sm text-slate-500">Cargando guardados…</p>
              ) : savedItems.filter((item) => {
                  const needle = query.trim().toLocaleLowerCase('es-CL');
                  if (!needle) return true;
                  return [item.body, item.senderName, item.conversationTitle]
                    .filter(Boolean)
                    .some((value) => String(value).toLocaleLowerCase('es-CL').includes(needle));
                }).length === 0 ? (
                <div className="p-8 text-center">
                  <Star className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-sm font-medium text-slate-700">No hay mensajes guardados</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Usa la estrella de cualquier mensaje para encontrarlo aquí después.
                  </p>
                </div>
              ) : (
                savedItems
                  .filter((item) => {
                    const needle = query.trim().toLocaleLowerCase('es-CL');
                    if (!needle) return true;
                    return [item.body, item.senderName, item.conversationTitle]
                      .filter(Boolean)
                      .some((value) => String(value).toLocaleLowerCase('es-CL').includes(needle));
                  })
                  .map((item) => (
                    <button
                      key={item.messageId}
                      type="button"
                      onClick={async () => {
                        await loadConversation(item.conversationId);
                        window.setTimeout(() => {
                          document.querySelector(`[data-chat-message-id="${item.messageId}"]`)?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          });
                        }, 100);
                      }}
                      className="flex w-full gap-3 border-b border-slate-100 px-3 py-3 text-left hover:bg-slate-50"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-700">
                        <Star className="h-4 w-4 fill-current" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                            {item.conversationTitle}
                          </span>
                          <span className="shrink-0 text-[0.66rem] text-slate-400">
                            {relativeActivity(item.savedAt)}
                          </span>
                        </span>
                        <span className="block truncate text-xs font-medium text-petrol-700">
                          {item.senderName}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-xs text-slate-500">
                          {item.body || (item.kind === 'GIF' ? 'GIF' : item.kind === 'STICKER' ? 'Sticker' : 'Mensaje')}
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

      {view === 'settings' && snapshot?.type === 'GRUPO' ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
          <div className="space-y-4">
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grupo</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={groupSettingsTitle}
                  onChange={(event) => setGroupSettingsTitle(event.target.value.slice(0, 80))}
                  disabled={snapshot.myRole === 'MIEMBRO'}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-base outline-none focus:border-petrol-400 disabled:bg-slate-100 sm:text-sm"
                />
                {snapshot.myRole !== 'MIEMBRO' ? (
                  <button
                    type="button"
                    disabled={loading || groupSettingsTitle.trim().length < 2 || groupSettingsTitle.trim() === snapshot.title}
                    onClick={() => void manageGroup({ action: 'rename', title: groupSettingsTitle })}
                    className="rounded-xl bg-petrol-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    title="Guardar nombre del grupo"
                  >
                    Guardar
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void manageGroup({
                  action: 'mute',
                  muted: !snapshot.mutedUntil,
                })}
                className="mt-3 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {snapshot.mutedUntil ? '🔔 Activar notificaciones del grupo' : '🔕 Silenciar notificaciones del grupo'}
              </button>
            </section>

            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Participantes · {snapshot.participants.length}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {snapshot.participants.map((person) => {
                  const canManage = snapshot.myRole === 'CREADOR' || snapshot.myRole === 'ADMIN';
                  const targetProtected = person.conversationRole === 'CREADOR';
                  return (
                    <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-petrol-50 text-xl">
                        {avatarGlyph(person.avatarKey)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {person.name}{person.id === currentUserId ? ' · Tú' : ''}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          @{person.username} · {person.conversationRole === 'CREADOR' ? 'Creador' : person.conversationRole === 'ADMIN' ? 'Administrador' : 'Miembro'}
                        </span>
                      </span>
                      {canManage && person.id !== currentUserId && !targetProtected ? (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => void manageGroup({
                              action: person.conversationRole === 'ADMIN' ? 'demote' : 'promote',
                              userId: person.id,
                            })}
                            className="rounded-lg bg-slate-100 px-2 py-1 text-[0.65rem] font-semibold text-slate-600 hover:bg-slate-200"
                          >
                            {person.conversationRole === 'ADMIN' ? 'Miembro' : 'Admin'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void manageGroup({ action: 'remove', userId: person.id })}
                            className="rounded-lg bg-rose-50 px-2 py-1 text-[0.65rem] font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            Quitar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            {snapshot.myRole !== 'MIEMBRO' ? (
              <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agregar personas</p>
                <label className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    value={groupManageQuery}
                    onChange={(event) => setGroupManageQuery(event.target.value)}
                    placeholder="Buscar persona…"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-base outline-none focus:border-petrol-400 sm:text-sm"
                  />
                </label>
                <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-slate-100">
                  {(bootstrap?.people ?? [])
                    .filter((person) => !snapshot.participants.some((item) => item.id === person.id))
                    .filter((person) => {
                      const needle = groupManageQuery.trim().toLocaleLowerCase('es-CL');
                      return !needle ||
                        person.name.toLocaleLowerCase('es-CL').includes(needle) ||
                        person.username.toLocaleLowerCase('es-CL').includes(needle);
                    })
                    .slice(0, 12)
                    .map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => void manageGroup({ action: 'add', userId: person.id })}
                        className="flex w-full items-center gap-2 px-1 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-petrol-50 text-lg">
                          {avatarGlyph(person.avatarKey)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{person.name}</span>
                          <span className="block truncate text-xs text-slate-500">@{person.username}</span>
                        </span>
                        <Plus className="h-4 w-4 text-petrol-700" aria-hidden="true" />
                      </button>
                    ))}
                </div>
              </section>
            ) : null}

            <button
              type="button"
              disabled={loading}
              onClick={() => void manageGroup({ action: 'leave' })}
              className="w-full rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 disabled:opacity-40"
            >
              Salir del grupo
            </button>
          </div>
        </div>
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
              {conversationQuery.trim() && visibleMessages.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  No hay mensajes que coincidan con «{conversationQuery.trim()}».
                </div>
              ) : null}
              {visibleMessages.map((message) => {
                const mine = message.senderId === currentUserId;
                const stickerGlyph = chatStickerGlyph(message.stickerKey);
                const customStickerUrl = message.stickerId ? `/api/chat/stickers/${message.stickerId}` : null;
                const sticker = Boolean(stickerGlyph || customStickerUrl);
                const gif = message.kind === 'GIF' && Boolean(message.mediaUrl);
                const bubbleClass = sticker || gif
                  ? 'px-2 py-1'
                  : mine
                    ? 'rounded-2xl rounded-br-md bg-petrol-800 px-3 py-2 text-white'
                    : 'rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-800 shadow-sm ring-1 ring-slate-100';

                return (
                  <div
                    key={message.id}
                    data-chat-message-id={message.id}
                    className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="max-w-[88%] sm:max-w-[84%]">
                      <div className={bubbleClass}>
                        {!mine && !sticker && !gif ? (
                          <p className="mb-0.5 text-[0.67rem] font-semibold text-petrol-700">
                            {message.senderName}
                          </p>
                        ) : null}

                        {message.replyTo ? (
                          <button
                            type="button"
                            className={`mb-2 block w-full rounded-lg border-l-2 px-2 py-1.5 text-left text-[0.72rem] ${
                              mine
                                ? 'border-gold-300 bg-white/10 text-petrol-50'
                                : 'border-petrol-500 bg-slate-50 text-slate-600'
                            }`}
                            title="Mensaje respondido"
                          >
                            <span className="block font-semibold">{message.replyTo.senderName}</span>
                            <span className="block truncate">
                              {message.replyTo.body || (message.replyTo.kind === 'GIF' ? 'GIF' : 'Mensaje')}
                            </span>
                          </button>
                        ) : null}

                        {sticker ? (
                          <div className="text-center">
                            {customStickerUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={customStickerUrl}
                                alt="Sticker"
                                loading="lazy"
                                className="mx-auto max-h-44 max-w-[180px] object-contain"
                              />
                            ) : (
                              <span className="text-5xl" role="img" aria-label="Sticker">{stickerGlyph}</span>
                            )}
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
                                {message.mediaSource === 'WIKIMEDIA_COMMONS' ? 'Wikimedia Commons' : 'Fuente del GIF'}
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            {message.body ? (
                              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{renderMessageBody(message.body)}</p>
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
                            {message.attachments.map((attachment) =>
                              attachment.mimeType.startsWith('image/') ? (
                                <div key={attachment.id} className="mt-2 overflow-hidden rounded-xl bg-black/5">
                                  <a
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={attachment.url}
                                      alt={attachment.fileName}
                                      loading="lazy"
                                      className="max-h-72 w-full object-contain"
                                    />
                                  </a>
                                  {storageAvailable ? (
                                    <button
                                      type="button"
                                      onClick={() => void createStickerFromAttachment(attachment)}
                                      className="block w-full border-t border-black/5 px-2 py-1.5 text-center text-[0.68rem] font-semibold hover:bg-black/5"
                                    >
                                      Crear sticker
                                    </button>
                                  ) : null}
                                </div>
                              ) : attachment.mimeType.startsWith('audio/') ? (
                                <div key={attachment.id} className="mt-2 rounded-xl bg-black/5 p-2">
                                  <audio controls preload="metadata" src={attachment.url} className="max-w-full" />
                                </div>
                              ) : (
                                <a
                                  key={attachment.id}
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-xs hover:bg-black/10"
                                >
                                  <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                                </a>
                              ),
                            )}
                          </>
                        )}

                        {!sticker && !gif ? (
                          <div className={`mt-1 flex items-center justify-end gap-1 text-[0.6rem] ${
                            mine ? 'text-petrol-100' : 'text-slate-400'
                          }`}>
                            <span>
                              {new Intl.DateTimeFormat('es-CL', {
                                timeZone: 'America/Santiago',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              }).format(new Date(message.createdAt))}
                            </span>
                            {mine ? (
                              message.readBy.length > 0
                                ? <CheckCheck className="h-3 w-3" aria-label={`Leído por ${message.readBy.length}`} />
                                : <Check className="h-3 w-3" aria-label="Enviado" />
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {message.reactions.length > 0 ? (
                        <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {message.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              onClick={() => void toggleReaction(message.id, reaction.emoji)}
                              title={reaction.users.map((item) => item.name).join(', ')}
                              className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                                reaction.mine
                                  ? 'bg-petrol-50 text-petrol-800 ring-petrol-200'
                                  : 'bg-white text-slate-600 ring-slate-200'
                              }`}
                            >
                              {reaction.emoji} {reaction.count}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className={`mt-1 flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${mine ? 'justify-end' : 'justify-start'}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo(message);
                            composerRef.current?.focus();
                          }}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-petrol-700"
                          title="Responder"
                          aria-label="Responder"
                        >
                          <Reply className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setReactionMessageId((current) => current === message.id ? null : message.id)}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-petrol-700"
                          title="Reaccionar"
                          aria-label="Reaccionar"
                        >
                          <Smile className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleSaved(message.id)}
                          className={`rounded-md p-1.5 hover:bg-white ${message.saved ? 'text-gold-600' : 'text-slate-400 hover:text-gold-600'}`}
                          title={message.saved ? 'Quitar de guardados' : 'Guardar mensaje'}
                          aria-label={message.saved ? 'Quitar de guardados' : 'Guardar mensaje'}
                        >
                          <Star className={`h-3.5 w-3.5 ${message.saved ? 'fill-current' : ''}`} aria-hidden="true" />
                        </button>
                        {mine && message.body && ['TEXTO', 'CONTEXTO', 'ARCHIVO'].includes(message.kind) ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessage(message);
                              setReplyTo(null);
                              setBody(message.body ?? '');
                              window.requestAnimationFrame(() => composerRef.current?.focus());
                            }}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-petrol-700"
                            title="Editar mensaje"
                            aria-label="Editar mensaje"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                        {mine ? (
                          <button
                            type="button"
                            onClick={() => void deleteMessage(message.id)}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                            title="Eliminar mensaje"
                            aria-label="Eliminar mensaje"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>

                      {reactionMessageId === message.id ? (
                        <div className={`mt-1 flex gap-1 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200 ${mine ? 'ml-auto' : 'mr-auto'} w-fit`}>
                          {['👍','😂','💀','👀','❤️','😭','🤡'].map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => void toggleReaction(message.id, emoji)}
                              className="rounded-full p-1 text-lg hover:bg-slate-100"
                              aria-label={`Reaccionar con ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {mine && message.readBy.length > 0 ? (
                        <p className="mt-0.5 text-right text-[0.6rem] text-slate-400" title={message.readBy.map((item) => item.name).join(', ')}>
                          Leído por {message.readBy.length}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {snapshot.typing.length > 0 ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-white px-3 py-2 text-xs italic text-slate-500 shadow-sm ring-1 ring-slate-100">
                    {snapshot.typing.length === 1
                      ? `${snapshot.typing[0]?.name} está escribiendo…`
                      : `${snapshot.typing.slice(0, 2).map((item) => item.name).join(' y ')} están escribiendo…`}
                  </div>
                </div>
              ) : null}
              <div ref={listEndRef} />
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            {recording ? (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden="true" />
                <span className="min-w-0 flex-1 font-medium">
                  Grabando nota de voz · {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={() => stopVoiceRecording(false)}
                  className="rounded-lg bg-rose-700 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  Enviar grabación
                </button>
                <button
                  type="button"
                  onClick={() => stopVoiceRecording(true)}
                  className="rounded-lg p-1.5 text-rose-700 hover:bg-rose-100"
                  aria-label="Cancelar grabación"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {editingMessage ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-gold-500 bg-gold-50 px-2.5 py-2 text-xs text-slate-700">
                <Pencil className="h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Editando mensaje</span>
                  <span className="block truncate">{editingMessage.body}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingMessage(null);
                    setBody('');
                  }}
                  className="rounded p-1 hover:bg-gold-100"
                  aria-label="Cancelar edición"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {replyTo && !editingMessage ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-petrol-500 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                <Reply className="h-4 w-4 shrink-0 text-petrol-700" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{replyTo.senderName}</span>
                  <span className="block truncate">{replyTo.body || (replyTo.kind === 'GIF' ? 'GIF' : 'Mensaje')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="rounded p-1 hover:bg-slate-200"
                  aria-label="Cancelar respuesta"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {context ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-petrol-50 px-2.5 py-2 text-xs text-petrol-800">
                <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{context.label}</span>
                <button type="button" onClick={() => setContext(null)} className="rounded p-1 hover:bg-petrol-100" aria-label="Quitar contexto">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {pendingFile ? (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                {pendingPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pendingPreview}
                    alt={pendingFile.name}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200">
                    <Paperclip className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{pendingFile.name}</span>
                  <span className="block text-xs text-slate-500">{Math.max(1, Math.round(pendingFile.size / 1024))} KB</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700"
                  aria-label="Quitar archivo pendiente"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {mentionState && (mentionState.candidates.length > 0 || snapshot?.type === 'GRUPO') ? (
              <div className="mb-2 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                  <AtSign className="h-3.5 w-3.5" aria-hidden="true" />
                  Mencionar
                </div>
                {snapshot?.type === 'GRUPO' &&
                (!body.slice(mentionState.start + 1).trim() ||
                  'todos'.startsWith(body.slice(mentionState.start + 1).trim().toLocaleLowerCase('es-CL'))) ? (
                  <button
                    type="button"
                    onClick={() => insertMentionToken('todos')}
                    className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-50 text-sm">👥</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">@todos</span>
                      <span className="block text-xs text-slate-500">Todos los integrantes del grupo</span>
                    </span>
                  </button>
                ) : null}
                {snapshot?.type === 'GRUPO' &&
                (!body.slice(mentionState.start + 1).trim() ||
                  'turno'.startsWith(body.slice(mentionState.start + 1).trim().toLocaleLowerCase('es-CL'))) ? (
                  <button
                    type="button"
                    onClick={() => insertMentionToken('turno')}
                    className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-sm">🟢</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">@turno</span>
                      <span className="block text-xs text-slate-500">@turno · quienes están trabajando ahora</span>
                    </span>
                  </button>
                ) : null}
                {mentionState.candidates.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => insertMention(person)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                    aria-label="Seleccionar mención"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-petrol-50 text-base">
                      {avatarGlyph(person.avatarKey)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{person.name}</span>
                      <span className="block truncate text-xs text-slate-500">@{person.username}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {plusOpen ? (
              <div className="mb-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setGifsOpen(true);
                    setGifTab('search');
                    setPlusOpen(false);
                    setEmojisOpen(false);
                    setStickersOpen(false);
                    void loadGifPreferences();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <ImageIcon className="h-5 w-5 text-petrol-700" aria-hidden="true" />
                  GIF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStickersOpen(true);
                    setPlusOpen(false);
                    setEmojisOpen(false);
                    setGifsOpen(false);
                    void loadStickerLibrary();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <span className="text-lg" aria-hidden="true">🖼️</span>
                  Stickers
                </button>
                <button
                  type="button"
                  disabled={!storageAvailable}
                  onClick={() => {
                    setPlusOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Paperclip className="h-5 w-5 text-petrol-700" aria-hidden="true" />
                  Foto / archivo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    attachCurrentContext();
                    setPlusOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <Link2 className="h-5 w-5 text-petrol-700" aria-hidden="true" />
                  Compartir Libro
                </button>
                <button
                  type="button"
                  disabled={!storageAvailable || recording}
                  onClick={() => void startVoiceRecording()}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Mic className="h-5 w-5 text-petrol-700" aria-hidden="true" />
                  Nota de voz
                </button>
                {!storageAvailable ? (
                  <p className="col-span-2 text-center text-[0.68rem] text-slate-500">
                    Fotos, archivos y stickers propios se activarán al conectar Cloudflare R2.
                  </p>
                ) : null}
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
              <div className="mb-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <div className="mb-2 flex items-center gap-1 overflow-x-auto">
                  {([
                    ['favorites', '⭐ Favoritos'],
                    ['recent', 'Recientes'],
                    ['mine', 'Míos'],
                    ['all', 'Todos'],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setStickerTab(tab)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${
                        stickerTab === tab ? 'bg-petrol-800 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!storageAvailable || uploading}
                    onClick={() => stickerInputRef.current?.click()}
                    className="ml-auto shrink-0 rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-petrol-700 ring-1 ring-slate-200 disabled:opacity-40"
                  >
                    + Crear
                  </button>
                </div>
                <input
                  ref={stickerInputRef}
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void createStickerFromFile(file);
                  }}
                />
                <div className="max-h-52 overflow-y-auto">
                  {!storageAvailable ? (
                    <p className="py-5 text-center text-xs text-slate-500">
                      Activa R2 para crear stickers desde fotos o imágenes.
                    </p>
                  ) : visibleCustomStickers.length === 0 ? (
                    <div className="py-5 text-center">
                      <p className="text-xs text-slate-500">Todavía no hay stickers aquí.</p>
                      <button
                        type="button"
                        onClick={() => stickerInputRef.current?.click()}
                        className="mt-2 text-xs font-semibold text-petrol-700 hover:underline"
                      >
                        Crear el primero desde una imagen
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {visibleCustomStickers.map((sticker) => (
                        <div key={sticker.id} className="group/sticker relative rounded-xl bg-white p-1 ring-1 ring-slate-200">
                          <button
                            type="button"
                            onClick={() => {
                              setStickersOpen(false);
                              void postMessage({
                                stickerId: sticker.id,
                                replyToId: replyTo?.id,
                              });
                              setReplyTo(null);
                            }}
                            className="flex aspect-square w-full items-center justify-center"
                            title={sticker.label || 'Sticker'}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={sticker.url}
                              alt={sticker.label || 'Sticker'}
                              loading="lazy"
                              className="max-h-full max-w-full object-contain"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleMediaFavorite('sticker', sticker.id)}
                            className={`absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow-sm ${
                              sticker.favorite ? 'text-gold-600' : 'text-slate-400'
                            }`}
                            aria-label={sticker.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                          >
                            <Star className={`h-3 w-3 ${sticker.favorite ? 'fill-current' : ''}`} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {gifsOpen ? (
              <div className="mb-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <div className="mb-2 flex gap-1">
                  {([
                    ['search', 'Buscar'],
                    ['favorites', '⭐ Favoritos'],
                    ['recent', 'Recientes'],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setGifTab(tab);
                        if (tab !== 'search') void loadGifPreferences();
                      }}
                      className={`rounded-full px-2.5 py-1 text-[0.68rem] font-semibold ${
                        gifTab === tab ? 'bg-petrol-800 text-white' : 'bg-white text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {gifTab === 'search' ? (
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      value={gifQuery}
                      onChange={(event) => setGifQuery(event.target.value)}
                      placeholder="Buscar GIF…"
                      autoFocus
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-base outline-none focus:border-petrol-400 sm:text-sm"
                    />
                  </label>
                ) : null}

                <div className="mt-2 max-h-56 overflow-y-auto">
                  {gifTab === 'search' && gifLoading ? (
                    <p className="py-6 text-center text-xs text-slate-500">Buscando GIF…</p>
                  ) : gifTab === 'search' && gifQuery.trim().length < 2 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      Busca algo o abre Favoritos/Recientes.
                    </p>
                  ) : (
                    (() => {
                      const items = gifTab === 'search' ? gifItems : savedGifItems;
                      if (items.length === 0) {
                        return <p className="py-6 text-center text-xs text-slate-500">No hay GIF aquí todavía.</p>;
                      }
                      return (
                        <div className="grid grid-cols-3 gap-2">
                          {items.map((gif) => {
                            const favorite = gifPreferences.some((item) => item.refKey === gif.url && item.favorite);
                            return (
                              <div key={gif.url} className="group/gif relative overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                                <button
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
                                      replyToId: replyTo?.id,
                                    });
                                    setReplyTo(null);
                                  }}
                                  className="block w-full"
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
                                <button
                                  type="button"
                                  onClick={() => void toggleMediaFavorite('gif', gif.url, gif)}
                                  className={`absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow-sm ${
                                    favorite ? 'text-gold-600' : 'text-slate-500'
                                  }`}
                                  aria-label={favorite ? 'Quitar GIF de favoritos' : 'Agregar GIF a favoritos'}
                                >
                                  <Star className={`h-3 w-3 ${favorite ? 'fill-current' : ''}`} aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            ) : null}

            <div
              className="flex items-end gap-1"
              onDragOver={(event) => {
                if (storageAvailable) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!storageAvailable) return;
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (file) selectIncomingFile(file);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,.docx,.xlsx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) selectIncomingFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setEmojisOpen((value) => !value);
                  setPlusOpen(false);
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
                  setPlusOpen((value) => !value);
                  setEmojisOpen(false);
                  setStickersOpen(false);
                  setGifsOpen(false);
                }}
                className={`shrink-0 rounded-lg p-2 hover:bg-slate-100 hover:text-petrol-800 ${
                  plusOpen ? 'bg-slate-100 text-petrol-800' : 'text-slate-500'
                }`}
                aria-label="Más opciones"
                title="Más opciones"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
              <textarea
                ref={composerRef}
                value={body}
                onChange={(event) => {
                  const next = event.target.value.slice(0, CHAT_BODY_MAX);
                  setBody(next);
                  signalTyping(next);
                }}
                onPaste={(event) => {
                  const image = Array.from(event.clipboardData.files).find((file) =>
                    file.type.startsWith('image/'),
                  );
                  if (image) {
                    event.preventDefault();
                    selectIncomingFile(image);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder={editingMessage ? "Editar mensaje…" : "Mensaje…"}
                className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base outline-none focus:border-petrol-400 focus:bg-white sm:text-sm"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={uploading || (!body.trim() && !context && !pendingFile)}
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
