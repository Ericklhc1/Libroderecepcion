import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { beginChatStickerUpload } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  conversationId: z.string().min(1),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = schema.parse(await request.json());
    return chatJson(await beginChatStickerUpload(user, payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'Los datos del sticker no son válidos.' }, 400);
    }
    return chatApiError(error);
  }
}
