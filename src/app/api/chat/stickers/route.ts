import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { createChatSticker, listChatStickers } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const form = await request.formData();
    const file = form.get('file');
    const conversationId = form.get('conversationId');
    if (!(file instanceof File) || typeof conversationId !== 'string' || !conversationId) {
      return chatJson({ error: 'Faltan datos para crear el sticker.' }, 400);
    }

    const sticker = await createChatSticker(user, {
      conversationId,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
      label: typeof form.get('label') === 'string' ? String(form.get('label')) : null,
    });
    return chatJson(sticker, 201);
  } catch (error) {
    return chatApiError(error);
  }
}
