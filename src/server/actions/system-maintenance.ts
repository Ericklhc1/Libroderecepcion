'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { parseOrThrow, runAction, type ActionState } from '@/server/action';
import { setSystemMaintenance } from '@/server/services/system-maintenance';

export async function setSystemMaintenanceAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(z.object({ enabled: z.enum(['true', 'false']), revision: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal('on') }), Object.fromEntries(form));
    const state = await setSystemMaintenance(user, { enabled: input.enabled === 'true', expectedRevision: input.revision });
    revalidatePath('/', 'layout');
    return { ok: true, message: state.enabled ? 'Mantenimiento activado. El personal verá el aviso y no podrá operar.' : 'Mantenimiento desactivado. La operación vuelve a estar disponible.' };
  });
}
