'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { KeyType } from '@prisma/client';
import { hasAnyPermission } from '@/server/auth/current-user';
import { requirePermission, requireUser } from '@/server/auth/guard';
import { ForbiddenError, RuleError } from '@/server/errors';
import { assertReceptionOperationPermission } from '@/server/services/reception-operation-gate';
import { runAction, type ActionState } from '@/server/action';
import {
  assignPhysicalKey,
  createPhysicalKey,
  isInventoryFloor,
  markPhysicalKeyIncident,
  recoverPhysicalKey,
  retirePhysicalKey,
  returnPhysicalKey,
  savePhysicalKeyInventoryCount,
} from '@/server/services/key-inventory';
import {
  operationalDurationMs,
  operationalStartedAtFromEpoch,
  recordOperationalEvent,
} from '@/server/observability/operational';

function refreshKeys() {
  revalidatePath('/llaves');
  revalidatePath('/supervision');
  revalidatePath('/admin/auditoria');
}

async function requireKeyInventoryAccess() {
  const user = await requireUser();
  if (!hasAnyPermission(user, ['key.inventory', 'key.stock'])) {
    throw new ForbiddenError('No tienes permiso para realizar inventarios de llaves.');
  }
  await assertReceptionOperationPermission(user, 'key.inventory');
  return user;
}

function requiredString(formData: FormData, name: string, label: string) {
  const value = formData.get(name);
  if (typeof value !== 'string' || !value.trim()) {
    throw new RuleError(`${label} es obligatorio.`);
  }
  return value.trim();
}

function optionalString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: FormDataEntryValue | null, label: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RuleError(`${label} es obligatorio.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RuleError(`${label} debe ser un número entero igual o mayor que cero.`);
  }
  return parsed;
}

function metricCorrelationId(value: FormDataEntryValue | null, floor: number): string {
  if (typeof value === 'string' && value.length >= 10 && value.length <= 128) return value;
  return `key-inventory:${floor}:${randomUUID()}`;
}

export async function startKeyInventoryMetricAction(input: {
  floor: number;
  correlationId: string;
  startedAtMs: number;
}): Promise<void> {
  const user = await requireKeyInventoryAccess();
  if (!isInventoryFloor(input.floor)) throw new RuleError('El piso debe ser 4, 5 o 6.');
  if (input.correlationId.length < 10 || input.correlationId.length > 128) return;

  const startedAt = operationalStartedAtFromEpoch(input.startedAtMs);
  recordOperationalEvent({
    eventType: 'KEY_INVENTORY_STARTED',
    userId: user.id,
    entityType: 'KeyInventoryFloor',
    entityId: String(input.floor),
    correlationId: input.correlationId,
    startedAt,
    status: 'STARTED',
    source: 'CLIENT_UI',
    metadata: { floor: input.floor },
  });
}

export async function savePhysicalKeyCountAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireKeyInventoryAccess();
    const floor = Number(formData.get('floor'));
    if (!isInventoryFloor(floor)) throw new RuleError('El piso debe ser 4, 5 o 6.');

    const roomIds = formData
      .getAll('roomId')
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (!roomIds.length) throw new RuleError('No hay habitaciones para contar en este piso.');

    const correlationId = metricCorrelationId(formData.get('metricCorrelationId'), floor);
    const startedAt = operationalStartedAtFromEpoch(formData.get('metricStartedAt'));
    const hasClientStart =
      typeof formData.get('metricCorrelationId') === 'string' &&
      typeof formData.get('metricStartedAt') === 'string' &&
      Boolean(String(formData.get('metricCorrelationId')).trim()) &&
      Boolean(String(formData.get('metricStartedAt')).trim());

    if (!hasClientStart) {
      recordOperationalEvent({
        eventType: 'KEY_INVENTORY_STARTED',
        userId: user.id,
        entityType: 'KeyInventoryFloor',
        entityId: String(floor),
        correlationId,
        startedAt,
        status: 'STARTED',
        metadata: { floor },
      });
    }

    const result = await savePhysicalKeyInventoryCount(user, {
      floor,
      notes: optionalString(formData, 'notes'),
      items: roomIds.map((roomId) => ({
        roomId,
        found: nonNegativeInteger(formData.get(`found:${roomId}`), 'Cantidad encontrada'),
        outOfService: nonNegativeInteger(
          formData.get(`outOfService:${roomId}`),
          'Cantidad fuera de servicio',
        ),
        notes: optionalString(formData, `notes:${roomId}`),
      })),
    });

    const completedAt = new Date();
    const hasDifference = result.totals.missing > 0 || result.totals.surplus > 0;
    recordOperationalEvent({
      eventType: 'KEY_INVENTORY_COMPLETED',
      userId: user.id,
      entityType: 'KeyInventoryCount',
      entityId: result.id,
      correlationId,
      startedAt,
      completedAt,
      durationMs: operationalDurationMs(startedAt, completedAt),
      status: 'SUCCESS',
      metadata: { floor, hasDifference },
    });
    if (hasDifference) {
      recordOperationalEvent({
        eventType: 'KEY_INVENTORY_WITH_DIFFERENCES',
        userId: user.id,
        entityType: 'KeyInventoryCount',
        entityId: result.id,
        correlationId,
        completedAt,
        status: 'SUCCESS',
        metadata: { floor, hasDifference: true },
      });
    }

    refreshKeys();
    return {
      ok: true as const,
      message:
        `Inventario del piso ${floor} guardado: ${result.totals.found}/${result.totals.expected} encontradas; ` +
        `${result.totals.missing} faltante(s), ${result.totals.surplus} sobrante(s), ` +
        `${result.totals.outOfService} fuera de servicio.`,
    };
  });
}

export async function createPhysicalKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const typeRaw = requiredString(formData, 'type', 'El tipo');
    if (!Object.values(KeyType).includes(typeRaw as KeyType)) {
      throw new RuleError('El tipo de llave no es válido.');
    }

    const key = await createPhysicalKey(user, {
      code: requiredString(formData, 'code', 'El código'),
      roomId: requiredString(formData, 'roomId', 'La habitación'),
      type: typeRaw as KeyType,
      notes: optionalString(formData, 'notes'),
    });

    refreshKeys();
    return { ok: true as const, message: `Llave ${key.code} ingresada al inventario.` };
  });
}

export async function assignPhysicalKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.assign');
    const key = await assignPhysicalKey(user, {
      keyId: requiredString(formData, 'keyId', 'La llave'),
      roomId: requiredString(formData, 'roomId', 'La habitación'),
      note: optionalString(formData, 'note'),
    });
    refreshKeys();
    return { ok: true as const, message: `Llave ${key.code} entregada/asignada.` };
  });
}

export async function returnPhysicalKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.assign');
    const key = await returnPhysicalKey(user, {
      keyId: requiredString(formData, 'keyId', 'La llave'),
      note: optionalString(formData, 'note'),
    });
    refreshKeys();
    return { ok: true as const, message: `Llave ${key.code} devuelta al inventario.` };
  });
}

export async function markPhysicalKeyIncidentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const status = requiredString(formData, 'status', 'El estado');
    if (status !== 'EXTRAVIADA' && status !== 'FUERA_DE_SERVICIO') {
      throw new RuleError('El estado seleccionado no es válido.');
    }
    const key = await markPhysicalKeyIncident(user, {
      keyId: requiredString(formData, 'keyId', 'La llave'),
      status,
      reason: requiredString(formData, 'reason', 'El motivo'),
    });
    refreshKeys();
    return {
      ok: true as const,
      message: `Llave ${key.code} marcada como ${status === 'EXTRAVIADA' ? 'extraviada' : 'fuera de servicio'}.`,
    };
  });
}

export async function recoverPhysicalKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const key = await recoverPhysicalKey(user, {
      keyId: requiredString(formData, 'keyId', 'La llave'),
      note: optionalString(formData, 'note'),
    });
    refreshKeys();
    return { ok: true as const, message: `Llave ${key.code} recuperada y disponible.` };
  });
}

export async function retirePhysicalKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const key = await retirePhysicalKey(user, {
      keyId: requiredString(formData, 'keyId', 'La llave'),
      reason: requiredString(formData, 'reason', 'El motivo'),
    });
    refreshKeys();
    return { ok: true as const, message: `Llave ${key.code} dada de baja.` };
  });
}
