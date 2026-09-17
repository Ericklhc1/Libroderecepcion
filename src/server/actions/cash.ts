'use server';

import { revalidatePath } from 'next/cache';
import { AuditAction, HandoverStatus, NotificationType } from '@prisma/client';
import { z } from 'zod';
import { formDataToObject, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { notify } from '@/server/notifications';
import { recordAudit } from '@/server/audit';
import {
  markHandoverElements,
  recordCashTransfer,
  saveCashCount,
} from '@/server/services/cash';
import { getSettingBool } from '@/server/services/settings';
import { fromMinor } from '@/domain/cash';

/**
 * Acciones de caja.
 *
 * El permiso es `shift.handover` para declarar y `shift.receive` para
 * confirmar, de modo que quien cuenta es quien entrega o quien recibe, y no un
 * tercero. Las cantidades llegan en campos `d_<idDenominación>`, porque un
 * formulario no puede enviar un objeto.
 */

const handoverIdSchema = z.object({ handoverId: z.string().min(1) });

/** Extrae las cantidades de los campos `d_<id>` del formulario. */
function quantitiesFrom(formData: FormData): Record<string, number> {
  const quantities: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('d_') || typeof value !== 'string') continue;
    const raw = value.trim();
    if (raw === '') continue;

    const quantity = Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new RuleError(
        'Las cantidades del arqueo deben ser números enteros: no hay medio billete.',
      );
    }
    quantities[key.slice(2)] = quantity;
  }
  return quantities;
}

function summarise(statuses: Array<{ currency: string; countedMinor: number }>): string {
  if (statuses.length === 0) return 'Arqueo guardado sin efectivo declarado.';
  return `Arqueo guardado: ${statuses
    .map((status) => `${fromMinor(status.countedMinor, status.currency)} ${status.currency}`)
    .join(' · ')}.`;
}

export async function declareCashCountAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));
    const notes = formData.get('notes');

    const { statuses } = await saveCashCount(user, {
      handoverId,
      kind: 'DECLARADO',
      quantities: quantitiesFrom(formData),
      notes: typeof notes === 'string' ? notes : null,
    });

    revalidatePath('/turno');
    revalidatePath('/caja');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: summarise(statuses) };
  });
}

export async function confirmCashCountAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.receive');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));
    const notes = formData.get('notes');

    const { statuses } = await saveCashCount(user, {
      handoverId,
      kind: 'CONFIRMADO',
      quantities: quantitiesFrom(formData),
      notes: typeof notes === 'string' ? notes : null,
    });

    revalidatePath('/turno');
    revalidatePath('/caja');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: summarise(statuses) };
  });
}

const transferSchema = z.object({
  handoverId: z.string().min(1),
  currency: z.enum(['CLP', 'USD']),
  amount: z.coerce.number().min(0, 'El monto no puede ser negativo'),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function recordCashTransferAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = transferSchema.parse(formDataToObject(formData));

    if (input.amount === 0) {
      return { ok: true as const, message: 'Sin egreso a tesorería: monto 0.' };
    }

    const transfer = await recordCashTransfer(user, {
      handoverId: input.handoverId,
      currency: input.currency,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
    });

    /*
      Crear la Alert conserva la regla y la auditoría; notificar a los
      Supervisores evita el fallo de UX que dejaba la autorización escondida
      hasta que alguien entraba por casualidad a Alertas/Supervisión.
    */
    const supervisors = await prisma.user.findMany({
      where: {
        active: true,
        deletedAt: null,
        role: { key: ROLE_KEYS.SUPERVISOR },
      },
      select: { id: true },
    });
    await notify(
      supervisors.map((supervisor) => ({
        userId: supervisor.id,
        type: NotificationType.ACCION_REQUERIDA,
        title: 'Autorizar egreso de Caja',
        body: `Egreso de ${input.amount.toLocaleString('es-CL')} ${input.currency}${
          input.reference ? ` · comprobante ${input.reference}` : ''
        }.`,
        link: '/notificaciones',
        entity: 'CashTransfer',
        entityId: transfer.id,
      })),
    );

    revalidatePath('/turno');
    revalidatePath('/caja');
    revalidatePath('/supervision');
    revalidatePath('/notificaciones');
    revalidatePath(`/turno/entrega/${input.handoverId}`);
    return {
      ok: true as const,
      message: `Egreso de ${input.amount} ${input.currency} registrado. Supervisión recibió la solicitud de autorización.`,
    };
  });
}

const usdRateSchema = z.object({
  handoverId: z.string().min(1),
  usdRateCLP: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce.number().int('El valor del dólar se declara en pesos enteros.').positive('El valor del dólar debe ser mayor que cero').optional(),
  ),
});

export async function saveHandoverUsdRateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const input = usdRateSchema.parse(formDataToObject(formData));
    const usdRateCLP = input.usdRateCLP;

    // Declarar dólar es opcional. Un formulario vacío no debe convertirse en 0
    // ni generar un error de validación que ensucie los logs de producción.
    if (usdRateCLP === undefined) {
      return { ok: true as const, message: 'No se declaró un nuevo valor de dólar.' };
    }

    if (!(await getSettingBool('cash.usdRateEnabled', true))) {
      throw new RuleError(
        'La declaración de tipo de cambio está desactivada en la configuración de Caja.',
      );
    }

    const handover = await prisma.shiftHandover.findUnique({
      where: { id: input.handoverId },
      include: { fromShift: { include: { assignments: true } } },
    });
    if (!handover) throw new RuleError('La entrega indicada no existe.');
    if (handover.status !== HandoverStatus.BORRADOR) {
      throw new RuleError('El dólar del turno se declara antes de enviar la entrega.');
    }
    if (!handover.fromShift.assignments.some((assignment) => assignment.userId === user.id)) {
      throw new RuleError('Sólo quien está en el turno puede declarar el dólar de la entrega.');
    }

    const perHandoverKey = `handover.usdRateCLP.${input.handoverId}`;

    await prisma.$transaction(async (tx) => {
      /*
        Dos valores distintos a propósito:
        - reception.usdRateCLP = valor operativo vigente para formularios nuevos;
        - handover.usdRateCLP.<id> = fotografía histórica de ESTA entrega.
        Cambiar el dólar mañana no reescribe un cierre anterior.
      */
      await tx.systemSetting.upsert({
        where: { key: 'reception.usdRateCLP' },
        create: {
          key: 'reception.usdRateCLP',
          value: usdRateCLP,
          category: 'recepción',
          description: 'Valor operativo vigente del dólar en pesos chilenos que usa Recepción.',
          updatedById: user.id,
        },
        update: { value: usdRateCLP, updatedById: user.id },
      });
      await tx.systemSetting.upsert({
        where: { key: perHandoverKey },
        create: {
          key: perHandoverKey,
          value: usdRateCLP,
          category: 'caja-historica',
          description: `Tipo de cambio USD/CLP utilizado en la entrega ${input.handoverId}.`,
          updatedById: user.id,
        },
        update: { value: usdRateCLP, updatedById: user.id },
      });
      await recordAudit(
        {
          entity: 'ShiftHandover',
          entityId: input.handoverId,
          action: AuditAction.CONFIGURAR,
          summary: `Tipo de cambio declarado para el turno: USD 1 = CLP ${usdRateCLP}.`,
          user,
          after: { usdRateCLP, historicalSetting: perHandoverKey },
        },
        tx,
      );
    });

    revalidatePath('/caja');
    revalidatePath(`/turno/entrega/${input.handoverId}`);
    return { ok: true as const, message: `Dólar declarado: USD 1 = CLP ${usdRateCLP}.` };
  });
}

/** Marca los elementos como declarados o confirmados según quién los envía. */
function elementMarks(formData: FormData): Record<string, boolean> {
  const marks: Record<string, boolean> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('e_')) continue;
    marks[key.slice(2)] = value === 'on' || value === 'true' || value === '1';
  }
  return marks;
}

export async function declareElementsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.handover');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));

    await markHandoverElements(user, {
      handoverId,
      field: 'declared',
      marks: elementMarks(formData),
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: 'Elementos declarados.' };
  });
}

export async function confirmElementsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('shift.receive');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));

    await markHandoverElements(user, {
      handoverId,
      field: 'confirmed',
      marks: elementMarks(formData),
    });

    revalidatePath('/turno');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return { ok: true as const, message: 'Elementos confirmados.' };
  });
}
