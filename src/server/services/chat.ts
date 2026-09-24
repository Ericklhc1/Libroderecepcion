import 'server-only';

import {
  ChatConversationType,
  ChatMessageKind,
  ChatParticipantRole,
  NotificationType,
  ShiftStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { deleteR2Object, getR2Object, isR2Configured, makeChatStorageKey, putR2Object } from '@/server/storage/r2';
import {
  CHAT_DIRECTORY_LIMIT,
  CHAT_GROUP_TITLE_MAX,
  CHAT_HISTORY_LIMIT,
  avatarGlyph,
  chatStickerGlyph,
  directConversationKey,
  isChatAvatarKey,
  isChatNotificationTone,
  isChatStickerKey,
  normalizeChatMediaUrl,
  normalizeChatStatus,
  normalizeChatText,
  normalizeInternalChatHref,
  type ChatBootstrap,
  type ChatConversationListItem,
  type ChatConversationSnapshot,
  type ChatPerson,
  type ChatPresence,
  type ChatProfile,
} from '@/domain/chat';

const ONLINE_WINDOW_MS = 150_000;
const ACTIVE_SHIFT_STATUSES = [
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
  ShiftStatus.ENTREGA_ENVIADA,
  ShiftStatus.RECIBIDO,
];

const presenceSelect = (now: Date) =>
  ({
    id: true,
    name: true,
    username: true,
    updatedAt: true,
    chatAvatarKey: true,
    chatStatusText: true,
    chatNotificationTone: true,
    chatSoundEnabled: true,
    role: { select: { name: true } },
    sessions: {
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastSeenAt: 'desc' as const },
      take: 1,
      select: { lastSeenAt: true },
    },
    assignments: {
      where: {
        activatedAt: { not: null },
        leftAt: null,
        shift: {
          archivedAt: null,
          status: { in: ACTIVE_SHIFT_STATUSES },
        },
      },
      orderBy: { activatedAt: 'desc' as const },
      take: 1,
      select: {
        shiftId: true,
        shift: { select: { type: true } },
      },
    },
  }) satisfies Prisma.UserSelect;

type PresenceUser = Prisma.UserGetPayload<{ select: ReturnType<typeof presenceSelect> }>;

function assertChatActor(user: CurrentUser) {
  if (!user.roleOperational || user.isSystemAdmin) {
    throw new RuleError('El chat está disponible sólo para cuentas operativas.');
  }
}

function serializeProfile(user: PresenceUser): ChatProfile {
  return {
    avatarKey: user.chatAvatarKey,
    statusText: user.chatStatusText,
    notificationTone: user.chatNotificationTone,
    soundEnabled: user.chatSoundEnabled,
  };
}

function serializePresence(user: PresenceUser, now: Date): ChatPresence {
  const lastSeen = user.sessions[0]?.lastSeenAt ?? null;
  const assignment = user.assignments[0] ?? null;
  return {
    online: Boolean(lastSeen && now.getTime() - lastSeen.getTime() <= ONLINE_WINDOW_MS),
    inShift: Boolean(assignment),
    shiftType: assignment?.shift.type ?? null,
    lastSeenAt: lastSeen?.toISOString() ?? null,
  };
}

function serializePerson(user: PresenceUser, now: Date): ChatPerson {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    roleName: user.role.name,
    avatarKey: user.chatAvatarKey,
    statusText: user.chatStatusText,
    presence: serializePresence(user, now),
  };
}

async function assertParticipant(user: CurrentUser, conversationId: string) {
  assertChatActor(user);
  const participant = await prisma.chatParticipant.findFirst({
    where: { conversationId, userId: user.id, leftAt: null },
    select: { conversationId: true },
  });
  if (!participant) throw new NotFoundError('La conversación no existe o no tienes acceso.');
}

export async function touchChatPresence(user: CurrentUser): Promise<void> {
  assertChatActor(user);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 45_000);

  await prisma.session.updateMany({
    where: {
      id: user.sessionId,
      userId: user.id,
      revokedAt: null,
      expiresAt: { gt: now },
      lastSeenAt: { lt: staleBefore },
    },
    data: { lastSeenAt: now },
  });
}

export async function getChatUnreadCount(userId: string): Promise<number> {
  const result = await prisma.chatParticipant.aggregate({
    where: {
      userId,
      leftAt: null,
      conversation: { deletedAt: null },
    },
    _sum: { unreadCount: true },
  });
  return result._sum.unreadCount ?? 0;
}

export async function getChatProfileForUser(userId: string): Promise<ChatProfile> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      chatAvatarKey: true,
      chatStatusText: true,
      chatNotificationTone: true,
      chatSoundEnabled: true,
    },
  });
  return {
    avatarKey: row?.chatAvatarKey ?? 'dragon',
    statusText: row?.chatStatusText ?? null,
    notificationTone: row?.chatNotificationTone ?? 'chime',
    soundEnabled: row?.chatSoundEnabled ?? true,
  };
}

export async function listChatPeople(user: CurrentUser): Promise<ChatPerson[]> {
  assertChatActor(user);
  const now = new Date();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      id: { not: user.id },
      role: { operational: true },
    },
    select: presenceSelect(now),
    orderBy: [{ name: 'asc' }],
    take: CHAT_DIRECTORY_LIMIT,
  });
  return users.map((person) => serializePerson(person, now));
}

const conversationInclude = (now: Date) =>
  ({
    participants: {
      where: { leftAt: null },
      include: { user: { select: presenceSelect(now) } },
    },
    messages: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      include: { sender: { select: { name: true } } },
    },
  }) satisfies Prisma.ChatConversationInclude;

type ConversationWithListData = Prisma.ChatConversationGetPayload<{
  include: ReturnType<typeof conversationInclude>;
}>;

function serializeConversation(
  row: ConversationWithListData,
  viewerId: string,
  now: Date,
): ChatConversationListItem {
  const me = row.participants.find((item) => item.userId === viewerId);
  const others = row.participants.filter((item) => item.userId !== viewerId);
  const counterpart =
    row.type === ChatConversationType.DIRECTO && others[0]
      ? serializePerson(others[0].user, now)
      : null;
  const latest = row.messages[0] ?? null;

  return {
    id: row.id,
    type: row.type,
    title:
      row.type === ChatConversationType.DIRECTO
        ? counterpart?.name ?? 'Conversación'
        : row.title?.trim() || 'Grupo',
    unreadCount: me?.unreadCount ?? 0,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessage: latest
      ? {
          id: latest.id,
          kind: latest.kind,
          body: latest.body,
          stickerKey: latest.stickerKey,
          mediaUrl: latest.mediaUrl,
          senderName: latest.sender.name,
          createdAt: latest.createdAt.toISOString(),
        }
      : null,
    counterpart,
    participantCount: row.participants.length,
  };
}

export async function getChatBootstrap(user: CurrentUser): Promise<ChatBootstrap> {
  assertChatActor(user);
  const now = new Date();
  const [rows, people, totalUnread, me] = await Promise.all([
    prisma.chatConversation.findMany({
      where: {
        deletedAt: null,
        participants: { some: { userId: user.id, leftAt: null } },
      },
      include: conversationInclude(now),
      orderBy: [{ lastMessageAt: 'desc' }],
      take: 50,
    }),
    listChatPeople(user),
    getChatUnreadCount(user.id),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: presenceSelect(now),
    }),
  ]);

  return {
    conversations: rows.map((row) => serializeConversation(row, user.id, now)),
    people,
    profile: serializeProfile(me),
    totalUnread,
    storageEnabled: isR2Configured(),
    generatedAt: now.toISOString(),
  };
}

export async function getChatGlobalVersion(user: CurrentUser): Promise<string> {
  assertChatActor(user);
  const now = new Date();

  const typingCutoff = new Date(now.getTime() - 10_000);
  const [participations, people, typingRows] = await Promise.all([
    prisma.chatParticipant.findMany({
      where: {
        userId: user.id,
        leftAt: null,
        conversation: { deletedAt: null },
      },
      orderBy: { conversationId: 'asc' },
      select: {
        conversationId: true,
        unreadCount: true,
        lastReadAt: true,
        conversation: {
          select: {
            updatedAt: true,
            lastMessageAt: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        deletedAt: null,
        role: { operational: true },
      },
      orderBy: { id: 'asc' },
      select: presenceSelect(now),
      take: CHAT_DIRECTORY_LIMIT + 1,
    }),
    prisma.chatTyping.findMany({
      where: {
        userId: { not: user.id },
        updatedAt: { gt: typingCutoff },
        conversation: {
          deletedAt: null,
          participants: { some: { userId: user.id, leftAt: null } },
        },
      },
      orderBy: [{ conversationId: 'asc' }, { userId: 'asc' }],
      select: { conversationId: true, userId: true, updatedAt: true },
    }),
  ]);

  return JSON.stringify({
    c: participations.map((item) => [
      item.conversationId,
      item.unreadCount,
      item.lastReadAt?.toISOString() ?? null,
      item.conversation.updatedAt.toISOString(),
      item.conversation.lastMessageAt.toISOString(),
    ]),
    p: people.map((person) => [
      person.id,
      person.updatedAt.toISOString(),
      person.sessions[0]?.lastSeenAt?.toISOString() ?? null,
      person.assignments[0]?.shiftId ?? null,
      person.chatAvatarKey,
      person.chatStatusText,
      person.chatNotificationTone,
      person.chatSoundEnabled,
    ]),
    t: typingRows.map((item) => [
      item.conversationId,
      item.userId,
      item.updatedAt.toISOString(),
    ]),
  });
}

export async function updateOwnChatProfile(
  user: CurrentUser,
  input: {
    avatarKey?: unknown;
    statusText?: unknown;
    notificationTone?: unknown;
    soundEnabled?: unknown;
  },
): Promise<ChatProfile> {
  assertChatActor(user);

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      chatAvatarKey: true,
      chatStatusText: true,
      chatNotificationTone: true,
      chatSoundEnabled: true,
    },
  });

  const avatarKey = isChatAvatarKey(input.avatarKey) ? input.avatarKey : current.chatAvatarKey;
  const notificationTone = isChatNotificationTone(input.notificationTone)
    ? input.notificationTone
    : current.chatNotificationTone;
  const statusText =
    input.statusText === undefined ? current.chatStatusText : normalizeChatStatus(input.statusText);
  const soundEnabled =
    typeof input.soundEnabled === 'boolean' ? input.soundEnabled : current.chatSoundEnabled;

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      chatAvatarKey: avatarKey,
      chatStatusText: statusText,
      chatNotificationTone: notificationTone,
      chatSoundEnabled: soundEnabled,
    },
    select: {
      chatAvatarKey: true,
      chatStatusText: true,
      chatNotificationTone: true,
      chatSoundEnabled: true,
    },
  });

  return {
    avatarKey: updated.chatAvatarKey,
    statusText: updated.chatStatusText,
    notificationTone: updated.chatNotificationTone,
    soundEnabled: updated.chatSoundEnabled,
  };
}

export async function createOrGetDirectConversation(user: CurrentUser, targetUserId: string) {
  assertChatActor(user);
  if (!targetUserId || targetUserId === user.id) {
    throw new RuleError('Selecciona otra persona para iniciar la conversación.');
  }

  const target = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      active: true,
      deletedAt: null,
      role: { operational: true },
    },
    select: { id: true },
  });
  if (!target) throw new NotFoundError('La persona no está disponible para chat.');

  const directKey = directConversationKey(user.id, target.id);
  const existing = await prisma.chatConversation.findUnique({
    where: { directKey },
    select: { id: true },
  });
  if (existing) return existing;

  try {
    return await prisma.chatConversation.create({
      data: {
        type: ChatConversationType.DIRECTO,
        directKey,
        createdById: user.id,
        participants: {
          create: [
            { userId: user.id, role: ChatParticipantRole.CREADOR },
            { userId: target.id, role: ChatParticipantRole.MIEMBRO },
          ],
        },
      },
      select: { id: true },
    });
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (code === 'P2002') {
      const raced = await prisma.chatConversation.findUnique({
        where: { directKey },
        select: { id: true },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function createGroupConversation(
  user: CurrentUser,
  input: { title: string; userIds: string[] },
) {
  assertChatActor(user);
  const title = input.title.trim().slice(0, CHAT_GROUP_TITLE_MAX);
  if (title.length < 2) throw new RuleError('El grupo necesita un nombre.');

  const uniqueIds = Array.from(new Set(input.userIds.filter((id) => id && id !== user.id)));
  if (uniqueIds.length < 1) throw new RuleError('Agrega al menos una persona al grupo.');
  if (uniqueIds.length > 29) throw new RuleError('Un grupo admite hasta 30 participantes.');

  const available = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      active: true,
      deletedAt: null,
      role: { operational: true },
    },
    select: { id: true },
  });
  if (available.length !== uniqueIds.length) {
    throw new RuleError('Una o más personas seleccionadas ya no están disponibles.');
  }

  return prisma.chatConversation.create({
    data: {
      type: ChatConversationType.GRUPO,
      title,
      createdById: user.id,
      participants: {
        create: [
          { userId: user.id, role: ChatParticipantRole.CREADOR },
          ...uniqueIds.map((userId) => ({ userId, role: ChatParticipantRole.MIEMBRO })),
        ],
      },
    },
    select: { id: true },
  });
}

export async function getChatConversationSnapshot(
  user: CurrentUser,
  conversationId: string,
): Promise<ChatConversationSnapshot> {
  await assertParticipant(user, conversationId);
  const now = new Date();

  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: presenceSelect(now) } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });
  if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

  const [rows, typingRows] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: CHAT_HISTORY_LIMIT,
      include: {
        sender: { select: { id: true, name: true } },
        replyTo: {
          select: {
            id: true,
            body: true,
            kind: true,
            sender: { select: { name: true } },
          },
        },
        reactions: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        savedBy: {
          where: { userId: user.id },
          select: { userId: true },
        },
        attachments: {
          where: { deletedAt: null },
          select: { id: true, fileName: true, mimeType: true, size: true },
        },
      },
    }),
    prisma.chatTyping.findMany({
      where: {
        conversationId,
        userId: { not: user.id },
        updatedAt: { gt: new Date(now.getTime() - 10_000) },
      },
      include: { user: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  rows.reverse();

  const other = conversation.participants.find((item) => item.userId !== user.id);
  return {
    id: conversation.id,
    type: conversation.type,
    title:
      conversation.type === ChatConversationType.DIRECTO
        ? other?.user.name ?? 'Conversación'
        : conversation.title?.trim() || 'Grupo',
    participants: conversation.participants.map((item) => serializePerson(item.user, now)),
    messages: rows.map((message) => {
      const grouped = new Map<string, {
        emoji: string;
        count: number;
        mine: boolean;
        users: Array<{ id: string; name: string }>;
      }>();
      for (const reaction of message.reactions) {
        const current = grouped.get(reaction.emoji) ?? {
          emoji: reaction.emoji,
          count: 0,
          mine: false,
          users: [],
        };
        current.count += 1;
        current.mine ||= reaction.userId === user.id;
        current.users.push({ id: reaction.user.id, name: reaction.user.name });
        grouped.set(reaction.emoji, current);
      }

      const readBy = conversation.participants
        .filter((item) =>
          item.userId !== message.senderId &&
          Boolean(item.lastReadAt && item.lastReadAt >= message.createdAt),
        )
        .map((item) => ({
          userId: item.userId,
          name: item.user.name,
          readAt: item.lastReadAt!.toISOString(),
        }));

      return {
        id: message.id,
        kind: message.kind,
        body: message.body,
        stickerKey: message.stickerKey,
        stickerId: message.stickerId,
        mediaUrl: message.mediaUrl,
        mediaPageUrl: message.mediaPageUrl,
        mediaSource: message.mediaSource,
        mediaAlt: message.mediaAlt,
        contextLabel: message.contextLabel,
        contextHref: message.contextHref,
        contextEntity: message.contextEntity,
        contextEntityId: message.contextEntityId,
        senderId: message.senderId,
        senderName: message.sender.name,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
        deletedAt: message.deletedAt?.toISOString() ?? null,
        replyToId: message.replyToId,
        replyTo: message.replyTo
          ? {
              id: message.replyTo.id,
              senderName: message.replyTo.sender.name,
              body: message.replyTo.body,
              kind: message.replyTo.kind,
            }
          : null,
        reactions: Array.from(grouped.values()),
        saved: message.savedBy.length > 0,
        readBy,
        attachments: message.attachments.map((attachment) => ({
          ...attachment,
          url: `/api/chat/attachments/${attachment.id}`,
        })),
      };
    }),
    typing: typingRows.map((item) => ({
      userId: item.userId,
      name: item.user.name,
      updatedAt: item.updatedAt.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}

export async function sendChatMessage(
  user: CurrentUser,
  input: {
    conversationId: string;
    body?: unknown;
    stickerKey?: unknown;
    mediaUrl?: unknown;
    mediaPageUrl?: unknown;
    mediaSource?: unknown;
    mediaAlt?: unknown;
    contextLabel?: unknown;
    contextHref?: unknown;
    contextEntity?: unknown;
    contextEntityId?: unknown;
    replyToId?: unknown;
  },
) {
  await assertParticipant(user, input.conversationId);

  const body = normalizeChatText(input.body);
  const stickerKey = isChatStickerKey(input.stickerKey) ? input.stickerKey : null;
  const requestedMediaSource =
    input.mediaSource === 'TENOR' || input.mediaSource === 'WIKIMEDIA_COMMONS'
      ? input.mediaSource
      : null;
  const mediaUrl = requestedMediaSource
    ? normalizeChatMediaUrl(input.mediaUrl, requestedMediaSource)
    : null;
  const mediaPageUrl = mediaUrl && requestedMediaSource
    ? normalizeChatMediaUrl(input.mediaPageUrl, requestedMediaSource)
    : null;
  const mediaSource = mediaUrl ? requestedMediaSource : null;
  const mediaAlt =
    mediaUrl && typeof input.mediaAlt === 'string'
      ? input.mediaAlt.replace(/\s+/g, ' ').trim().slice(0, 180) || 'GIF'
      : null;
  const contextHref = normalizeInternalChatHref(input.contextHref);
  const contextLabel =
    typeof input.contextLabel === 'string' && contextHref
      ? input.contextLabel.trim().slice(0, 120) || 'Abrir en el Libro'
      : null;
  const contextEntity =
    typeof input.contextEntity === 'string' ? input.contextEntity.trim().slice(0, 80) || null : null;
  const contextEntityId =
    typeof input.contextEntityId === 'string'
      ? input.contextEntityId.trim().slice(0, 160) || null
      : null;
  const replyToId =
    typeof input.replyToId === 'string' ? input.replyToId.trim() || null : null;

  if (!body && !stickerKey && !mediaUrl && !contextHref) {
    throw new RuleError('Escribe un mensaje, envía un sticker, GIF o contexto.');
  }

  if (input.mediaUrl && (!mediaUrl || !mediaSource)) {
    throw new RuleError('La fuente del GIF no es válida.');
  }

  if (replyToId) {
    const replyTarget = await prisma.chatMessage.findFirst({
      where: { id: replyToId, conversationId: input.conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!replyTarget) {
      throw new RuleError('El mensaje al que intentas responder ya no está disponible.');
    }
  }

  const kind = stickerKey
    ? ChatMessageKind.STICKER
    : mediaUrl
      ? ChatMessageKind.GIF
      : contextHref
        ? ChatMessageKind.CONTEXTO
        : ChatMessageKind.TEXTO;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.chatConversation.findFirst({
      where: { id: input.conversationId, deletedAt: null },
      include: {
        participants: {
          where: { leftAt: null },
          select: { userId: true, mutedUntil: true },
        },
      },
    });
    if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

    const message = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        kind,
        body,
        stickerKey,
        mediaUrl,
        mediaPageUrl,
        mediaSource,
        mediaAlt,
        contextLabel,
        contextHref,
        contextEntity,
        contextEntityId,
        replyToId,
      },
      select: { id: true },
    });

    await tx.chatConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });

    if (mediaUrl && mediaSource) {
      await tx.chatMediaPreference.upsert({
        where: {
          userId_kind_refKey: {
            userId: user.id,
            kind: 'gif',
            refKey: mediaUrl,
          },
        },
        create: {
          userId: user.id,
          kind: 'gif',
          refKey: mediaUrl,
          payload: {
            title: mediaAlt ?? 'GIF',
            url: mediaUrl,
            pageUrl: mediaPageUrl,
            source: mediaSource,
          },
          usedAt: now,
        },
        update: {
          payload: {
            title: mediaAlt ?? 'GIF',
            url: mediaUrl,
            pageUrl: mediaPageUrl,
            source: mediaSource,
          },
          usedAt: now,
        },
      });
    }

    const recipients = conversation.participants.filter((item) => item.userId !== user.id);
    if (recipients.length) {
      await tx.chatParticipant.updateMany({
        where: {
          conversationId: conversation.id,
          userId: { in: recipients.map((item) => item.userId) },
          leftAt: null,
        },
        data: { unreadCount: { increment: 1 } },
      });
    }

    const notificationTitle =
      conversation.type === ChatConversationType.GRUPO
        ? `${user.name} en ${conversation.title?.trim() || 'Grupo'}`
        : user.name;

    const preview = stickerKey
      ? `${chatStickerGlyph(stickerKey) ?? 'Sticker'} Sticker`
      : mediaUrl
        ? `GIF · ${mediaSource === 'TENOR' ? 'Tenor' : 'Wikimedia Commons'}`
        : body?.slice(0, 180) ?? contextLabel ?? 'Compartió un contexto del Libro';

    const mentionedUsernames = extractMentionUsernames(body);
    const mentionedUsers = mentionedUsernames.length
      ? await tx.user.findMany({
          where: {
            username: { in: mentionedUsernames, mode: 'insensitive' },
            id: { in: recipients.map((item) => item.userId) },
            active: true,
            deletedAt: null,
          },
          select: { id: true, username: true },
        })
      : [];
    const mentionedIds = new Set(mentionedUsers.map((item) => item.id));

    for (const recipient of recipients) {
      if (recipient.mutedUntil && recipient.mutedUntil > now) continue;

      if (mentionedIds.has(recipient.userId)) {
        await tx.notification.create({
          data: {
            userId: recipient.userId,
            type: NotificationType.MENCION,
            title: `${user.name} te mencionó en ${conversation.title?.trim() || 'el chat'}`,
            body: body?.slice(0, 180) ?? 'Te mencionaron en una conversación.',
            link: `/?chat=${conversation.id}`,
            entity: 'ChatConversation',
            entityId: conversation.id,
          },
        });
      }

      const existing = await tx.notification.findFirst({
        where: {
          userId: recipient.userId,
          type: NotificationType.CHAT_MENSAJE,
          entity: 'ChatConversation',
          entityId: conversation.id,
          readAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      if (existing) {
        await tx.notification.update({
          where: { id: existing.id },
          data: {
            title: notificationTitle,
            body: preview,
            link: `/?chat=${conversation.id}`,
            createdAt: now,
          },
        });
      } else {
        await tx.notification.create({
          data: {
            userId: recipient.userId,
            type: NotificationType.CHAT_MENSAJE,
            title: notificationTitle,
            body: preview,
            link: `/?chat=${conversation.id}`,
            entity: 'ChatConversation',
            entityId: conversation.id,
          },
        });
      }
    }

    return message;
  });

  return result;
}


function extractMentionUsernames(body: string | null): string[] {
  if (!body) return [];
  const usernames = new Set<string>();
  const pattern = /(^|\s)@([A-Za-z0-9._-]{2,40})\b/g;
  for (const match of body.matchAll(pattern)) {
    const username = match[2]?.trim();
    if (username) usernames.add(username.toLocaleLowerCase('es-CL'));
  }
  return Array.from(usernames);
}


const CHAT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const CHAT_STICKER_MAX_BYTES = 8 * 1024 * 1024;
const CHAT_ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function safeUploadName(value: string): string {
  const trimmed = value.replace(/[\\/\0\r\n]/g, '_').trim();
  return (trimmed || 'archivo').slice(0, 180);
}

export async function createChatAttachmentMessage(
  user: CurrentUser,
  input: {
    conversationId: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    body?: string | null;
    replyToId?: string | null;
  },
) {
  await assertParticipant(user, input.conversationId);
  if (!isR2Configured()) throw new RuleError('El almacenamiento de archivos todavía no está configurado.');
  if (!CHAT_ALLOWED_UPLOAD_TYPES.has(input.mimeType)) {
    throw new RuleError('Este tipo de archivo no está permitido en el chat.');
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > CHAT_UPLOAD_MAX_BYTES) {
    throw new RuleError('El archivo debe pesar como máximo 20 MB.');
  }

  const fileName = safeUploadName(input.fileName);
  const storageKey = makeChatStorageKey(input.conversationId, fileName);
  await putR2Object(storageKey, input.bytes, input.mimeType);

  try {
    const body = normalizeChatText(input.body);
    const replyToId = typeof input.replyToId === 'string' ? input.replyToId.trim() || null : null;
    if (replyToId) {
      const target = await prisma.chatMessage.findFirst({
        where: { id: replyToId, conversationId: input.conversationId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw new RuleError('El mensaje al que intentas responder ya no está disponible.');
    }

    return await prisma.$transaction(async (tx) => {
      const conversation = await tx.chatConversation.findFirst({
        where: { id: input.conversationId, deletedAt: null },
        include: {
          participants: {
            where: { leftAt: null },
            select: { userId: true, mutedUntil: true },
          },
        },
      });
      if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

      const message = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          kind: ChatMessageKind.ARCHIVO,
          body,
          replyToId,
          attachments: {
            create: {
              fileName,
              mimeType: input.mimeType,
              size: input.bytes.byteLength,
              storageKey,
              uploadedById: user.id,
            },
          },
        },
        select: { id: true },
      });

      const now = new Date();
      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      });

      const recipients = conversation.participants.filter((item) => item.userId !== user.id);
      if (recipients.length) {
        await tx.chatParticipant.updateMany({
          where: {
            conversationId: conversation.id,
            userId: { in: recipients.map((item) => item.userId) },
            leftAt: null,
          },
          data: { unreadCount: { increment: 1 } },
        });
      }

      for (const recipient of recipients) {
        if (recipient.mutedUntil && recipient.mutedUntil > now) continue;
        await tx.notification.create({
          data: {
            userId: recipient.userId,
            type: NotificationType.CHAT_MENSAJE,
            title: conversation.type === ChatConversationType.GRUPO
              ? `${user.name} en ${conversation.title?.trim() || 'Grupo'}`
              : user.name,
            body: input.mimeType.startsWith('image/') ? 'Imagen' : `Archivo · ${fileName}`,
            link: `/?chat=${conversation.id}`,
            entity: 'ChatConversation',
            entityId: conversation.id,
          },
        });
      }

      return message;
    });
  } catch (error) {
    await deleteR2Object(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function getChatAttachmentObject(user: CurrentUser, attachmentId: string) {
  assertChatActor(user);
  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      deletedAt: null,
      chatMessage: {
        deletedAt: null,
        conversation: {
          deletedAt: null,
          participants: { some: { userId: user.id, leftAt: null } },
        },
      },
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      size: true,
      storageKey: true,
    },
  });
  if (!attachment) throw new NotFoundError('El archivo no existe o no tienes acceso.');

  const response = await getR2Object(attachment.storageKey);
  if (!response.ok) throw new NotFoundError('El archivo ya no está disponible.');

  return { attachment, response };
}

export async function createChatSticker(
  user: CurrentUser,
  input: {
    conversationId: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    label?: string | null;
  },
) {
  await assertParticipant(user, input.conversationId);
  if (!isR2Configured()) throw new RuleError('El almacenamiento de stickers todavía no está configurado.');
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(input.mimeType)) {
    throw new RuleError('Los stickers deben ser PNG, WEBP o JPEG.');
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > CHAT_STICKER_MAX_BYTES) {
    throw new RuleError('El sticker debe pesar como máximo 8 MB.');
  }

  const fileName = safeUploadName(input.fileName);
  const storageKey = makeChatStorageKey(input.conversationId, fileName, 'sticker');
  await putR2Object(storageKey, input.bytes, input.mimeType);
  try {
    return await prisma.chatSticker.create({
      data: {
        ownerId: user.id,
        storageKey,
        fileName,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        label: input.label?.replace(/\s+/g, ' ').trim().slice(0, 80) || null,
      },
      select: { id: true },
    });
  } catch (error) {
    await deleteR2Object(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function listChatStickers(user: CurrentUser) {
  assertChatActor(user);
  const rows = await prisma.chatSticker.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 120,
    select: {
      id: true,
      ownerId: true,
      label: true,
      createdAt: true,
    },
  });

  const preferences = await prisma.chatMediaPreference.findMany({
    where: { userId: user.id, kind: 'sticker', refKey: { in: rows.map((row) => row.id) } },
    select: { refKey: true, favorite: true, usedAt: true },
  });
  const pref = new Map(preferences.map((item) => [item.refKey, item]));

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    url: `/api/chat/stickers/${row.id}`,
    mine: row.ownerId === user.id,
    favorite: pref.get(row.id)?.favorite ?? false,
    usedAt: pref.get(row.id)?.usedAt.toISOString() ?? null,
  }));
}

export async function sendCustomStickerMessage(
  user: CurrentUser,
  input: { conversationId: string; stickerId: string; replyToId?: string | null },
) {
  await assertParticipant(user, input.conversationId);
  const sticker = await prisma.chatSticker.findFirst({
    where: { id: input.stickerId, deletedAt: null },
    select: { id: true },
  });
  if (!sticker) throw new NotFoundError('El sticker ya no está disponible.');

  const replyToId = input.replyToId?.trim() || null;
  if (replyToId) {
    const replyTarget = await prisma.chatMessage.findFirst({
      where: { id: replyToId, conversationId: input.conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!replyTarget) throw new RuleError('El mensaje al que intentas responder ya no está disponible.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.chatConversation.findFirst({
      where: { id: input.conversationId, deletedAt: null },
      include: {
        participants: {
          where: { leftAt: null },
          select: { userId: true, mutedUntil: true },
        },
      },
    });
    if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

    const message = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: user.id,
        kind: ChatMessageKind.STICKER,
        stickerId: sticker.id,
        replyToId,
      },
      select: { id: true },
    });

    const now = new Date();
    await tx.chatConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    const recipients = conversation.participants.filter((item) => item.userId !== user.id);
    if (recipients.length) {
      await tx.chatParticipant.updateMany({
        where: { conversationId: conversation.id, userId: { in: recipients.map((item) => item.userId) } },
        data: { unreadCount: { increment: 1 } },
      });
    }

    for (const recipient of recipients) {
      if (recipient.mutedUntil && recipient.mutedUntil > now) continue;
      await tx.notification.create({
        data: {
          userId: recipient.userId,
          type: NotificationType.CHAT_MENSAJE,
          title: conversation.type === ChatConversationType.GRUPO
            ? `${user.name} en ${conversation.title?.trim() || 'Grupo'}`
            : user.name,
          body: 'Sticker',
          link: `/?chat=${conversation.id}`,
          entity: 'ChatConversation',
          entityId: conversation.id,
        },
      });
    }

    await tx.chatMediaPreference.upsert({
      where: {
        userId_kind_refKey: { userId: user.id, kind: 'sticker', refKey: sticker.id },
      },
      create: {
        userId: user.id,
        kind: 'sticker',
        refKey: sticker.id,
        payload: {},
        usedAt: now,
      },
      update: { usedAt: now },
    });

    return message;
  });

  return result;
}

export async function getChatStickerObject(user: CurrentUser, stickerId: string) {
  assertChatActor(user);
  const sticker = await prisma.chatSticker.findFirst({
    where: { id: stickerId, deletedAt: null },
    select: { id: true, fileName: true, mimeType: true, size: true, storageKey: true },
  });
  if (!sticker) throw new NotFoundError('El sticker no existe.');

  const response = await getR2Object(sticker.storageKey);
  if (!response.ok) throw new NotFoundError('El sticker ya no está disponible.');
  return { sticker, response };
}


export async function getChatMediaPreferences(
  user: CurrentUser,
  kind: 'gif' | 'sticker',
) {
  assertChatActor(user);
  const rows = await prisma.chatMediaPreference.findMany({
    where: { userId: user.id, kind },
    orderBy: [{ favorite: 'desc' }, { usedAt: 'desc' }],
    take: 80,
    select: {
      kind: true,
      refKey: true,
      payload: true,
      favorite: true,
      usedAt: true,
    },
  });
  return rows.map((row) => ({
    kind: row.kind,
    refKey: row.refKey,
    payload: row.payload,
    favorite: row.favorite,
    usedAt: row.usedAt.toISOString(),
  }));
}

export async function toggleChatMediaFavorite(
  user: CurrentUser,
  input: {
    kind: 'gif' | 'sticker';
    refKey: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  assertChatActor(user);
  const refKey = input.refKey.trim().slice(0, 1900);
  if (!refKey) throw new RuleError('No se pudo identificar el elemento.');

  const current = await prisma.chatMediaPreference.findUnique({
    where: {
      userId_kind_refKey: {
        userId: user.id,
        kind: input.kind,
        refKey,
      },
    },
    select: { favorite: true },
  });

  const favorite = !current?.favorite;
  const row = await prisma.chatMediaPreference.upsert({
    where: {
      userId_kind_refKey: {
        userId: user.id,
        kind: input.kind,
        refKey,
      },
    },
    create: {
      userId: user.id,
      kind: input.kind,
      refKey,
      payload: input.payload ?? {},
      favorite,
      usedAt: new Date(),
    },
    update: {
      favorite,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    },
    select: { favorite: true },
  });
  return row;
}

export async function toggleChatReaction(
  user: CurrentUser,
  input: { conversationId: string; messageId: string; emoji: string },
) {
  await assertParticipant(user, input.conversationId);
  const emoji = input.emoji.trim().slice(0, 16);
  if (!emoji) throw new RuleError('Selecciona una reacción.');

  const message = await prisma.chatMessage.findFirst({
    where: {
      id: input.messageId,
      conversationId: input.conversationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!message) throw new NotFoundError('El mensaje ya no está disponible.');

  const existing = await prisma.chatReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: message.id,
        userId: user.id,
        emoji,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.chatReaction.delete({ where: { id: existing.id } }),
      prisma.chatConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return { active: false };
  }

  await prisma.$transaction([
    prisma.chatReaction.create({
      data: {
        messageId: message.id,
        userId: user.id,
        emoji,
      },
    }),
    prisma.chatConversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return { active: true };
}

export async function toggleSavedChatMessage(
  user: CurrentUser,
  input: { conversationId: string; messageId: string },
) {
  await assertParticipant(user, input.conversationId);

  const message = await prisma.chatMessage.findFirst({
    where: {
      id: input.messageId,
      conversationId: input.conversationId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!message) throw new NotFoundError('El mensaje ya no está disponible.');

  const key = { userId_messageId: { userId: user.id, messageId: message.id } };
  const existing = await prisma.chatSavedMessage.findUnique({
    where: key,
    select: { userId: true },
  });

  if (existing) {
    await prisma.chatSavedMessage.delete({ where: key });
    return { saved: false };
  }

  await prisma.chatSavedMessage.create({
    data: { userId: user.id, messageId: message.id },
  });
  return { saved: true };
}

export async function setChatTyping(
  user: CurrentUser,
  input: { conversationId: string; active: boolean },
) {
  await assertParticipant(user, input.conversationId);

  if (!input.active) {
    await prisma.chatTyping.deleteMany({
      where: { conversationId: input.conversationId, userId: user.id },
    });
    return { active: false };
  }

  await prisma.chatTyping.upsert({
    where: {
      conversationId_userId: {
        conversationId: input.conversationId,
        userId: user.id,
      },
    },
    create: {
      conversationId: input.conversationId,
      userId: user.id,
    },
    update: {
      updatedAt: new Date(),
    },
  });

  return { active: true };
}

export async function listSavedChatMessages(user: CurrentUser) {
  assertChatActor(user);
  const rows = await prisma.chatSavedMessage.findMany({
    where: {
      userId: user.id,
      message: {
        deletedAt: null,
        conversation: {
          deletedAt: null,
          participants: { some: { userId: user.id, leftAt: null } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      message: {
        include: {
          sender: { select: { name: true } },
          conversation: { select: { id: true, title: true, type: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    messageId: row.messageId,
    conversationId: row.message.conversation.id,
    conversationTitle:
      row.message.conversation.type === ChatConversationType.GRUPO
        ? row.message.conversation.title?.trim() || 'Grupo'
        : row.message.sender.name,
    senderName: row.message.sender.name,
    body: row.message.body,
    kind: row.message.kind,
    createdAt: row.message.createdAt.toISOString(),
    savedAt: row.createdAt.toISOString(),
  }));
}

export async function markChatConversationRead(user: CurrentUser, conversationId: string) {
  await assertParticipant(user, conversationId);
  const now = new Date();
  await prisma.$transaction([
    prisma.chatParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: now, unreadCount: 0 },
    }),
    prisma.notification.updateMany({
      where: {
        userId: user.id,
        type: NotificationType.CHAT_MENSAJE,
        entity: 'ChatConversation',
        entityId: conversationId,
        readAt: null,
      },
      data: { readAt: now },
    }),
  ]);
}

export function chatAvatarPreview(key: string): string {
  return avatarGlyph(key);
}
