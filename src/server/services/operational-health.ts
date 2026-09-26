import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addHotelCalendarDays, hotelDayStart } from '@/domain/time';
import type { OperationalEventType } from '@/server/observability/operational';

export type OperationalHealthPeriod = 'today' | '7d' | '30d';
export type OperationalHealthRange = { from: Date; to: Date };

export function operationalHealthRange(
  period: OperationalHealthPeriod,
  now = new Date(),
): OperationalHealthRange {
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  return {
    from: hotelDayStart(addHotelCalendarDays(now, -(days - 1))),
    to: now,
  };
}

function metadataBoolean(metadata: Prisma.JsonValue | null, key: string): boolean {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return false;
  return (metadata as Record<string, Prisma.JsonValue>)[key] === true;
}

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)] ?? null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const FAILURE_EVENTS = [
  'SHIFT_START_FAILED',
  'HANDOVER_RECEIVE_FAILED',
  'SHIFT_CLOSE_FAILED',
  'SHIFT_CONTINGENCY_FAILED',
  'CASH_COUNT_FAILED',
  'CASH_CLOSE_FAILED',
  'HANDOVER_SEND_FAILED',
] as const satisfies readonly OperationalEventType[];

export async function getOperationalHealth(range: OperationalHealthRange) {
  const events = await prisma.operationalMetricEvent.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
    },
    select: {
      eventType: true,
      correlationId: true,
      durationMs: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const count = (eventType: OperationalEventType) =>
    events.filter((event) => event.eventType === eventType).length;

  const closeDurations = events
    .filter(
      (event) =>
        event.eventType === 'SHIFT_CLOSE_COMPLETED' &&
        typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);
  const cashDurations = events
    .filter(
      (event) =>
        event.eventType === 'CASH_COUNT_COMPLETED' &&
        typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);
  const receiveDurations = events
    .filter(
      (event) =>
        event.eventType === 'HANDOVER_RECEIVED' &&
        typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);
  const entryTakeDurations = events
    .filter(
      (event) => event.eventType === 'ENTRY_TAKEN' && typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);
  const entryResolveDurations = events
    .filter(
      (event) => event.eventType === 'ENTRY_RESOLVED' && typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);
  const keyInventoryDurations = events
    .filter(
      (event) =>
        event.eventType === 'KEY_INVENTORY_COMPLETED' &&
        typeof event.durationMs === 'number',
    )
    .map((event) => event.durationMs as number);

  const closureStarts = events.filter(
    (event) => event.eventType === 'SHIFT_CLOSE_STARTED' && event.correlationId,
  );
  const startCorrelations = [
    ...new Set(
      closureStarts
        .map((event) => event.correlationId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const completedCorrelations = startCorrelations.length
    ? new Set(
        (
          await prisma.operationalMetricEvent.findMany({
            where: {
              eventType: 'SHIFT_CLOSE_COMPLETED',
              correlationId: { in: startCorrelations },
            },
            select: { correlationId: true },
          })
        )
          .map((event) => event.correlationId)
          .filter((value): value is string => Boolean(value)),
      )
    : new Set<string>();

  const createdIn = { gte: range.from, lte: range.to };
  const [entriesCreated, entriesResolved, firstObserved] = await Promise.all([
    prisma.operationalEntry.count({
      where: { deletedAt: null, createdAt: createdIn },
    }),
    prisma.operationalEntry.count({
      where: { deletedAt: null, closedAt: createdIn },
    }),
    prisma.operationalMetricEvent.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const failures = events.filter((event) =>
    FAILURE_EVENTS.includes(event.eventType as (typeof FAILURE_EVENTS)[number]),
  ).length;
  const cashCountCompleted = events.filter(
    (event) => event.eventType === 'CASH_COUNT_COMPLETED',
  );
  const cashWithDifferences = cashCountCompleted.filter((event) =>
    metadataBoolean(event.metadata, 'hasDifference'),
  ).length;

  return {
    range,
    observedSince: firstObserved?.createdAt ?? null,
    shifts: {
      started: count('SHIFT_STARTED') + count('SHIFT_CONTINGENCY_COMPLETED'),
      closed: count('SHIFT_CLOSE_COMPLETED'),
      contingencies: count('SHIFT_CONTINGENCY_COMPLETED'),
      closeStarted: count('SHIFT_CLOSE_STARTED'),
      closeIncomplete: startCorrelations.filter(
        (correlationId) => !completedCorrelations.has(correlationId),
      ).length,
      medianCloseMs: median(closeDurations),
      p90CloseMs: percentile(closeDurations, 0.9),
      averageCloseMs:
        closeDurations.length > 0
          ? closeDurations.reduce((sum, value) => sum + value, 0) / closeDurations.length
          : null,
    },
    cash: {
      counts: cashCountCompleted.length,
      withDifferences: cashWithDifferences,
      closed: count('CASH_CLOSED'),
      medianCountMs: median(cashDurations),
      p90CountMs: percentile(cashDurations, 0.9),
    },
    handovers: {
      sent: count('HANDOVER_SENT'),
      received: count('HANDOVER_RECEIVED'),
      medianReceiveMs: median(receiveDurations),
      p90ReceiveMs: percentile(receiveDurations, 0.9),
    },
    entries: {
      created: entriesCreated,
      resolved: entriesResolved,
      takenObserved: count('ENTRY_TAKEN'),
      resolvedObserved: count('ENTRY_RESOLVED'),
      medianTakeMs: median(entryTakeDurations),
      p90TakeMs: percentile(entryTakeDurations, 0.9),
      medianResolveMs: median(entryResolveDurations),
      p90ResolveMs: percentile(entryResolveDurations, 0.9),
    },
    keyInventory: {
      completed: count('KEY_INVENTORY_COMPLETED'),
      withDifferences: count('KEY_INVENTORY_WITH_DIFFERENCES'),
      medianDurationMs: median(keyInventoryDurations),
      p90DurationMs: percentile(keyInventoryDurations, 0.9),
    },
    tutorial: {
      started: count('TUTORIAL_STARTED'),
      stepsReached: count('TUTORIAL_STEP_REACHED'),
      closedThisSession: count('TUTORIAL_CLOSED_THIS_SESSION'),
      disabled: count('TUTORIAL_DISABLED'),
      completed: count('TUTORIAL_COMPLETED'),
    },
    failures,
  };
}
