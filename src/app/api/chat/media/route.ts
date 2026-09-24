import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import {
  getChatMediaPreferences,
  toggleChatMediaFavorite,
} from '@/server/services/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const favoriteSchema = z.object({
  kind: z.enum(['gif', 'sticker']),
  refKey: z.string().min(1).max(1900),
  payload: z.unknown().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    if (kind !== 'gif' && kind !== 'sticker') {
      return chatJson({ error: 'Tipo de medio inválido.' }, 400);
    }
    return chatJson({ items: await getChatMediaPreferences(user, kind) });
  } catch (error) {
    return chatApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const payload = favoriteSchema.parse(await request.json());
    return chatJson(await toggleChatMediaFavorite(user, {
      kind: payload.kind,
      refKey: payload.refKey,
      payload: payload.payload as never,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'Preferencia multimedia inválida.' }, 400);
    }
    return chatApiError(error);
  }
}
