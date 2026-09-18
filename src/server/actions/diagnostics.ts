'use server';

import { AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAuthenticatedUser, requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { runAction, type ActionState } from '@/server/action';
import { repairSafeDiagnostics } from '@/server/services/diagnostics';
import { getSettingBool } from '@/server/services/settings';

export async function repairDiagnosticsAction(
  _state: ActionState | null,
  _formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const result = await repairSafeDiagnostics(user);
    revalidatePath('/admin/diagnostico');
    revalidatePath('/supervision');
    revalidatePath('/reservas');
    revalidatePath('/habitaciones');
    revalidatePath('/');
    return {
      ok: true as const,
      message:
        `Depuración terminada: ${result.duplicateAlertsRemoved} alerta(s) duplicada(s) corregida(s), ` +
        `${result.staysLinked} estadía(s) vinculada(s) y ${result.reservationRoomsCorrected} asignación(es) de habitación corregida(s).`,
    };
  });
}

const runtimeErrorSchema = z.object({
  message: z.string().trim().max(2000),
  digest: z.string().trim().max(500).optional().nullable(),
  pathname: z.string().trim().max(1000).optional().nullable(),
  stack: z.string().trim().max(8000).optional().nullable(),
});

export async function reportRuntimeErrorAction(input: {
  message: string;
  digest?: string | null;
  pathname?: string | null;
  stack?: string | null;
}): Promise<void> {
  const enabled = await getSettingBool('diagnostics.runtimeCaptureEnabled', true);
  if (!enabled) return;

  const parsed = runtimeErrorSchema.safeParse(input);
  if (!parsed.success) return;

  const user = await requireAuthenticatedUser().catch(() => null);
  await recordAudit({
    entity: 'RuntimeError',
    entityId: parsed.data.digest || crypto.randomUUID(),
    action: AuditAction.CREAR,
    user,
    summary: parsed.data.message || 'Error de ejecución sin mensaje',
    after: {
      digest: parsed.data.digest ?? null,
      pathname: parsed.data.pathname ?? null,
      stack: parsed.data.stack ?? null,
    },
  });
}
