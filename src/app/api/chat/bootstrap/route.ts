import { withMaintenance } from '@/server/api/maintenance';
import { requireUser } from '@/server/auth/guard';
import { getChatBootstrap } from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GETHandler() {
  try {
    const user = await requireUser();
    return chatJson(await getChatBootstrap(user));
  } catch (error) {
    return chatApiError(error);
  }
}

export const GET = withMaintenance(GETHandler);
