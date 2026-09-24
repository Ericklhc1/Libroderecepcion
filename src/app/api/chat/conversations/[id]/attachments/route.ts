import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { finalizeChatAttachmentUpload } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  storageKey: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive(),
  body: z.string().max(4000).optional().nullable(),
  replyToId: z.string().min(1).optional().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(await finalizeChatAttachmentUpload(user, {
      conversationId: id,
      ...payload,
    }), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'No se pudo finalizar el archivo.' }, 400);
    }
    return chatApiError(error);
  }
}
