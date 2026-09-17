'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import { formDataToObject, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';

const schema = z.object({
  clpMinimum: z.coerce.number().min(0, 'La caja mínima CLP no puede ser negativa.'),
  usdMinimum: z.coerce.number().min(0, 'La caja mínima USD no puede ser negativa.'),
});

export async function saveCashConfigurationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const input = schema.parse(formDataToObject(formData));

    await prisma.$transaction(async (tx) => {
      await tx.cashFund.updateMany({
        where: { currency: { notIn: ['CLP', 'USD'] } },
        data: { active: false, updatedById: user.id },
      });

      for (const [currency, amount] of [
        ['CLP', input.clpMinimum],
        ['USD', input.usdMinimum],
      ] as const) {
        await tx.cashFund.upsert({
          where: { currency },
          create: {
            currency,
            amount: new Prisma.Decimal(amount),
            active: true,
            updatedById: user.id,
          },
          update: {
            amount: new Prisma.Decimal(amount),
            active: true,
            updatedById: user.id,
          },
        });
      }

      await recordAudit(
        {
          entity: 'CashFund',
          entityId: 'hotel',
          action: AuditAction.CONFIGURAR,
          summary: `Caja configurada: mínimo CLP ${input.clpMinimum}; mínimo USD ${input.usdMinimum}. Divisas activas: CLP y USD.`,
          user,
          after: { CLP: input.clpMinimum, USD: input.usdMinimum, currencies: ['CLP', 'USD'] },
        },
        tx,
      );
    });

    revalidatePath('/admin/parametros');
    revalidatePath('/turno');
    return { ok: true as const, message: 'Configuración de Caja guardada.' };
  });
}
