import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import {
  getChatConversationSnapshot,
  sendChatMessage,
  sendCustomStickerMessage,
} from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';
import { maybeInvokeFrontiInChat } from '@/server/ai/fronti-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  body: z.unknown().optional(),
  stickerKey: z.unknown().optional(),
  stickerId: z.string().min(1).optional(),
  mediaUrl: z.unknown().optional(),
  mediaPageUrl: z.unknown().optional(),
  mediaSource: z.unknown().optional(),
  mediaAlt: z.unknown().optional(),
  contextLabel: z.unknown().optional(),
  contextHref: z.unknown().optional(),
  contextEntity: z.unknown().optional(),
  contextEntityId: z.unknown().optional(),
  replyToId: z.unknown().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return chatJson(await getChatConversationSnapshot(user, id));
  } catch (error) {
    return chatApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = messageSchema.parse(await request.json());
    const message = payload.stickerId
      ? await sendCustomStickerMessage(user, {
          conversationId: id,
          stickerId: payload.stickerId,
          replyToId: typeof payload.replyToId === 'string' ? payload.replyToId : null,
        })
      : await sendChatMessage(user, {
          conversationId: id,
          ...payload,
        });

    const fronti = payload.stickerId
      ? null
      : await maybeInvokeFrontiInChat(user, {
          conversationId: id,
          messageId: message.id,
          body: typeof payload.body === 'string' ? payload.body : null,
        });

    return chatJson(fronti ? { ...message, fronti } : message, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'El mensaje no es válido.' }, 400);
    }
    return chatApiError(error);
  }
}
