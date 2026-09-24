export const CHAT_BODY_MAX = 4000;
export const CHAT_GROUP_TITLE_MAX = 80;
export const CHAT_HISTORY_LIMIT = 80;
export const CHAT_DIRECTORY_LIMIT = 80;
export const CHAT_STATUS_MAX = 80;

export const CHAT_STICKERS = [
  { key: 'ok', glyph: '✅', label: 'Listo' },
  { key: 'eyes', glyph: '👀', label: 'Visto' },
  { key: 'alert', glyph: '🚨', label: 'Atención' },
  { key: 'laugh', glyph: '😂', label: 'Jajaja' },
  { key: 'rofl', glyph: '🤣', label: 'Me muero' },
  { key: 'clap', glyph: '👏', label: 'Bien' },
  { key: 'heart', glyph: '❤️', label: 'Corazón' },
  { key: 'sparkles', glyph: '✨', label: 'Brillitos' },
  { key: 'fire', glyph: '🔥', label: 'Fuego' },
  { key: 'party', glyph: '🥳', label: 'Fiesta' },
  { key: 'salute', glyph: '🫡', label: 'Entendido' },
  { key: 'thinking', glyph: '🤔', label: 'Pensando' },
  { key: 'shock', glyph: '😱', label: 'Impacto' },
  { key: 'cry', glyph: '😭', label: 'Llanto' },
  { key: 'coffee', glyph: '☕', label: 'Café' },
  { key: 'mate', glyph: '🧉', label: 'Mate' },
  { key: 'night', glyph: '🌙', label: 'Noche' },
  { key: 'sun', glyph: '☀️', label: 'Día' },
  { key: 'bell', glyph: '🛎️', label: 'Recepción' },
  { key: 'key', glyph: '🔑', label: 'Llave' },
  { key: 'money', glyph: '💵', label: 'Caja' },
  { key: 'hotel', glyph: '🏨', label: 'Hotel' },
  { key: 'dragon', glyph: '🐉', label: 'Dragón' },
  { key: 'panda', glyph: '🐼', label: 'Panda' },
  { key: 'cat', glyph: '🐱', label: 'Gato' },
  { key: 'alien', glyph: '👽', label: 'Alien' },
  { key: 'ghost', glyph: '👻', label: 'Fantasma' },
  { key: 'robot', glyph: '🤖', label: 'Robot' },
  { key: 'mahjong', glyph: '🀄', label: 'Mahjong' },
  { key: 'dumpling', glyph: '🥟', label: 'Dumpling' },
  { key: 'ramen', glyph: '🍜', label: 'Ramen' },
  { key: 'tea', glyph: '🍵', label: 'Té' },
] as const;

export const CHAT_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂','🙃','😉','😍','🥰','😘','😎',
  '🤓','🧐','🤔','🫡','🤨','😐','😑','🙄','😬','😴','🥱','😵‍💫','😱','😭','😤','🤬',
  '🤯','🥳','😈','👻','👽','🤖','💀','💩','👍','👎','👌','✌️','🤞','🤟','🤙','👏',
  '🙌','🫶','🙏','💪','👀','🧠','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','✨',
  '🔥','⚡','💥','💯','✅','❌','⚠️','🚨','🛎️','🔑','💵','💳','🏨','🛏️','🧳','🧹',
  '☕','🧉','🍵','🧋','🥟','🍜','🍣','🍚','🐉','🐲','🐼','🐯','🐰','🦊','🐱','🐶',
  '🐸','🐧','🐙','🦄','🌸','🌙','☀️','⭐','🍀','🎉','🎊','🀄','🎭','🎯','🚀',
] as const;

export const CHAT_AVATARS = [
  { key: 'dragon', glyph: '🐉', label: 'Dragón' },
  { key: 'dragonface', glyph: '🐲', label: 'Dragón oriental' },
  { key: 'panda', glyph: '🐼', label: 'Panda' },
  { key: 'tiger', glyph: '🐯', label: 'Tigre' },
  { key: 'rabbit', glyph: '🐰', label: 'Conejo' },
  { key: 'rat', glyph: '🐭', label: 'Rata' },
  { key: 'ox', glyph: '🐂', label: 'Buey' },
  { key: 'snake', glyph: '🐍', label: 'Serpiente' },
  { key: 'horse', glyph: '🐎', label: 'Caballo' },
  { key: 'goat', glyph: '🐐', label: 'Cabra' },
  { key: 'monkey', glyph: '🐒', label: 'Mono' },
  { key: 'rooster', glyph: '🐓', label: 'Gallo' },
  { key: 'dog', glyph: '🐶', label: 'Perro' },
  { key: 'pig', glyph: '🐷', label: 'Cerdo' },
  { key: 'fox', glyph: '🦊', label: 'Zorro' },
  { key: 'cat', glyph: '🐱', label: 'Gato' },
  { key: 'frog', glyph: '🐸', label: 'Rana' },
  { key: 'penguin', glyph: '🐧', label: 'Pingüino' },
  { key: 'octopus', glyph: '🐙', label: 'Pulpo' },
  { key: 'unicorn', glyph: '🦄', label: 'Unicornio' },
  { key: 'robot', glyph: '🤖', label: 'Robot' },
  { key: 'alien', glyph: '👽', label: 'Alien' },
  { key: 'ghost', glyph: '👻', label: 'Fantasma' },
  { key: 'mask', glyph: '🎭', label: 'Máscaras' },
  { key: 'mahjong', glyph: '🀄', label: 'Mahjong' },
  { key: 'lantern', glyph: '🏮', label: 'Farol rojo' },
  { key: 'redenvelope', glyph: '🧧', label: 'Sobre rojo' },
  { key: 'fan', glyph: '🪭', label: 'Abanico' },
  { key: 'dumpling', glyph: '🥟', label: 'Dumpling' },
  { key: 'ramen', glyph: '🍜', label: 'Fideos' },
  { key: 'rice', glyph: '🍚', label: 'Arroz' },
  { key: 'mooncake', glyph: '🥮', label: 'Pastel de luna' },
  { key: 'tea', glyph: '🍵', label: 'Té' },
  { key: 'bubbletea', glyph: '🧋', label: 'Bubble tea' },
  { key: 'cherry', glyph: '🌸', label: 'Flor' },
  { key: 'lotus', glyph: '🪷', label: 'Loto' },
  { key: 'bamboo', glyph: '🎋', label: 'Bambú' },
  { key: 'moon', glyph: '🌙', label: 'Luna' },
  { key: 'star', glyph: '⭐', label: 'Estrella' },
  { key: 'fire', glyph: '🔥', label: 'Fuego' },
  { key: 'lightning', glyph: '⚡', label: 'Rayo' },
  { key: 'clover', glyph: '🍀', label: 'Trébol' },
  { key: 'sparkles', glyph: '✨', label: 'Brillos' },
  { key: 'hotel', glyph: '🏨', label: 'Hotel' },
  { key: 'bell', glyph: '🛎️', label: 'Campana' },
  { key: 'key', glyph: '🔑', label: 'Llave' },
  { key: 'money', glyph: '💵', label: 'Caja' },
  { key: 'rocket', glyph: '🚀', label: 'Cohete' },
  { key: 'crown', glyph: '👑', label: 'Corona' },
  { key: 'sunglasses', glyph: '😎', label: 'Flow' },
  { key: 'salute', glyph: '🫡', label: 'En servicio' },
  { key: 'brain', glyph: '🧠', label: 'Cerebro' },
  { key: 'heart', glyph: '❤️', label: 'Corazón' },
] as const;

export const CHAT_NOTIFICATION_TONES = [
  { key: 'chime', label: 'Campanilla' },
  { key: 'ping', label: 'Ping' },
  { key: 'pop', label: 'Pop' },
  { key: 'bell', label: 'Campana' },
  { key: 'bamboo', label: 'Bambú' },
] as const;

export type ChatStickerKey = (typeof CHAT_STICKERS)[number]['key'];
export type ChatAvatarKey = (typeof CHAT_AVATARS)[number]['key'];
export type ChatNotificationTone = (typeof CHAT_NOTIFICATION_TONES)[number]['key'];

export type ChatProfile = {
  avatarKey: string;
  statusText: string | null;
  notificationTone: string;
  soundEnabled: boolean;
};

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
  avatarKey: string;
  statusText: string | null;
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
    mediaUrl: string | null;
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

export type ChatReactionSummary = {
  emoji: string;
  count: number;
  mine: boolean;
  users: Array<{ id: string; name: string }>;
};

export type ChatReplyPreview = {
  id: string;
  senderName: string;
  body: string | null;
  kind: string;
};

export type ChatReadReceipt = {
  userId: string;
  name: string;
  readAt: string;
};

export type ChatMessageItem = {
  id: string;
  kind: string;
  body: string | null;
  stickerKey: string | null;
  stickerId: string | null;
  mediaUrl: string | null;
  mediaPageUrl: string | null;
  mediaSource: string | null;
  mediaAlt: string | null;
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
  replyTo: ChatReplyPreview | null;
  reactions: ChatReactionSummary[];
  saved: boolean;
  readBy: ChatReadReceipt[];
  attachments: ChatAttachmentMeta[];
};

export type ChatConversationSnapshot = {
  id: string;
  type: 'DIRECTO' | 'GRUPO';
  title: string;
  participants: ChatPerson[];
  messages: ChatMessageItem[];
  typing: Array<{ userId: string; name: string; updatedAt: string }>;
  generatedAt: string;
};

export type ChatBootstrap = {
  conversations: ChatConversationListItem[];
  people: ChatPerson[];
  profile: ChatProfile;
  totalUnread: number;
  generatedAt: string;
};

export type ChatGifItem = {
  title: string;
  url: string;
  pageUrl: string;
  width: number | null;
  height: number | null;
  source: 'WIKIMEDIA_COMMONS';
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

export function normalizeChatStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, CHAT_STATUS_MAX) : null;
}

export function normalizeInternalChatHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || href.length > 1200) return null;
  if (!href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

export function normalizeWikimediaMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    if (!['upload.wikimedia.org', 'commons.wikimedia.org'].includes(url.hostname)) return null;
    return url.toString().slice(0, 1800);
  } catch {
    return null;
  }
}

export function avatarGlyph(key: string | null | undefined): string {
  return CHAT_AVATARS.find((item) => item.key === key)?.glyph ?? '🐉';
}

export function isChatAvatarKey(value: unknown): value is ChatAvatarKey {
  return typeof value === 'string' && CHAT_AVATARS.some((item) => item.key === value);
}

export function isChatNotificationTone(value: unknown): value is ChatNotificationTone {
  return typeof value === 'string' && CHAT_NOTIFICATION_TONES.some((item) => item.key === value);
}

export function chatStickerGlyph(key: string | null | undefined): string | null {
  if (!key) return null;
  return CHAT_STICKERS.find((item) => item.key === key)?.glyph ?? null;
}

export function isChatStickerKey(value: unknown): value is ChatStickerKey {
  return typeof value === 'string' && CHAT_STICKERS.some((item) => item.key === value);
}
