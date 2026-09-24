import { requireUser } from '@/server/auth/guard';
import { chatApiError } from '@/server/api/chat';
import { getChatAttachmentObject } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const user = await requireUser();
    const { attachmentId } = await params;
    const { attachment, response } = await getChatAttachmentObject(user, attachmentId);
    const inline = attachment.mimeType.startsWith('image/');
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(attachment.size),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.fileName)}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return chatApiError(error);
  }
}
