import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import {
  createGroupConversation,
  createOrGetDirectConversation,
} from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const payloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIRECTO'),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal('GRUPO'),
    title: z.string().min(1).max(120),
    userIds: z.array(z.string().min(1)).min(1).max(29),
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = payloadSchema.parse(await request.json());
    const conversation =
      payload.type === 'DIRECTO'
        ? await createOrGetDirectConversation(user, payload.userId)
        : await createGroupConversation(user, {
            title: payload.title,
            userIds: payload.userIds,
          });
    return chatJson(conversation, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'Los datos de la conversación no son válidos.' }, 400);
    }
    return chatApiError(error);
  }
}
