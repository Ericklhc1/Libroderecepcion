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
import {
  CHAT_DIRECTORY_LIMIT,
  CHAT_GROUP_TITLE_MAX,
  CHAT_HISTORY_LIMIT,
  chatStickerGlyph,
  directConversationKey,
  isChatStickerKey,
  normalizeChatText,
  normalizeInternalChatHref,
  type ChatBootstrap,
  type ChatConversationListItem,
  type ChatConversationSnapshot,
  type ChatPerson,
  type ChatPresence,
} from '@/domain/chat';

const ONLINE_WINDOW_MS = 6 * 60_000;
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
  const counterpart = row.type === ChatConversationType.DIRECTO && others[0]
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
  const [rows, people, totalUnread] = await Promise.all([
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
  ]);

  return {
    conversations: rows.map((row) => serializeConversation(row, user.id, now)),
    people,
    totalUnread,
    generatedAt: now.toISOString(),
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

  const rows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: CHAT_HISTORY_LIMIT,
    include: {
      sender: { select: { id: true, name: true } },
      attachments: {
        where: { deletedAt: null },
        select: { id: true, fileName: true, mimeType: true, size: true },
      },
    },
  });
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
    messages: rows.map((message) => ({
      id: message.id,
      kind: message.kind,
      body: message.body,
      stickerKey: message.stickerKey,
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
      attachments: message.attachments,
    })),
    generatedAt: now.toISOString(),
  };
}

export async function getChatConversationVersion(
  user: CurrentUser,
  conversationId: string,
): Promise<string> {
  await assertParticipant(user, conversationId);
  const now = new Date();
  const onlineCutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);

  const row = await prisma.chatConversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    select: {
      updatedAt: true,
      lastMessageAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, editedAt: true, deletedAt: true },
      },
      participants: {
        where: { leftAt: null },
        orderBy: { userId: 'asc' },
        select: {
          userId: true,
          unreadCount: true,
          user: {
            select: {
              sessions: {
                where: {
                  revokedAt: null,
                  expiresAt: { gt: now },
                  lastSeenAt: { gte: onlineCutoff },
                },
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
                take: 1,
                select: { shiftId: true },
              },
            },
          },
        },
      },
    },
  });
  if (!row) throw new NotFoundError('La conversación ya no está disponible.');

  return JSON.stringify({
    u: row.updatedAt.toISOString(),
    l: row.lastMessageAt.toISOString(),
    m: row.messages[0]
      ? [row.messages[0].id, row.messages[0].editedAt?.toISOString(), row.messages[0].deletedAt?.toISOString()]
      : null,
    p: row.participants.map((item) => [
      item.userId,
      item.unreadCount,
      item.user.sessions[0]?.lastSeenAt?.toISOString() ?? null,
      item.user.assignments[0]?.shiftId ?? null,
    ]),
  });
}

export async function sendChatMessage(
  user: CurrentUser,
  input: {
    conversationId: string;
    body?: unknown;
    stickerKey?: unknown;
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

  if (!body && !stickerKey && !contextHref) {
    throw new RuleError('Escribe un mensaje, envía un sticker o adjunta un contexto.');
  }

  if (replyToId) {
    const replyTarget = await prisma.chatMessage.findFirst({
      where: { id: replyToId, conversationId: input.conversationId, deletedAt: null },
      select: { id: true },
    });
    if (!replyTarget) throw new RuleError('El mensaje al que intentas responder ya no está disponible.');
  }

  const kind = stickerKey
    ? ChatMessageKind.STICKER
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
      : body?.slice(0, 180) ?? contextLabel ?? 'Compartió un contexto del Libro';

    for (const recipient of recipients) {
      if (recipient.mutedUntil && recipient.mutedUntil > now) continue;
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
