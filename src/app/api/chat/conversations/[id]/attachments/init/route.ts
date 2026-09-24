import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { beginChatAttachmentUpload } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const payload = schema.parse(await request.json());
    return chatJson(await beginChatAttachmentUpload(user, {
      conversationId: id,
      ...payload,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'Los datos del archivo no son válidos.' }, 400);
    }
    return chatApiError(error);
  }
}
