import { withMaintenance } from '@/server/api/maintenance';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import { listSavedChatMessages } from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GETHandler() {
  try {
    const user = await requireUser();
    return chatJson({ items: await listSavedChatMessages(user) });
  } catch (error) {
    return chatApiError(error);
  }
}

export const GET = withMaintenance(GETHandler);
