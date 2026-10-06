'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  InventoryBehavior,
  InventoryLocationKind,
  InventoryMovementKind,
} from '@prisma/client';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  type ActionState,
} from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import {
  recordInventoryMovement,
  saveInventoryCategory,
  saveInventoryItem,
  saveInventoryLocation,
} from '@/server/services/inventory';

const optionalText = z.string().trim().optional().transform((value) => value || null);
const optionalMoney = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

function refresh() {
  revalidatePath('/inventario');
  revalidatePath('/lavanderia');
}

const categorySchema = z.object({
  id: z.string().trim().optional().transform((value) => value || undefined),
  departmentId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  active: z.string().optional().transform((value) => value !== 'false'),
});

export async function saveInventoryCategoryAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('inventory.manage');
    const input = parseOrThrow(categorySchema, formDataToObject(formData));
    const row = await saveInventoryCategory(user, input);
    refresh();
    return { ok: true as const, id: row.id, message: 'Categoría guardada.' };
  });
}

const itemSchema = z.object({
  id: z.string().trim().optional().transform((value) => value || undefined),
  categoryId: z.string().min(1),
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(160),
  behavior: z.nativeEnum(InventoryBehavior),
  unit: z.string().trim().max(60).optional(),
  presentation: optionalText,
  trackIndividually: z.string().optional().transform((value) => ['1','true','on'].includes(value ?? '')),
  active: z.string().optional().transform((value) => value !== 'false'),
  cost: optionalMoney,
  costCurrency: optionalText,
  replacementEstimate: optionalMoney,
  replacementCurrency: optionalText,
  replacementSource: optionalText,
  replacementDate: z.string().trim().optional().transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : null),
  accountingValue: optionalMoney,
  accountingCurrency: optionalText,
});

export async function saveInventoryItemAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('inventory.manage');
    const input = parseOrThrow(itemSchema, formDataToObject(formData));
    const row = await saveInventoryItem(user, input);
    refresh();
    return { ok: true as const, id: row.id, message: `Artículo #${row.humanId} guardado.` };
  });
}

const locationSchema = z.object({
  id: z.string().trim().optional().transform((value) => value || undefined),
  key: optionalText,
  departmentId: optionalText,
  name: z.string().trim().min(2).max(120),
  kind: z.nativeEnum(InventoryLocationKind),
  active: z.string().optional().transform((value) => value !== 'false'),
});

export async function saveInventoryLocationAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('inventory.manage');
    const input = parseOrThrow(locationSchema, formDataToObject(formData));
    const row = await saveInventoryLocation(user, input);
    refresh();
    return { ok: true as const, id: row.id, message: 'Ubicación guardada.' };
  });
}

const movementSchema = z.object({
  requestKey: z.string().min(8).max(180),
  itemId: z.string().min(1),
  assetId: optionalText,
  kind: z.nativeEnum(InventoryMovementKind),
  quantity: z.coerce.number().positive().finite(),
  fromLocationId: optionalText,
  toLocationId: optionalText,
  reason: z.string().trim().min(3).max(500),
  notes: optionalText,
});

export async function recordInventoryMovementAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('inventory.move');
    const input = parseOrThrow(movementSchema, formDataToObject(formData));
    const result = await recordInventoryMovement(user, input);
    refresh();
    return {
      ok: true as const,
      id: result.movement.id,
      message: result.repeated ? 'El movimiento ya estaba registrado.' : `Movimiento #${result.movement.humanId} registrado.`,
    };
  });
}
