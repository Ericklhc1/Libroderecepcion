import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import {
  finalizeChatStickerUpload,
  listChatStickers,
} from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const finalizeSchema = z.object({
  conversationId: z.string().min(1),
  storageKey: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  label: z.string().max(80).optional().nullable(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return chatJson({ items: await listChatStickers(user) });
  } catch (error) {
    return chatApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = finalizeSchema.parse(await request.json());
    return chatJson(await finalizeChatStickerUpload(user, payload), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'No se pudo finalizar el sticker.' }, 400);
    }
    return chatApiError(error);
  }
}
