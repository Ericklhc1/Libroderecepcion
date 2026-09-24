import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { listSavedChatMessages } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return chatJson({ items: await listSavedChatMessages(user) });
  } catch (error) {
    return chatApiError(error);
  }
}
