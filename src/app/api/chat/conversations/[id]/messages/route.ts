import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import {
  getChatConversationSnapshot,
  sendChatMessage,
} from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const messageSchema = z.object({
  body: z.unknown().optional(),
  stickerKey: z.unknown().optional(),
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
    const message = await sendChatMessage(user, {
      conversationId: id,
      ...payload,
    });
    return chatJson(message, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'El mensaje no es válido.' }, 400);
    }
    return chatApiError(error);
  }
}
