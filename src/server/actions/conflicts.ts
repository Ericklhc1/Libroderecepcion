'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { resolveAllOperationalConflicts } from '@/server/services/conflict-resolution';

function refreshConflictSurfaces() {
  revalidatePath('/');
  revalidatePath('/habitaciones');
  revalidatePath('/llaves');
  revalidatePath('/libro');
  revalidatePath('/incidencias');
  revalidatePath('/alertas');
  revalidatePath('/notificaciones');
  revalidatePath('/supervision');
  revalidatePath('/turno');
}

export async function resolveAllConflictsAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('conflict.resolve_all');
    const result = await resolveAllOperationalConflicts(user);

    refreshConflictSurfaces();

    return {
      ok: true as const,
      id: result.escalationEntryId ?? result.logEntryId,
      message:
        result.remaining === 0
          ? `Listo: ${result.resolved} conflicto(s) resueltos. Se notificó a ${result.notificationsSent} usuario(s) y no quedan conflictos vivos.`
          : `Reconciliación ejecutada: ${result.resolved} conflicto(s) resueltos y ${result.remaining} requieren decisión humana. Se notificó a ${result.notificationsSent} usuario(s).`,
    };
  });
}
