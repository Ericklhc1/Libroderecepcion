'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';
import { RuleError } from '@/server/errors';
import { HELP_ACTIONS, type HelpActionKey } from '@/domain/help';

/**
 * Acciones que la central de ayuda puede ejecutar.
 *
 * **Sólo reversibles.** Reconciliar llaves es idempotente; regenerar el
 * borrador de una entrega conserva las notas manuales. Confirmar una salida,
 * un check-in o un arqueo no están acá y no deben estarlo: ésas las firma una
 * persona en su pantalla, con el contexto delante.
 *
 * El permiso se comprueba contra el catálogo del dominio, no contra una lista
 * escrita otra vez acá: si divergieran, la ayuda podría ofrecer algo que la
 * persona no puede hacer, o ejecutar algo sin el permiso correcto.
 */

const actionSchema = z.object({
  action: z.enum(['reconciliar-llaves', 'regenerar-entrega']),
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

    if (key === 'reconciliar-llaves') {
      const { reconcilePrincipalKeys } = await import('@/server/services/keys');
      const assigned = await prisma.$transaction(
        (tx) => reconcilePrincipalKeys(tx, user, { note: 'desde la central de ayuda' }),
        { timeout: 30_000, maxWait: 10_000 },
      );

      await recordAudit({
        entity: 'RoomKey',
        entityId: 'inventario',
        action: AuditAction.CONFIGURAR,
        user,
        summary: `Inventario reconciliado desde la ayuda: ${assigned} llave(s) entregada(s)`,
      });

      revalidatePath('/llaves');
      revalidatePath('/habitaciones');
      return {
        ok: true as const,
        message:
          assigned > 0
            ? `Listo: ${assigned} llave(s) principal(es) quedaron con su ocupante.`
            : 'El inventario ya estaba correcto: no había ninguna llave por entregar.',
      };
    }

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
