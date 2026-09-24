import { requireUser } from '@/server/auth/guard';
import { markChatConversationRead } from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await markChatConversationRead(user, id);
    return chatJson({ ok: true });
  } catch (error) {
    return chatApiError(error);
  }
}
