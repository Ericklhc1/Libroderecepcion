'use server';

import { revalidatePath } from 'next/cache';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditAction,
  HandoverStatus,
  NotificationType,
} from '@prisma/client';
import { z } from 'zod';
import { formDataToObject, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import {
  markHandoverElements,
  recordCashTransfer,
  saveCashCount,
} from '@/server/services/cash';
import { getMyActiveShift, receiveShiftCash } from '@/server/services/shifts';
import { getSettingBool } from '@/server/services/settings';
import { fromMinor } from '@/domain/cash';
import { ROLE_KEYS } from '@/lib/permissions';
import { notify } from '@/server/notifications';
import {
  cashApprovalRequired,
  listCashApproverIds,
} from '@/server/services/cash-permission-policy';

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
    const user = await requirePermission('cash.count_declare');
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
    const user = await requirePermission('cash.count_receive');
    const { handoverId } = handoverIdSchema.parse(formDataToObject(formData));
    const notes = formData.get('notes');

    const shift = await getMyActiveShift(user.id);
    if (!shift) {
      throw new RuleError('Abre tu turno antes de recibir la Caja.');
    }
    const result = await receiveShiftCash(user, {
      shiftId: shift.id,
      handoverId,
      quantities: quantitiesFrom(formData),
      notes: typeof notes === 'string' ? notes : null,
    });

    revalidatePath('/turno');
    revalidatePath('/caja');
    revalidatePath('/supervision');
    revalidatePath('/notificaciones');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return {
      ok: true as const,
      message:
        summarise(result.statuses) +
        (result.discrepancies.length
          ? ' Hay una diferencia registrada para revisión de Supervisión.'
          : ' Caja recibida sin diferencias.'),
    };
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
    const user = await requirePermission('cash.treasury_transfer');
    const input = transferSchema.parse(formDataToObject(formData));

    if (input.amount === 0) {
      return { ok: true as const, message: 'Sin transferencia a Tesorería: monto 0.' };
    }

    const needsApproval = await cashApprovalRequired(user, 'cash.treasury_transfer');
    const approverIds = needsApproval ? await listCashApproverIds() : [];
    if (needsApproval && approverIds.length === 0) {
      throw new RuleError(
        'Este egreso exige autorización, pero no hay ningún rol activo con permiso cash.approve.',
      );
    }

    const transfer = await recordCashTransfer(user, {
      handoverId: input.handoverId,
      currency: input.currency,
      amount: input.amount,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      applyToLiveCash: !needsApproval,
    });

    if (needsApproval) {
      const alert = await prisma.alert.upsert({
        where: { dedupeKey: `cash-transfer:${transfer.id}` },
        create: {
          type: AlertType.OTRO,
          level: AlertLevel.ATENCION,
          status: AlertStatus.NUEVA,
          title: 'Autorizar egreso a tesorería',
          message: `${input.currency} ${input.amount.toLocaleString('es-CL')}${input.reference ? ` · ${input.reference}` : ''}`,
          handoverId: input.handoverId,
          dedupeKey: `cash-transfer:${transfer.id}`,
          auto: false,
          createdById: user.id,
        },
        update: {
          status: AlertStatus.NUEVA,
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
          deletedAt: null,
        },
      });

      await notify(
        approverIds.map((userId) => ({
          userId,
          type: NotificationType.ACCION_REQUERIDA,
          title: 'Autorizar egreso a tesorería',
          body: `${input.currency} ${input.amount.toLocaleString('es-CL')}${input.reference ? ` · ${input.reference}` : ''}`,
          link: '/notificaciones',
          entity: 'Alert',
          entityId: alert.id,
        })),
      );
    }

    revalidatePath('/turno');
    revalidatePath('/caja');
    revalidatePath('/supervision');
    revalidatePath('/notificaciones');
    revalidatePath(`/turno/entrega/${input.handoverId}`);
    return {
      ok: true as const,
      message: needsApproval
        ? `Egreso de ${input.amount} ${input.currency} solicitado; Caja se actualizará al aprobarlo.`
        : `Egreso de ${input.amount} ${input.currency} registrado en Caja central.`,
    };
  });
}

const usdRateSchema = z.object({
  handoverId: z.string().min(1),
  usdRateCLP: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    z.coerce
      .number()
      .int('El valor del dólar se declara en pesos enteros.')
      .positive('El valor del dólar debe ser mayor que cero')
      .optional(),
  ),
});

export async function saveHandoverUsdRateAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.usd_rate');
    const input = usdRateSchema.parse(formDataToObject(formData));
    const usdRateCLP = input.usdRateCLP;

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
    const marks = elementMarks(formData);
    const selected = Object.values(marks).filter(Boolean).length;
    const justificationRaw = formData.get('noneJustification');
    const justification = typeof justificationRaw === 'string' ? justificationRaw.trim() : '';

    if (selected === 0 && justification.length < 5) {
      throw new RuleError(
        'Si no entregas ningún elemento, deja una justificación breve para revisión de Supervisión.',
      );
    }

    const notes =
      selected === 0
        ? Object.fromEntries(Object.keys(marks).map((id) => [id, justification]))
        : undefined;

    await markHandoverElements(user, {
      handoverId,
      field: 'declared',
      marks,
      notes,
    });

    const dedupeKey = `handover-elements-none:${handoverId}`;
    if (selected === 0) {
      const alert = await prisma.alert.upsert({
        where: { dedupeKey },
        create: {
          type: AlertType.OTRO,
          level: AlertLevel.ATENCION,
          status: AlertStatus.NUEVA,
          title: 'Revisar entrega sin elementos físicos',
          message: justification,
          handoverId,
          dedupeKey,
          auto: false,
          createdById: user.id,
        },
        update: {
          status: AlertStatus.NUEVA,
          title: 'Revisar entrega sin elementos físicos',
          message: justification,
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
          deletedAt: null,
        },
      });
      const supervisors = await prisma.user.findMany({
        where: { active: true, deletedAt: null, role: { key: ROLE_KEYS.SUPERVISOR } },
        select: { id: true },
      });
      await notify(
        supervisors.map((supervisor) => ({
          userId: supervisor.id,
          type: NotificationType.ACCION_REQUERIDA,
          title: 'Revisar entrega sin elementos',
          body: justification,
          link: '/notificaciones',
          entity: 'Alert',
          entityId: alert.id,
        })),
      );
    } else {
      await prisma.alert.updateMany({
        where: { dedupeKey, status: { not: AlertStatus.RESUELTA } },
        data: {
          status: AlertStatus.RESUELTA,
          resolvedAt: new Date(),
          resolutionNote: 'La entrega fue actualizada y ahora declara elementos.',
        },
      });
    }

    revalidatePath('/turno');
    revalidatePath('/supervision');
    revalidatePath('/notificaciones');
    revalidatePath(`/turno/entrega/${handoverId}`);
    return {
      ok: true as const,
      message:
        selected > 0
          ? `${selected} elemento(s) declarado(s).`
          : 'Entrega sin elementos declarada. Supervisión recibió la justificación para revisión; no bloquea el cierre.',
    };
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
