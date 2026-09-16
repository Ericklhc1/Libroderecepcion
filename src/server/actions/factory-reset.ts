'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { runFactoryReset } from '@/server/services/factory-reset';

/**
 * Dejar el sistema en cero.
 *
 * Tres cierres, y ninguno es adorno: el permiso del Administrador de sistema,
 * la frase escrita a mano, y —además— que quien lo pide **sea** el
 * administrador y no alguien con el permiso prestado. El servicio valida la
 * frase otra vez: esta acción no es la única puerta.
 */
const resetSchema = z.object({
  phrase: z.string().min(1, 'Escribe la frase de confirmación.'),
  includeStays: z.coerce.boolean().optional().default(false),
  includeUsers: z.coerce.boolean().optional().default(false),
});

export async function factoryResetAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    if (!user.isSystemAdmin) {
      throw new RuleError(
        'Sólo el Administrador de sistema puede dejar el sistema en cero.',
      );
    }

    const input = parseOrThrow(resetSchema, formDataToObject(formData));
    const summary = await runFactoryReset(user, {
      phrase: input.phrase,
      scope: { includeStays: input.includeStays, includeUsers: input.includeUsers },
    });

    // Todo cambió: se revalida la aplicación entera, no una ruta.
    revalidatePath('/', 'layout');

    const detalle = Object.entries(summary.deleted)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([label, value]) => `${label}: ${value}`)
      .join(' · ');

    return {
      ok: true as const,
      message:
        summary.total === 0
          ? 'No había nada que borrar: el sistema ya estaba en cero.'
          : `Sistema en cero: ${summary.total} registro(s) eliminados.` +
            (detalle ? ` ${detalle}.` : '') +
            ` Se conservaron el catálogo y tu cuenta (${summary.keptUser}).`,
    };
  });
}
