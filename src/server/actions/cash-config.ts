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

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

export async function saveCashConfigurationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('system.configure');
    const input = schema.parse(formDataToObject(formData));
    const rules = {
      treasuryTransfersEnabled: checked(formData, 'treasuryTransfersEnabled'),
      transferReceiptRequired: checked(formData, 'transferReceiptRequired'),
      usdRateEnabled: checked(formData, 'usdRateEnabled'),
      requireDifferenceNote: checked(formData, 'requireDifferenceNote'),
    };

    await prisma.$transaction(async (tx) => {
      // CLP y USD son las únicas divisas operativas. Los montos son el fondo
      // mínimo que debe permanecer físicamente en caja, no una recaudación.
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

      const settingRows = [
        {
          key: 'cash.treasuryTransfersEnabled',
          value: rules.treasuryTransfersEnabled,
          description: 'Permite registrar egresos a tesorería durante la entrega de turno.',
        },
        {
          key: 'cash.transferReceiptRequired',
          value: rules.transferReceiptRequired,
          description: 'Exige comprobante/referencia al registrar un egreso a tesorería.',
        },
        {
          key: 'cash.usdRateEnabled',
          value: rules.usdRateEnabled,
          description: 'Permite declarar el tipo de cambio USD/CLP del turno.',
        },
        {
          key: 'cash.requireDifferenceNote',
          value: rules.requireDifferenceNote,
          description: 'Exige explicar las diferencias entre el arqueo y el fondo mínimo.',
        },
      ] as const;

      for (const setting of settingRows) {
        await tx.systemSetting.upsert({
          where: { key: setting.key },
          create: {
            key: setting.key,
            value: setting.value,
            category: 'caja',
            description: setting.description,
            updatedById: user.id,
          },
          update: {
            value: setting.value,
            category: 'caja',
            description: setting.description,
            updatedById: user.id,
          },
        });
      }

      await recordAudit(
        {
          entity: 'CashFund',
          entityId: 'hotel',
          action: AuditAction.CONFIGURAR,
          summary:
            `Caja configurada: mínimo CLP ${input.clpMinimum}; mínimo USD ${input.usdMinimum}. ` +
            'Divisas activas: CLP y USD.',
          user,
          after: {
            CLP: input.clpMinimum,
            USD: input.usdMinimum,
            currencies: ['CLP', 'USD'],
            ...rules,
          },
        },
        tx,
      );
    });

    revalidatePath('/admin/parametros');
    revalidatePath('/turno');
    revalidatePath('/caja');
    return { ok: true as const, message: 'Configuración de Caja guardada.' };
  });
}
