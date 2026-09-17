'use server';

import { randomUUID } from 'node:crypto';
import { AuditAction, EntryStatus, EntryType, Priority } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { recordAudit } from '@/server/audit';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { saveLiveCashAudit } from '@/server/services/live-cash';
import { createGymPass, voidGymPass } from '@/server/services/gym-pass';
import { getCurrentShift, getMyOpenShift } from '@/server/services/shifts';

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

export async function createManualCashMovementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(movementSchema, formDataToObject(formData));
    const shift = await getMyOpenShift(user.id);
    if (!shift) {
      throw new RuleError('Debes abrir o recibir el turno antes de registrar movimientos de caja.');
    }

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
          ${shift.id}, ${user.id}, ${input.reference}, ${input.notes}
        )
      `;

      await tx.operationalEntry.create({
        data: {
          type: EntryType.CAJA,
          status: EntryStatus.RESUELTO,
          title: `${verb} de caja · ${input.reference}`,
          description: `${verb} manual de ${input.currency} ${input.amount}. Concepto: ${input.reference}.${input.notes ? ` Observaciones: ${input.notes}` : ''}`,
          category: kind,
          priority: Priority.BAJA,
          ownerId: user.id,
          shiftId: shift.id,
          occurredAt: new Date(),
          tags: ['caja', input.direction.toLowerCase()],
          requiresFollowUp: false,
          resolution: 'Movimiento registrado en Caja viva.',
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
            shiftId: shift.id,
          },
        },
        tx,
      );
    });

    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/turno');
    return {
      ok: true as const,
      message: `${verb} registrado: ${input.currency} ${input.amount.toLocaleString('es-CL')}.`,
      id: movementId,
    };
  });
}

const auditSchema = z.object({
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  countedAmount: z.coerce.number().nonnegative(),
  reconcile: z.enum(['SI', 'NO']).default('NO'),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function saveLiveCashAuditAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.view');
    if (user.roleKey !== ROLE_KEYS.SUPERVISOR) {
      throw new RuleError('La reconciliación de Caja sólo puede realizarla un Supervisor.');
    }

    const input = parseOrThrow(auditSchema, formDataToObject(formData));
    const result = await saveLiveCashAudit(user, input);
    const difference = result.difference;
    let reconciled = false;

    if (difference !== 0 && input.reconcile === 'SI') {
      const shift = await getCurrentShift();
      if (!shift) {
        throw new RuleError('No existe un turno operativo al que asociar el ajuste de cuadratura.');
      }

      const direction = difference > 0 ? 'ENTRADA' : 'SALIDA';
      const kind = difference > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
      const adjustment = Math.abs(difference);
      const movementId = randomUUID();
      const reference = `Ajuste autorizado por Supervisión · auditoría ${input.currency}`;

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "CashMovement" (
            "id", "kind", "direction", "currency", "amount", "shiftId",
            "createdById", "reference", "notes"
          ) VALUES (
            ${movementId}, ${kind}, ${direction}, ${input.currency}, ${adjustment},
            ${shift.id}, ${user.id}, ${reference}, ${input.notes}
          )
        `;

        await tx.operationalEntry.create({
          data: {
            type: EntryType.CAJA,
            status: EntryStatus.RESUELTO,
            title: `Ajuste de cuadratura ${input.currency}`,
            description:
              `Supervisión actualizó el saldo esperado para hacerlo coincidir con el conteo físico. ` +
              `Esperado anterior: ${result.expected}. Contado: ${input.countedAmount}. ` +
              `Ajuste: ${direction === 'ENTRADA' ? '+' : '−'}${adjustment} ${input.currency}.`,
            category: kind,
            priority: Priority.MEDIA,
            ownerId: user.id,
            shiftId: shift.id,
            occurredAt: new Date(),
            tags: ['caja', 'cuadratura', 'ajuste-supervision'],
            requiresFollowUp: false,
            resolution: 'Diferencia reconciliada por Supervisión.',
            createdById: user.id,
          },
        });

        await recordAudit(
          {
            entity: 'CashMovement',
            entityId: movementId,
            action: AuditAction.CONFIGURAR,
            user,
            summary: `Supervisor reconcilió Caja ${input.currency}: ajuste ${direction} ${adjustment}`,
            before: { expected: result.expected, counted: input.countedAmount, difference },
            after: { expected: input.countedAmount, difference: 0 },
            reason: input.notes,
          },
          tx,
        );
      });
      reconciled = true;
    }

    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/turno');
    const message =
      difference === 0
        ? `Caja ${input.currency} auditada: cuadra exactamente.`
        : reconciled
          ? `Caja ${input.currency} auditada y reconciliada por Supervisión. Diferencia eliminada mediante ajuste trazable.`
          : `Caja ${input.currency} auditada: diferencia ${difference > 0 ? '+' : ''}${difference}. Se conserva sin modificar el saldo esperado.`;
    return { ok: true as const, message };
  });
}
