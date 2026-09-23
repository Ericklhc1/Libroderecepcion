'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { HELP_ACTIONS, type HelpActionKey } from '@/domain/help';

/**
 * Acciones que la central de ayuda puede ejecutar.
 *
 * **Sólo reversibles y del núcleo vigente.** Regenerar el borrador de una
 * entrega conserva las notas manuales. El legado PMS/estadías no se ejecuta
 * desde esta superficie.
 *
 * El permiso se comprueba contra el catálogo del dominio, no contra una lista
 * escrita otra vez acá: si divergieran, la ayuda podría ofrecer algo que la
 * persona no puede hacer, o ejecutar algo sin el permiso correcto.
 */

const actionSchema = z.object({
  action: z.enum(['regenerar-entrega']),
});

export async function runHelpActionAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const input = parseOrThrow(actionSchema, formDataToObject(formData));
    const key = input.action as HelpActionKey;
    const definition = HELP_ACTIONS[key];

    const user = await requirePermission(definition.permission);

    // regenerar-entrega
    const { getMyOpenShift, prepareHandover } = await import('@/server/services/shifts');
    const shift = await getMyOpenShift(user.id);
    if (!shift) {
      throw new RuleError('No tienes un turno abierto: no hay entrega que regenerar.');
    }

    const handover = await prepareHandover(user, shift.id);
    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handover.id}`);
    return {
      ok: true as const,
      message: 'Resumen regenerado con el estado actual. Tus notas manuales se conservan.',
      id: handover.id,
    };
  });
}
