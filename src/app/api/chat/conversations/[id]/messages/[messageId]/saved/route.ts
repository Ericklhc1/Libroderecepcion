import { withMaintenance } from '@/server/api/maintenance';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { toggleSavedChatMessage } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function POSTHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    return chatJson(await toggleSavedChatMessage(user, {
      conversationId: id,
      messageId,
    }));
  } catch (error) {
    return chatApiError(error);
  }
}

export const POST = withMaintenance(POSTHandler);
