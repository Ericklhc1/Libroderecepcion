'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { recordAudit } from '@/server/audit';

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function saveHandoverElementConfigurationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const ids = formData
      .getAll('elementId')
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const existing = await prisma.handoverElementType.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const known = new Set(existing.map((item) => item.id));

    const newName = text(formData, 'newName');
    const newDetail = text(formData, 'newDetail');
    const newOrderRaw = text(formData, 'newOrder');
    const newOrder = newOrderRaw === '' ? null : z.coerce.number().int().min(0).parse(newOrderRaw);

    await prisma.$transaction(async (tx) => {
      for (const id of ids) {
        if (!known.has(id)) continue;
        const name = text(formData, `name_${id}`);
        if (name.length < 2) continue;
        const detail = text(formData, `detail_${id}`);
        const orderRaw = text(formData, `order_${id}`);
        const order = orderRaw === '' ? 0 : z.coerce.number().int().min(0).parse(orderRaw);

        await tx.handoverElementType.update({
          where: { id },
          data: {
            name,
            detail: detail || null,
            order,
            active: checked(formData, `active_${id}`),
            required: checked(formData, `required_${id}`),
          },
        });
      }

      if (newName) {
        await tx.handoverElementType.upsert({
          where: { name: newName },
          create: {
            name: newName,
            detail: newDetail || null,
            active: true,
            required: checked(formData, 'newRequired'),
            order: newOrder ?? 0,
          },
          update: {
            detail: newDetail || null,
            active: true,
            required: checked(formData, 'newRequired'),
            order: newOrder ?? 0,
          },
        });
      }

      await recordAudit(
        {
          entity: 'HandoverElementType',
          entityId: 'hotel',
          action: AuditAction.CONFIGURAR,
          summary: `Configuración de elementos de entrega actualizada (${ids.length}${newName ? ' + nuevo' : ''}).`,
          user,
          after: { elementIds: ids, newName: newName || null },
        },
        tx,
      );
    });

    revalidatePath('/admin/parametros');
    revalidatePath('/turno');
    return { ok: true as const, message: 'Elementos de entrega actualizados.' };
  });
}
