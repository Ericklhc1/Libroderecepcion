'use server';

import { randomUUID } from 'node:crypto';
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
import { saveLiveCashAudit } from '@/server/services/live-cash';
import { changeGuaranteeState } from '@/server/services/guarantees';
import { createGymPass, voidGymPass } from '@/server/services/gym-pass';
import { getCurrentShift, getMyOpenShift } from '@/server/services/shifts';
import { notify } from '@/server/notifications';
import {
  cashApprovalRequired,
  listCashApproverIds,
} from '@/server/services/cash-permission-policy';

const gymPassSchema = z.object({
  stayId: z.string().min(1),
  pax: z.coerce.number().int().min(1, 'Indica al menos 1 pax.').max(20, 'Máximo 20 pax por emisión.'),
});

export async function createGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(gymPassSchema, formDataToObject(formData));
    const result = await createGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/habitaciones');
    const folios = result.passes.map((pass) => pass.formattedFolio).join(', ');
    return {
      ok: true as const,
      message: `${result.passes.length} folio(s) generado(s): ${folios}.`,
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
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(voidSchema, formDataToObject(formData));
    await voidGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/habitaciones');
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
  shiftId: string,
) {
  const movementId = randomUUID();
  const kind = input.direction === 'ENTRADA' ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
  const verb = input.direction === 'ENTRADA' ? 'Ingreso' : 'Egreso';

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "CashMovement" (
        "id", "kind", "direction", "currency", "amount", "shiftId",
        "createdById", "reference", "notes"
      ) VALUES (
        ${movementId}, ${kind}, ${input.direction}, ${input.currency}, ${input.amount},
        ${shiftId}, ${user.id}, ${input.reference}, ${input.notes}
      )
    `;

    await tx.operationalEntry.create({
      data: {
        type: EntryType.CAJA,
        status: EntryStatus.RESUELTO,
        title: `${verb} de caja · ${input.reference}`,
        description: `${verb} de ${input.currency} ${input.amount}. Concepto: ${input.reference}.${input.notes ? ` Observaciones: ${input.notes}` : ''}`,
        category: kind,
        priority: Priority.BAJA,
        ownerId: user.id,
        shiftId,
        occurredAt: new Date(),
        tags: ['caja', input.direction.toLowerCase(), 'permiso-rol'],
        requiresFollowUp: false,
        resolution: 'Movimiento registrado según la matriz vigente de permisos de Caja.',
        createdById: user.id,
      },
    });

    await recordAudit(
      {
        entity: 'CashMovement',
        entityId: movementId,
        action: AuditAction.CREAR,
        user,
        summary: `${verb} de caja ${input.currency} ${input.amount} · ${input.reference}`,
        after: {
          direction: input.direction,
          currency: input.currency,
          amount: input.amount,
          reference: input.reference,
          notes: input.notes,
          shiftId,
          performedBy: user.id,
        },
      },
      tx,
    );
  });

  return movementId;
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
    if (!shift) {
      throw new RuleError('Debe existir un turno operativo antes de registrar movimientos de caja.');
    }

    const verb = input.direction === 'ENTRADA' ? 'Ingreso' : 'Egreso';
    const needsApproval = await cashApprovalRequired(user, permission);

    if (!needsApproval) {
      const movementId = await applyAuthorizedManualMovement(user, input, shift.id);
      revalidatePath('/caja');
      revalidatePath('/libro');
      revalidatePath('/turno');
      return {
        ok: true as const,
        message: `${verb} registrado: ${input.currency} ${input.amount.toLocaleString('es-CL')}.`,
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
            `Concepto: ${input.reference}.${input.notes ? ` Observaciones: ${input.notes}` : ''}`,
          category: 'AJUSTE_CAJA_SOLICITADO',
          priority: Priority.ALTA,
          ownerId: user.id,
          shiftId: shift.id,
          occurredAt: new Date(),
          tags: [
            'caja',
            'autorizacion-pendiente',
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
            shiftId: shift.id,
            alertId: alert.id,
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
    revalidatePath('/habitaciones');
    revalidatePath('/huespedes');
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
