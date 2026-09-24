import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { updateOwnChatProfile } from '@/server/services/chat';
import { chatApiError, chatJson } from '@/server/api/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  avatarKey: z.unknown().optional(),
  statusText: z.unknown().optional(),
  notificationTone: z.unknown().optional(),
  soundEnabled: z.unknown().optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const payload = profileSchema.parse(await request.json());
    return chatJson(await updateOwnChatProfile(user, payload));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return chatJson({ error: 'La configuración del perfil no es válida.' }, 400);
    }
    return chatApiError(error);
  }
}
