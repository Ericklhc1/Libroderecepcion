export const CHAT_BODY_MAX = 4000;
export const CHAT_GROUP_TITLE_MAX = 80;
export const CHAT_HISTORY_LIMIT = 60;
export const CHAT_DIRECTORY_LIMIT = 80;

export const CHAT_STICKERS = [
  { key: 'ok', glyph: '✅', label: 'Listo' },
  { key: 'eyes', glyph: '👀', label: 'Visto' },
  { key: 'alert', glyph: '🚨', label: 'Atención' },
  { key: 'laugh', glyph: '😂', label: 'Jajaja' },
  { key: 'clap', glyph: '👏', label: 'Bien' },
  { key: 'coffee', glyph: '☕', label: 'Café' },
  { key: 'night', glyph: '🌙', label: 'Noche' },
  { key: 'bell', glyph: '🛎️', label: 'Recepción' },
] as const;

export type ChatStickerKey = (typeof CHAT_STICKERS)[number]['key'];

export type ChatPresence = {
  online: boolean;
  inShift: boolean;
  shiftType: 'DIA' | 'NOCHE' | null;
  lastSeenAt: string | null;
};

export type ChatPerson = {
  id: string;
  name: string;
  username: string;
  roleName: string;
  presence: ChatPresence;
};

export type ChatConversationListItem = {
  id: string;
  type: 'DIRECTO' | 'GRUPO';
  title: string;
  unreadCount: number;
  lastMessageAt: string;
  lastMessage: {
    id: string;
    kind: string;
    body: string | null;
    stickerKey: string | null;
    senderName: string;
    createdAt: string;
  } | null;
  counterpart: ChatPerson | null;
  participantCount: number;
};

export type ChatAttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type ChatMessageItem = {
  id: string;
  kind: string;
  body: string | null;
  stickerKey: string | null;
  contextLabel: string | null;
  contextHref: string | null;
  contextEntity: string | null;
  contextEntityId: string | null;
  senderId: string;
  senderName: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  replyToId: string | null;
  attachments: ChatAttachmentMeta[];
};

export type ChatConversationSnapshot = {
  id: string;
  type: 'DIRECTO' | 'GRUPO';
  title: string;
  participants: ChatPerson[];
  messages: ChatMessageItem[];
  generatedAt: string;
};

export type ChatBootstrap = {
  conversations: ChatConversationListItem[];
  people: ChatPerson[];
  totalUnread: number;
  generatedAt: string;
};

export function directConversationKey(a: string, b: string): string {
  return [a, b].sort((x, y) => x.localeCompare(y)).join(':');
}

export function normalizeChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text) return null;
  return text.slice(0, CHAT_BODY_MAX);
}

export function normalizeInternalChatHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || href.length > 1200) return null;
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

export function chatStickerGlyph(key: string | null | undefined): string | null {
  if (!key) return null;
  return CHAT_STICKERS.find((item) => item.key === key)?.glyph ?? null;
}

export function isChatStickerKey(value: unknown): value is ChatStickerKey {
  return typeof value === 'string' && CHAT_STICKERS.some((item) => item.key === value);
}
