import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { setChatTyping } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ active: z.boolean() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(await setChatTyping(user, {
      conversationId: id,
      active: payload.active,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'Estado de escritura inválido.' }, 400);
    }
    return chatApiError(error);
  }
}
