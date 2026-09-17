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
import { saveLiveCashAudit } from '@/server/services/live-cash';
import { createGymPass, voidGymPass } from '@/server/services/gym-pass';
import { getMyOpenShift } from '@/server/services/shifts';

const gymPassSchema = z.object({
  stayId: z.string().min(1),
  currency: z.enum(['CLP', 'USD']),
  paymentMethod: z.enum(['EFECTIVO', 'TARJETA', 'OTRO']),
});

export async function createGymPassAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(gymPassSchema, formDataToObject(formData));
    const pass = await createGymPass(user, input);
    revalidatePath('/caja');
    revalidatePath('/libro');
    revalidatePath('/habitaciones');
    return {
      ok: true as const,
      message: `Folio ${pass.formattedFolio} generado. Escríbelo en el pase físico.`,
      id: pass.id,
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
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

export async function saveLiveCashAuditAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.view');
    const input = parseOrThrow(auditSchema, formDataToObject(formData));
    const result = await saveLiveCashAudit(user, input);
    revalidatePath('/caja');
    const difference = result.difference;
    return {
      ok: true as const,
      message:
        difference === 0
          ? `Caja ${input.currency} auditada: cuadra exactamente.`
          : `Caja ${input.currency} auditada: diferencia ${difference > 0 ? '+' : ''}${difference}.`,
    };
  });
}
