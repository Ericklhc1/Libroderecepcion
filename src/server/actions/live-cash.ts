'use server';

import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditAction,
  EntryStatus,
  EntryType,
  GuaranteeState,
  NotificationType,
  Priority,
} from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { recordAudit } from '@/server/audit';
import { requirePermission, requireUser } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { prisma } from '@/lib/prisma';
import type { PermissionKey } from '@/lib/permissions';
import { hasPermission } from '@/server/auth/current-user';
import { insertCashMovement, saveLiveCashAudit } from '@/server/services/live-cash';
import { changeGuaranteeState } from '@/server/services/guarantees';
import { createGymPass, voidGymPass } from '@/server/services/gym-pass';
import { getCurrentShift, getMyOpenShift } from '@/server/services/shifts';
import { notify } from '@/server/notifications';
import {
  cashApprovalRequired,
  listCashApproverIds,
} from '@/server/services/cash-permission-policy';

const gymPassSchema = z.object({
  serviceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Indica una fecha válida.'),
  roomNumber: z.string().trim().min(1, 'Indica la habitación.').max(20),
  guestName: z.string().trim().min(2, 'Indica el huésped.').max(160),
});

export async function createGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.view');
    const input = parseOrThrow(gymPassSchema, formDataToObject(formData));
    const result = await createGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/caja/gimnasio');
    return {
      ok: true as const,
      message: `Folio de gimnasio ${result.formattedFolio} generado.`,
      id: result.id,
    };
  });
}

const voidSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(5, 'Indica por qué se anula el folio.').max(500),
});

export async function voidGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.view');
    const input = parseOrThrow(voidSchema, formDataToObject(formData));
    await voidGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/caja/gimnasio');
    return { ok: true as const, message: 'Folio anulado. La trazabilidad se conserva.' };
  });
}

const movementSchema = z.object({
  direction: z.enum(['ENTRADA', 'SALIDA']),
  currency: z.enum(['CLP', 'USD']),
  amount: z.coerce.number().positive('El monto debe ser mayor que cero.'),
  reference: z.string().trim().min(2, 'Indica el concepto del movimiento.').max(120),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

type ManualMovementInput = z.infer<typeof movementSchema>;

async function applyAuthorizedManualMovement(
  user: Awaited<ReturnType<typeof requireUser>>,
  input: ManualMovementInput,
  shiftId: string | null,
) {
  const kind = input.direction === 'ENTRADA' ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
  const verb = input.direction === 'ENTRADA' ? 'Ingreso' : 'Egreso';

  return prisma.$transaction(async (tx) => {
    const movementId = await insertCashMovement(tx, {
      userId: user.id,
      kind,
      direction: input.direction,
      currency: input.currency,
      amount: input.amount,
      shiftId,
      reference: input.reference,
      notes: input.notes,
    });

    const entry = await tx.operationalEntry.create({
      data: {
        type: EntryType.CAJA,
        status: EntryStatus.RESUELTO,
        title: `${verb} de Caja · ${input.reference}`,
        description:
          `${verb} de ${input.currency} ${input.amount}. Concepto: ${input.reference}.` +
          (input.notes ? ` Observaciones: ${input.notes}` : ''),
        category: kind,
        priority: shiftId ? Priority.BAJA : Priority.CRITICA,
        ownerId: user.id,
        shiftId,
        occurredAt: new Date(),
        tags: [
          'caja',
          input.direction.toLowerCase(),
          'permiso-rol',
          ...(!shiftId ? ['movimiento-sin-sesion-caja'] : []),
        ],
        requiresFollowUp: !shiftId,
        resolution: shiftId
          ? 'Movimiento registrado con trazabilidad financiera.'
          : null,
        createdById: user.id,
      },
      select: { id: true },
    });

    let noSessionAlertId: string | null = null;
    if (!shiftId) {
      const alert = await tx.alert.create({
        data: {
          type: AlertType.OTRO,
          level: AlertLevel.CRITICA,
          status: AlertStatus.NUEVA,
          title: 'MOVIMIENTO SIN SESIÓN DE CAJA',
          message:
            `${verb} de ${input.currency} ${input.amount.toLocaleString('es-CL')} · ${input.reference}. ` +
            `Registrado por ${user.name} sin turno operativo abierto. Revisar y regularizar trazabilidad.`,
          entryId: entry.id,
          dedupeKey: `cash-no-session:${movementId}`,
          auto: false,
          createdById: user.id,
        },
        select: { id: true },
      });
      noSessionAlertId = alert.id;
    }

    await recordAudit(
      {
        entity: 'CashMovement',
        entityId: movementId,
        action: AuditAction.CREAR,
        user,
        summary: `${verb} de Caja ${input.currency} ${input.amount} · ${input.reference}`,
        after: {
          direction: input.direction,
          currency: input.currency,
          amount: input.amount,
          reference: input.reference,
          notes: input.notes,
          shiftId,
          withoutCashSession: !shiftId,
          noSessionAlertId,
          performedBy: user.id,
        },
      },
      tx,
    );

    return movementId;
  });
}

export async function createManualCashMovementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(movementSchema, formDataToObject(formData));
    const permission: PermissionKey = input.direction === 'ENTRADA' ? 'cash.manual_in' : 'cash.manual_out';
    if (!hasPermission(user, permission)) {
      throw new RuleError(`Tu rol no tiene habilitado ${input.direction === 'ENTRADA' ? 'registrar ingresos' : 'registrar egresos'} manuales de Caja.`);
    }
    const shift = await getMyOpenShift(user.id) ?? await getCurrentShift();

    const verb = input.direction === 'ENTRADA' ? 'Ingreso' : 'Egreso';
    const needsApproval = await cashApprovalRequired(user, permission);

    if (!needsApproval) {
      const movementId = await applyAuthorizedManualMovement(user, input, shift?.id ?? null);
      revalidatePath('/caja');
      revalidatePath('/libro');
      revalidatePath('/turno');
      return {
        ok: true as const,
        message: shift
          ? `${verb} registrado: ${input.currency} ${input.amount.toLocaleString('es-CL')}.`
          : `${verb} registrado sin turno abierto. Se generó la alerta crítica «MOVIMIENTO SIN SESIÓN DE CAJA» para Supervisión.`,
        id: movementId,
      };
    }

    const approverIds = await listCashApproverIds();
    if (approverIds.length === 0) {
      throw new RuleError(
        'Esta operación exige autorización, pero no hay ningún rol activo con permiso cash.approve.',
      );
    }

    const request = await prisma.$transaction(async (tx) => {
      const entry = await tx.operationalEntry.create({
        data: {
          type: EntryType.CAJA,
          status: EntryStatus.EN_ESPERA,
          title: `Solicitud de ${verb.toLowerCase()} de caja · ${input.reference}`,
          description:
            `${verb} solicitado por ${input.currency} ${input.amount}. ` +
            `Concepto: ${input.reference}.${input.notes ? ` Observaciones: ${input.notes}` : ''}` +
            (!shift ? ' No existe turno operativo abierto al momento de la solicitud.' : ''),
          category: 'AJUSTE_CAJA_SOLICITADO',
          priority: shift ? Priority.ALTA : Priority.CRITICA,
          ownerId: user.id,
          shiftId: shift?.id ?? null,
          occurredAt: new Date(),
          tags: [
            'caja',
            'autorizacion-pendiente',
            ...(!shift ? ['movimiento-sin-sesion-caja'] : []),
            `direccion-${input.direction}`,
            `moneda-${input.currency}`,
            `monto-${input.amount}`,
            `referencia-${encodeURIComponent(input.reference)}`,
            ...(input.notes ? [`notas-${encodeURIComponent(input.notes)}`] : []),
          ],
          requiresFollowUp: true,
          createdById: user.id,
        },
        select: { id: true, seq: true },
      });

      const alert = await tx.alert.create({
        data: {
          type: AlertType.OTRO,
          level: AlertLevel.ATENCION,
          status: AlertStatus.NUEVA,
          title: `Autorizar ${verb.toLowerCase()} de Caja`,
          message: `${input.currency} ${input.amount.toLocaleString('es-CL')} · ${input.reference}. Solicitado por ${user.name}.`,
          entryId: entry.id,
          dedupeKey: `cash-manual:${entry.id}`,
          auto: false,
          createdById: user.id,
        },
        select: { id: true },
      });

      await recordAudit(
        {
          entity: 'OperationalEntry',
          entityId: entry.id,
          action: AuditAction.CREAR,
          user,
          summary: `Solicitud de autorización: ${verb} ${input.currency} ${input.amount} · ${input.reference}`,
          after: {
            shiftId: shift?.id ?? null,
            alertId: alert.id,
            withoutCashSession: !shift,
            permission,
            status: 'PENDIENTE_APROBACION',
          },
        },
        tx,
      );

      return { entry, alert };
    });

    await notify(
      approverIds.map((userId) => ({
        userId,
        type: NotificationType.ACCION_REQUERIDA,
        title: `Autorizar ${verb.toLowerCase()} de Caja`,
        body: `${input.currency} ${input.amount.toLocaleString('es-CL')} · ${input.reference}`,
        link: '/notificaciones',
        entity: 'Alert',
        entityId: request.alert.id,
      })),
    );

    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/supervision');
    revalidatePath('/notificaciones');
    return {
      ok: true as const,
      message: `${verb} solicitado. Caja no cambia hasta que alguien con permiso de aprobación lo autorice.`,
      id: request.entry.id,
    };
  });
}

const returnGuaranteeSchema = z.object({
  guaranteeId: z.string().min(1),
});

export async function returnCashGuaranteeAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.guarantee_out');
    const input = parseOrThrow(returnGuaranteeSchema, formDataToObject(formData));

    await changeGuaranteeState(user, {
      id: input.guaranteeId,
      state: GuaranteeState.DEVUELTA,
    });

    revalidatePath('/caja');
    revalidatePath('/turno');
    revalidatePath('/libro');

    return {
      ok: true as const,
      message: 'Garantía devuelta. El efectivo salió de Caja y quedó registrado con trazabilidad.',
    };
  });
}

const auditSchema = z.object({
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function saveLiveCashAuditAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('cash.audit');
    const input = parseOrThrow(auditSchema, formDataToObject(formData));

    const quantityEntries = [...formData.entries()]
      .filter(([key]) => key.startsWith('d_'))
      .map(([key, raw]) => ({
        denominationId: key.slice(2),
        quantity: raw === '' ? 0 : Number(raw),
      }));

    for (const row of quantityEntries) {
      if (!Number.isInteger(row.quantity) || row.quantity < 0) {
        throw new RuleError('Las cantidades por denominación deben ser números enteros no negativos.');
      }
    }

    const denominationIds = quantityEntries.map((row) => row.denominationId);
    const denominations = denominationIds.length
      ? await prisma.cashDenomination.findMany({
          where: {
            id: { in: denominationIds },
            active: true,
            currency: input.currency,
          },
          select: { id: true, value: true },
        })
      : [];

    if (denominations.length !== denominationIds.length) {
      throw new RuleError('El conteo contiene una denominación inválida para esa divisa.');
    }

    const byId = new Map(denominations.map((row) => [row.id, Number(row.value)]));
    const countedAmount = quantityEntries.reduce(
      (total, row) => total + (byId.get(row.denominationId) ?? 0) * row.quantity,
      0,
    );

    const result = await saveLiveCashAudit(user, {
      currency: input.currency,
      countedAmount,
      notes: input.notes,
    });

    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/turno');

    return {
      ok: true as const,
      message:
        result.difference === 0
          ? `Caja ${input.currency} corroborada por denominación: cuadra exactamente.`
          : `Caja ${input.currency} corroborada por denominación: diferencia ${result.difference > 0 ? '+' : ''}${result.difference}. La diferencia queda registrada y no bloquea la operación.`,
    };
  });
}
