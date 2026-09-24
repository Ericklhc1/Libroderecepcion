import { requireUser } from '@/server/auth/guard';
import { getChatBootstrap } from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    return chatJson(await getChatBootstrap(user));
  } catch (error) {
    return chatApiError(error);
  }
}
