'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction, HandoverStatus, ShiftStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, zOptionalString, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import {
  ARCHIVABLE_SHIFT_STATUSES,
  SHIFT_STATUS_LABEL,
  SHIFT_TYPE_LABEL,
} from '@/domain/shift';
import { endShiftParticipation } from '@/server/services/shifts';

const schema = z.object({
  shiftId: z.string().min(1),
  reason: zOptionalString,
});

const NORMAL_ARCHIVABLE = new Set<ShiftStatus>(ARCHIVABLE_SHIFT_STATUSES);

const OCCUPYING = new Set<ShiftStatus>([
  ShiftStatus.INICIADO,
  ShiftStatus.ACTIVO,
  ShiftStatus.PREPARANDO_ENTREGA,
]);

/**
 * Retira un turno de la operación sin destruir su trazabilidad.
 *
 * Un Supervisor mantiene la regla normal: sólo archiva turnos terminados.
 * El Administrador de sistema puede retirar también un turno en curso o con
 * entrega enviada, útil para corregir aperturas erróneas o ciclos atascados.
 * En esos casos el turno queda ANULADO + archivado para liberar la invariante
 * de «una participación activa por persona». Si había una entrega ENVIADA, se terminaliza
 * técnicamente para que no siga apareciendo como entrega pendiente; la
 * observación deja explícito que NO fue una recepción operativa.
 */
export async function removeShiftFromOperationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.manage');
    const input = parseOrThrow(schema, formDataToObject(formData));

    const shift = await prisma.shift.findUnique({
      where: { id: input.shiftId },
      include: { handoverOut: true },
    });
    if (!shift) throw new NotFoundError('El turno no existe.');
    if (shift.archivedAt) throw new RuleError('Ese turno ya fue retirado de la operación.');

    const requiresAdminOverride = !NORMAL_ARCHIVABLE.has(shift.status);
    if (requiresAdminOverride && !user.isSystemAdmin) {
      throw new RuleError(
        `Un turno en estado ${SHIFT_STATUS_LABEL[shift.status]} sigue en curso. Sólo el Administrador de sistema puede retirarlo sin cerrarlo.`,
      );
    }

    const now = new Date();
    const forced = requiresAdminOverride && user.isSystemAdmin;

    await prisma.$transaction(async (tx) => {
      if (forced && shift.handoverOut?.status === HandoverStatus.ENVIADA) {
        await tx.shiftHandover.update({
          where: { id: shift.handoverOut.id },
          data: {
            status: HandoverStatus.RECIBIDA,
            receivedAt: now,
            receiverObservations:
              'Entrega retirada por Administrador de sistema al eliminar el turno. No corresponde a una recepción operativa.',
          },
        });
      }

      await tx.shift.update({
        where: { id: shift.id },
        data: {
          archivedAt: now,
          archivedById: user.id,
          ...(forced && (OCCUPYING.has(shift.status) || shift.status === ShiftStatus.ENTREGA_ENVIADA)
            ? { status: ShiftStatus.ANULADO, actualEnd: shift.actualEnd ?? now }
            : {}),
        },
      });
      if (forced) {
        await endShiftParticipation(tx, shift.id, now);
      }

      await recordAudit(
        {
          entity: 'Shift',
          entityId: shift.id,
          action: AuditAction.ELIMINAR,
          user,
          summary: forced
            ? `Turno ${SHIFT_TYPE_LABEL[shift.type]} retirado de la operación por Administrador de sistema sin cierre previo`
            : `Turno ${SHIFT_TYPE_LABEL[shift.type]} archivado`,
          before: {
            status: shift.status,
            archivedAt: shift.archivedAt,
            handoverStatus: shift.handoverOut?.status ?? null,
          },
          after: {
            status:
              forced && (OCCUPYING.has(shift.status) || shift.status === ShiftStatus.ENTREGA_ENVIADA)
                ? ShiftStatus.ANULADO
                : shift.status,
            archivedAt: now.toISOString(),
            handoverStatus:
              forced && shift.handoverOut?.status === HandoverStatus.ENVIADA
                ? HandoverStatus.RECIBIDA
                : (shift.handoverOut?.status ?? null),
          },
          reason: input.reason ?? null,
        },
        tx,
      );
    });

    revalidatePath('/');
    revalidatePath('/turno');
    revalidatePath('/supervision');
    revalidatePath('/indicadores');
    revalidatePath('/admin/turnos');

    return {
      ok: true as const,
      message: forced
        ? 'Turno retirado de la operación. La trazabilidad se conserva en el historial.'
        : 'Turno archivado. Sigue disponible en el historial.',
    };
  });
}
