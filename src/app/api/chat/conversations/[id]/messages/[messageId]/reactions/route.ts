import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { toggleChatReaction } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  emoji: z.string().min(1).max(16),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(await toggleChatReaction(user, {
      conversationId: id,
      messageId,
      emoji: payload.emoji,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'La reacción no es válida.' }, 400);
    }
    return chatApiError(error);
  }
}
