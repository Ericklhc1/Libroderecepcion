'use server';

import { revalidatePath } from 'next/cache';
import { HandoverLevel, HandoverStatus } from '@prisma/client';
import { z } from 'zod';
import { formDataToObject, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  handoverId: z.string().min(1),
  observation: z.string().trim().min(3, 'Escribe una observación (mínimo 3 caracteres)').max(500),
  nextAction: z.string().trim().max(500).optional(),
});

export async function saveSingleHandoverNoteAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = schema.parse(formDataToObject(formData));

    const handover = await prisma.shiftHandover.findUnique({
      where: { id: input.handoverId },
      include: { fromShift: { include: { assignments: true } } },
    });
    if (!handover) throw new NotFoundError('La entrega no existe.');
    if (handover.status !== HandoverStatus.BORRADOR) {
      throw new RuleError('La entrega ya fue enviada: la nota no puede modificarse.');
    }
    if (!handover.fromShift.assignments.some((assignment) => assignment.userId === user.id)) {
      throw new RuleError('Sólo quien está en el turno puede editar la nota de entrega.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.handoverItem.deleteMany({
        where: { handoverId: input.handoverId, manual: true },
      });
      const last = await tx.handoverItem.aggregate({
        where: { handoverId: input.handoverId },
        _max: { order: true },
      });
      await tx.handoverItem.create({
        data: {
          handoverId: input.handoverId,
          level: HandoverLevel.IMPORTANTE,
          section: 'Nota para el turno siguiente',
          title: `Observación: ${input.observation}`,
          detail: `Siguiente acción: ${input.nextAction?.trim() || 'Sin acción adicional indicada.'}`,
          manual: true,
          order: (last._max.order ?? 0) + 1,
        },
      });
    });

    revalidatePath(`/turno/entrega/${input.handoverId}`);
    revalidatePath('/turno');
    return { ok: true as const, message: 'Nota para el turno siguiente guardada.' };
  });
}
