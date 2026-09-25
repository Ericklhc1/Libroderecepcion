import 'server-only';

import {
  ChatConversationType,
  ChatMessageAuthor,
  ChatMessageKind,
  NotificationType,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { RuleError, NotFoundError } from '@/server/errors';
import { getFrontiConfig } from './fronti-config';
import { canUseFronti } from './fronti-access';
import {
  executeReceptionConfirmation,
  runReceptionAssistant,
  type AssistantMessage,
  type AssistantConfirmation,
} from './reception-assistant';
import {
  extractAndStoreMemories,
  persistAssistantReply,
  prepareAssistantContext,
} from './memory';
import { getSharedShiftMemoryContext } from './shift-memory';
import {
  buildFrontiRuntimeContext,
  runtimeContextMessage,
} from './fronti-v2/context-builder';
import { budgetConversationMessages } from './fronti-v2/context-budget';

const SHARED_CHAT_HISTORY = 14;

function isFrontiMention(body: string | null): boolean {
  return Boolean(body && /(^|\s)@fronti\b/i.test(body));
}

function cleanMention(body: string): string {
  const clean = body.replace(/(^|\s)@fronti\b[,:]?/gi, '$1').replace(/\s{2,}/g, ' ').trim();
  return clean || body.trim();
}

function actorName(author: ChatMessageAuthor, senderName: string | null): string {
  if (author === ChatMessageAuthor.FRONTI) return 'Fronti';
  if (author === ChatMessageAuthor.SYSTEM) return 'Sistema';
  return senderName ?? 'Usuario';
}

async function loadConversationContext(
  user: CurrentUser,
  conversationId: string,
  currentMessageId: string,
) {
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      deletedAt: null,
      participants: { some: { userId: user.id, leftAt: null } },
    },
    select: {
      id: true,
      type: true,
      title: true,
      participants: {
        where: { leftAt: null },
        select: { userId: true, mutedUntil: true, user: { select: { name: true } } },
      },
    },
  });
  if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

  const current = await prisma.chatMessage.findFirst({
    where: {
      id: currentMessageId,
      conversationId,
      senderId: user.id,
      author: ChatMessageAuthor.USER,
      deletedAt: null,
    },
    select: {
      id: true,
      body: true,
      replyToId: true,
      replyTo: {
        select: {
          body: true,
          author: true,
          sender: { select: { name: true } },
        },
      },
    },
  });
  if (!current) throw new NotFoundError('El mensaje que invocó a Fronti ya no está disponible.');

  return { conversation, current };
}

async function sharedTranscript(conversationId: string, currentMessageId: string): Promise<string> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      deletedAt: null,
      id: { not: currentMessageId },
    },
    orderBy: { createdAt: 'desc' },
    take: SHARED_CHAT_HISTORY,
    select: {
      body: true,
      kind: true,
      author: true,
      createdAt: true,
      sender: { select: { name: true } },
    },
  });
  rows.reverse();

  return rows
    .filter((row) => row.body?.trim())
    .map((row) => {
      const who = actorName(row.author, row.sender?.name ?? null);
      return `[${who}] ${row.body!.trim().slice(0, 900)}`;
    })
    .join('\n');
}

async function persistFrontiChatMessage(input: {
  conversationId: string;
  invokedById: string;
  reply: string;
}): Promise<string> {
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
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

    const created = await tx.chatMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: null,
        author: ChatMessageAuthor.FRONTI,
        kind: ChatMessageKind.TEXTO,
        body: input.reply.slice(0, 6000),
      },
      select: { id: true },
    });

    await tx.chatConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });

    const recipients = conversation.participants.filter(
      (participant) => participant.userId !== input.invokedById,
    );
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
          title:
            conversation.type === ChatConversationType.GRUPO
              ? `Fronti en ${conversation.title?.trim() || 'Grupo'}`
              : 'Fronti',
          body: input.reply.replace(/\s+/g, ' ').slice(0, 180),
          link: `/?chat=${conversation.id}`,
          entity: 'ChatConversation',
          entityId: conversation.id,
        },
      });
    }

    return created;
  });

  return message.id;
}

function identityMessage(displayName: string, shared: boolean): AssistantMessage {
  return {
    role: 'assistant',
    content:
      `Tu nombre visible es ${displayName}. Eres FRONTI v2 alpha, el agente contextual del Libro Operativo de Recepción. ` +
      'Usa las herramientas del Libro para hechos operativos cambiantes y respeta siempre los permisos del usuario que te invoca. ' +
      'Responde de forma compacta para una burbuja de chat: párrafos cortos, negritas y viñetas cuando ayuden. ' +
      'NO uses tablas Markdown salvo que el usuario pida explícitamente una tabla, columnas o cuadro comparativo. ' +
      (shared
        ? 'Estás respondiendo dentro de un chat compartido. El contexto de este chat NO es memoria personal y no debe persistirse como preferencia privada de ningún participante. '
        : 'Esta conversación es privada e individual para el usuario actual. ') +
      'La memoria sólo sirve como contexto; nunca reemplaza las fuentes de verdad del Libro.',
  };
}

export async function maybeInvokeFrontiInChat(
  user: CurrentUser,
  input: {
    conversationId: string;
    messageId: string;
    body: string | null;
  },
): Promise<{
  invoked: boolean;
  reply: string;
  messageId: string;
  confirmations: AssistantConfirmation[];
} | null> {
  const { conversation, current } = await loadConversationContext(
    user,
    input.conversationId,
    input.messageId,
  );

  const privateFronti = conversation.type === ChatConversationType.FRONTI;
  if (!privateFronti && !isFrontiMention(input.body)) return null;

  const config = await getFrontiConfig();
  if (!canUseFronti(user, config.enabled)) {
    if (privateFronti) throw new RuleError(`${config.displayName} no está habilitado para tu cuenta.`);
    return null;
  }

  const rawMessage = privateFronti
    ? current.body?.trim() ?? ''
    : cleanMention(current.body?.trim() ?? '');
  if (!rawMessage) throw new RuleError('Escribe qué quieres preguntarle a Fronti.');

  const runtimeContext = await buildFrontiRuntimeContext(user, {
    pathname: '/',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    label: conversation.type === ChatConversationType.GRUPO
      ? conversation.title?.trim() || 'Grupo'
      : privateFronti
        ? 'Fronti'
        : 'Chat directo',
  });

  let modelMessages: AssistantMessage[];
  let memoryContext:
    | { conversationId: string; cleanMessage: string; persist: boolean }
    | null = null;

  if (privateFronti) {
    const [prepared, sharedShiftMemory] = await Promise.all([
      prepareAssistantContext(user, rawMessage),
      getSharedShiftMemoryContext(user),
    ]);
    memoryContext = {
      conversationId: prepared.conversationId,
      cleanMessage: prepared.cleanMessage,
      persist: prepared.persist,
    };

    const last = prepared.messages.at(-1);
    const contextual =
      sharedShiftMemory && last
        ? [
            ...prepared.messages.slice(0, -1),
            {
              role: 'assistant' as const,
              content:
                'Contexto compartido del turno. Puede estar desactualizado; verifica hechos actuales con herramientas:\n' +
                sharedShiftMemory,
            },
            last,
          ]
        : prepared.messages;

    modelMessages = [
      identityMessage(config.displayName, false),
      { role: 'assistant', content: runtimeContextMessage(runtimeContext) },
      ...budgetConversationMessages(contextual, {
        maxMessages: config.modelHistoryLimit,
        maxChars: 6500,
      }),
    ];
  } else {
    const [transcript, sharedShiftMemory] = await Promise.all([
      sharedTranscript(conversation.id, current.id),
      getSharedShiftMemoryContext(user),
    ]);
    const quote = current.replyTo?.body?.trim()
      ? `Mensaje citado de ${actorName(
          current.replyTo.author,
          current.replyTo.sender?.name ?? null,
        )}: “${current.replyTo.body.trim().slice(0, 1200)}”`
      : null;

    const sharedContext = [
      'CONTEXTO DEL CHAT COMPARTIDO. Úsalo sólo para entender la conversación actual.',
      transcript || '(sin mensajes previos relevantes)',
      quote,
      sharedShiftMemory
        ? 'Contexto compartido del turno (verifica cualquier estado actual con tools):\n' + sharedShiftMemory
        : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    modelMessages = [
      identityMessage(config.displayName, true),
      { role: 'assistant', content: runtimeContextMessage(runtimeContext) },
      { role: 'assistant', content: sharedContext },
      { role: 'user', content: rawMessage },
    ];
  }

  const result = await runReceptionAssistant(user, modelMessages);
  const frontiMessageId = await persistFrontiChatMessage({
    conversationId: conversation.id,
    invokedById: user.id,
    reply: result.reply,
  });

  if (privateFronti && memoryContext) {
    await persistAssistantReply(
      memoryContext.conversationId,
      result.reply,
      memoryContext.persist,
    );
    if (memoryContext.persist) {
      await extractAndStoreMemories(
        user,
        memoryContext.conversationId,
        memoryContext.cleanMessage,
        result.reply,
      );
    }
  }

  return {
    invoked: true,
    reply: result.reply,
    messageId: frontiMessageId,
    confirmations: result.confirmations,
  };
}

export async function confirmFrontiInChat(
  user: CurrentUser,
  input: { conversationId: string; token: string },
): Promise<{ reply: string; messageId: string }> {
  const conversation = await prisma.chatConversation.findFirst({
    where: {
      id: input.conversationId,
      deletedAt: null,
      participants: { some: { userId: user.id, leftAt: null } },
    },
    select: { id: true },
  });
  if (!conversation) throw new NotFoundError('La conversación ya no está disponible.');

  const config = await getFrontiConfig();
  if (!canUseFronti(user, config.enabled)) {
    throw new RuleError(`${config.displayName} no está habilitado para tu cuenta.`);
  }

  const result = await executeReceptionConfirmation(user, input.token);
  const messageId = await persistFrontiChatMessage({
    conversationId: input.conversationId,
    invokedById: user.id,
    reply: result.reply,
  });
  return { reply: result.reply, messageId };
}
