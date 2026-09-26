import 'server-only';

import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const P0_OPERATIONAL_EVENT_TYPES = [
  'SHIFT_START_REQUESTED',
  'SHIFT_STARTED',
  'SHIFT_START_FAILED',
  'HANDOVER_RECEIVE_STARTED',
  'HANDOVER_RECEIVED',
  'HANDOVER_RECEIVE_FAILED',
  'SHIFT_CLOSE_STARTED',
  'SHIFT_CLOSE_COMPLETED',
  'SHIFT_CLOSE_FAILED',
  'SHIFT_CONTINGENCY_STARTED',
  'SHIFT_CONTINGENCY_COMPLETED',
  'SHIFT_CONTINGENCY_FAILED',
  'CASH_COUNT_STARTED',
  'CASH_COUNT_COMPLETED',
  'CASH_COUNT_FAILED',
  'CASH_CLOSE_STARTED',
  'CASH_CLOSED',
  'CASH_CLOSE_FAILED',
  'HANDOVER_SEND_STARTED',
  'HANDOVER_SENT',
  'HANDOVER_SEND_FAILED',
] as const;

export const P1_OPERATIONAL_EVENT_TYPES = [
  'ENTRY_CREATED',
  'ENTRY_TAKEN',
  'ENTRY_RESOLVED',
  'KEY_INVENTORY_STARTED',
  'KEY_INVENTORY_COMPLETED',
  'KEY_INVENTORY_WITH_DIFFERENCES',
  'TUTORIAL_STARTED',
  'TUTORIAL_STEP_REACHED',
  'TUTORIAL_CLOSED_THIS_SESSION',
  'TUTORIAL_DISABLED',
  'TUTORIAL_COMPLETED',
] as const;

export const OPERATIONAL_EVENT_TYPES = [
  ...P0_OPERATIONAL_EVENT_TYPES,
  ...P1_OPERATIONAL_EVENT_TYPES,
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];
export type OperationalEventStatus = 'STARTED' | 'SUCCESS' | 'FAILED';
export type OperationalEventSource = 'SERVER_ACTION' | 'CLIENT_UI';

const ALLOWED_METADATA_KEYS = new Set([
  'shiftType',
  'mode',
  'countKind',
  'hasDifference',
  'failureType',
  'entryType',
  'floor',
]);

type MetadataPrimitive = string | number | boolean;
export type OperationalMetadata = Record<string, MetadataPrimitive | undefined>;

export type OperationalEventInput = {
  eventType: OperationalEventType;
  userId?: string | null;
  shiftId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  status: OperationalEventStatus;
  source?: OperationalEventSource;
  metadata?: Record<string, unknown> | null;
};

type EventWriter = (
  data: Prisma.OperationalMetricEventUncheckedCreateInput,
) => Promise<unknown>;

function sanitizeMetadata(
  metadata?: Record<string, unknown> | null,
): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined;

  const clean: Record<string, MetadataPrimitive> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      clean[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      clean[key] = value.slice(0, 64);
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function normalizedDuration(value?: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function eventData(input: OperationalEventInput): Prisma.OperationalMetricEventUncheckedCreateInput {
  return {
    eventType: input.eventType,
    userId: input.userId ?? null,
    shiftId: input.shiftId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    correlationId: input.correlationId ?? null,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    durationMs: normalizedDuration(input.durationMs),
    status: input.status,
    source: input.source ?? 'SERVER_ACTION',
    metadata: sanitizeMetadata(input.metadata),
  };
}

async function defaultWriter(
  data: Prisma.OperationalMetricEventUncheckedCreateInput,
): Promise<void> {
  await prisma.operationalMetricEvent.create({ data });
}

/**
 * Persistencia segura y testeable. Devuelve false ante fallo y nunca propaga
 * el error a la operación que originó la métrica.
 */
export async function persistOperationalEvent(
  input: OperationalEventInput,
  writer: EventWriter = defaultWriter,
): Promise<boolean> {
  try {
    await writer(eventData(input));
    return true;
  } catch (error) {
    console.error('[observabilidad] no se pudo persistir evento operativo', {
      eventType: input.eventType,
      failureType: error instanceof Error ? error.name : typeof error,
    });
    return false;
  }
}

function schedule(callback: () => Promise<void>): void {
  try {
    after(async () => {
      try {
        await callback();
      } catch (error) {
        console.error('[observabilidad] tarea diferida falló', {
          failureType: error instanceof Error ? error.name : typeof error,
        });
      }
    });
  } catch (error) {
    // after() puede lanzar fuera de una petición. La observabilidad nunca bloquea.
    console.warn('[observabilidad] no fue posible programar el registro', {
      failureType: error instanceof Error ? error.name : typeof error,
    });
  }
}

/**
 * Camino normal desde Server Actions: no espera el INSERT y no puede convertir
 * la telemetría en requisito de una operación hotelera.
 */
export function recordOperationalEvent(input: OperationalEventInput): void {
  schedule(async () => {
    await persistOperationalEvent(input);
  });
}

export type OperationalMetricHandle = {
  correlationId: string;
  startedAt: Date;
  completedEventType: OperationalEventType;
  failedEventType: OperationalEventType;
  userId?: string | null;
  shiftId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  source: OperationalEventSource;
  metadata?: Record<string, unknown> | null;
};

export function startOperationalMetric(input: {
  startedEventType: OperationalEventType;
  completedEventType: OperationalEventType;
  failedEventType: OperationalEventType;
  userId?: string | null;
  shiftId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  source?: OperationalEventSource;
  metadata?: Record<string, unknown> | null;
  startedAt?: Date;
}): OperationalMetricHandle {
  const handle: OperationalMetricHandle = {
    correlationId: input.correlationId ?? randomUUID(),
    startedAt: input.startedAt ?? new Date(),
    completedEventType: input.completedEventType,
    failedEventType: input.failedEventType,
    userId: input.userId,
    shiftId: input.shiftId,
    entityType: input.entityType,
    entityId: input.entityId,
    source: input.source ?? 'SERVER_ACTION',
    metadata: input.metadata,
  };

  recordOperationalEvent({
    eventType: input.startedEventType,
    userId: handle.userId,
    shiftId: handle.shiftId,
    entityType: handle.entityType,
    entityId: handle.entityId,
    correlationId: handle.correlationId,
    startedAt: handle.startedAt,
    status: 'STARTED',
    source: handle.source,
    metadata: handle.metadata,
  });
  return handle;
}

export function operationalDurationMs(startedAt: Date, completedAt: Date): number {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

export function operationalStartedAtFromEpoch(
  value: unknown,
  maxAgeMs = 4 * 3600_000,
  now = new Date(),
): Date {
  const epoch =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  const nowMs = now.getTime();
  if (!Number.isFinite(epoch) || epoch > nowMs || nowMs - epoch > maxAgeMs) return now;
  return new Date(epoch);
}


export function finishOperationalMetric(
  handle: OperationalMetricHandle,
  input: {
    shiftId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
    completedAt?: Date;
  } = {},
): void {
  const completedAt = input.completedAt ?? new Date();
  recordOperationalEvent({
    eventType: handle.completedEventType,
    userId: handle.userId,
    shiftId: input.shiftId ?? handle.shiftId,
    entityType: input.entityType ?? handle.entityType,
    entityId: input.entityId ?? handle.entityId,
    correlationId: handle.correlationId,
    startedAt: handle.startedAt,
    completedAt,
    durationMs: operationalDurationMs(handle.startedAt, completedAt),
    status: 'SUCCESS',
    source: handle.source,
    metadata: { ...handle.metadata, ...input.metadata },
  });
}

export function operationalFailureType(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  return typeof error;
}

export function failOperationalMetric(
  handle: OperationalMetricHandle,
  error: unknown,
  input: {
    shiftId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
    completedAt?: Date;
  } = {},
): void {
  const completedAt = input.completedAt ?? new Date();
  recordOperationalEvent({
    eventType: handle.failedEventType,
    userId: handle.userId,
    shiftId: input.shiftId ?? handle.shiftId,
    entityType: input.entityType ?? handle.entityType,
    entityId: input.entityId ?? handle.entityId,
    correlationId: handle.correlationId,
    startedAt: handle.startedAt,
    completedAt,
    durationMs: operationalDurationMs(handle.startedAt, completedAt),
    status: 'FAILED',
    source: handle.source,
    metadata: {
      ...handle.metadata,
      ...input.metadata,
      failureType: operationalFailureType(error),
    },
  });
}

export function shiftCloseCorrelationId(shiftId: string): string {
  return `shift-close:${shiftId}`;
}

/**
 * Finaliza un proceso que abarcó varias peticiones, como el cierre de turno.
 * La búsqueda del START y el INSERT final ocurren ambos después de responder.
 */
export function finishCorrelatedOperationalMetric(input: {
  startEventType: OperationalEventType;
  completedEventType: OperationalEventType;
  correlationId: string;
  userId?: string | null;
  shiftId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  fallbackStartedAt?: Date | null;
}): void {
  schedule(async () => {
    const completedAt = new Date();
    let startedAt: Date | null = null;

    try {
      const start = await prisma.operationalMetricEvent.findFirst({
        where: {
          eventType: input.startEventType,
          correlationId: input.correlationId,
          status: 'STARTED',
        },
        orderBy: { createdAt: 'asc' },
        select: { startedAt: true, createdAt: true },
      });
      startedAt = start?.startedAt ?? start?.createdAt ?? null;
    } catch (error) {
      console.error('[observabilidad] no se pudo resolver inicio correlacionado', {
        eventType: input.completedEventType,
        failureType: operationalFailureType(error),
      });
    }

    startedAt = startedAt ?? input.fallbackStartedAt ?? null;

    await persistOperationalEvent({
      eventType: input.completedEventType,
      userId: input.userId,
      shiftId: input.shiftId,
      entityType: input.entityType,
      entityId: input.entityId,
      correlationId: input.correlationId,
      startedAt,
      completedAt,
      durationMs: startedAt ? operationalDurationMs(startedAt, completedAt) : null,
      status: 'SUCCESS',
      source: 'SERVER_ACTION',
      metadata: input.metadata,
    });
  });
}
