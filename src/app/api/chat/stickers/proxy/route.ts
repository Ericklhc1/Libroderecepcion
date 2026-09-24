import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { createChatSticker } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROXY_MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get('file');
    const conversationId = form.get('conversationId');

    if (!(file instanceof File) || typeof conversationId !== 'string' || !conversationId) {
      return chatJson({ error: 'Faltan datos para crear el sticker.' }, 400);
    }
    if (file.size < 1 || file.size > PROXY_MAX_BYTES) {
      return chatJson({
        error: 'El fallback seguro admite stickers de hasta 3 MB.',
      }, 413);
    }

    return chatJson(await createChatSticker(user, {
      conversationId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
      label: typeof form.get('label') === 'string' ? String(form.get('label')) : null,
    }), 201);
  } catch (error) {
    return chatApiError(error);
  }
}
