import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { createChatAttachmentMessage } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROXY_MAX_BYTES = 3 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return chatJson({ error: 'Selecciona un archivo.' }, 400);
    }
    if (file.size < 1 || file.size > PROXY_MAX_BYTES) {
      return chatJson({
        error: 'El fallback seguro admite archivos de hasta 3 MB.',
      }, 413);
    }

    return chatJson(await createChatAttachmentMessage(user, {
      conversationId: id,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
      body: typeof form.get('body') === 'string' ? String(form.get('body')) : null,
      replyToId: typeof form.get('replyToId') === 'string' ? String(form.get('replyToId')) : null,
    }), 201);
  } catch (error) {
    return chatApiError(error);
  }
}
