import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { confirmFrontiInChat } from '@/server/ai/fronti-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(20).max(20_000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(
      await confirmFrontiInChat(user, {
        conversationId: id,
        token: payload.token,
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'La confirmación de Fronti no es válida.' }, 400);
    }
    return chatApiError(error);
  }
}
