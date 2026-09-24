import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { manageGroupConversation } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), title: z.string().min(1).max(120) }),
  z.object({ action: z.literal('add'), userId: z.string().min(1) }),
  z.object({ action: z.literal('remove'), userId: z.string().min(1) }),
  z.object({ action: z.literal('promote'), userId: z.string().min(1) }),
  z.object({ action: z.literal('demote'), userId: z.string().min(1) }),
  z.object({ action: z.literal('mute'), muted: z.boolean() }),
  z.object({ action: z.literal('leave') }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(await manageGroupConversation(user, {
      conversationId: id,
      ...payload,
    } as Parameters<typeof manageGroupConversation>[1]));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'La acción del grupo no es válida.' }, 400);
    }
    return chatApiError(error);
  }
}
