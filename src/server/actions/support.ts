'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction, SupportRequestStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';

const updateSchema = z.object({
  supportRequestId: z.string().min(1),
  status: z.nativeEnum(SupportRequestStatus),
  resolution: z.string().trim().max(4000).optional(),
});

export async function updateSupportRequestAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('support.manage');
    const input = parseOrThrow(updateSchema, formDataToObject(formData));
    const existing = await prisma.supportRequest.findUnique({
      where: { id: input.supportRequestId },
      select: { id: true, status: true, subject: true },
    });
    if (!existing) throw new RuleError('El reporte ya no existe.');

    const terminal =
      input.status === SupportRequestStatus.RESUELTA ||
      input.status === SupportRequestStatus.DESCARTADA;
    const resolution = input.resolution?.trim() || null;
    if (terminal && (!resolution || resolution.length < 3)) {
      throw new RuleError('Para cerrar o descartar, registra una resolución.');
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.supportRequest.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          resolution,
          resolvedAt: terminal ? now : null,
          resolvedById: terminal ? user.id : null,
        },
      }),
      prisma.auditLog.create({
        data: {
          entity: 'SupportRequest',
          entityId: existing.id,
          action: AuditAction.CAMBIO_ESTADO,
          summary: `Soporte: ${existing.subject} → ${input.status.replaceAll('_', ' ')}`,
          userId: user.id,
          before: { status: existing.status },
          after: { status: input.status, resolution },
        },
      }),
    ]);

    revalidatePath('/admin/soporte');
    return { ok: true as const, message: 'Bandeja actualizada.' };
  });
}
