import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import {
  deleteOwnChatMessage,
  editOwnChatMessage,
} from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const editSchema = z.object({
  body: z.string().min(1).max(4000),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    const payload = editSchema.parse(await request.json());
    return chatJson(await editOwnChatMessage(user, {
      conversationId: id,
      messageId,
      body: payload.body,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'El mensaje no es válido.' }, 400);
    }
    return chatApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    return chatJson(await deleteOwnChatMessage(user, {
      conversationId: id,
      messageId,
    }));
  } catch (error) {
    return chatApiError(error);
  }
}
