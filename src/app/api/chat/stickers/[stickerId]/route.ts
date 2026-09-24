import { requireUser } from '@/server/auth/guard';
import { chatApiError } from '@/server/api/chat';
import { getChatStickerObject } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ stickerId: string }> },
) {
  try {
    const user = await requireUser();
    const { stickerId } = await params;
    const { sticker, response } = await getChatStickerObject(user, stickerId);
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': sticker.mimeType,
        'Content-Length': String(sticker.size),
        'Content-Disposition': `inline; filename="${encodeURIComponent(sticker.fileName)}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return chatApiError(error);
  }
}
