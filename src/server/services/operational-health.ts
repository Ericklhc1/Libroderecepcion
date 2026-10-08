import { readEntries } from '@/server/services/entry-visibility';
import 'server-only';

import {Prisma} from '@prisma/client';
import type {OperationalMetricEvent} from '@prisma/client';
import {entryReadWhere,entryReadSql} from './entry-visibility';
import type {EntryReader} from './entry-visibility';
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

type HealthEvent=Pick<OperationalMetricEvent,'eventType'|'correlationId'|'durationMs'|'metadata'|'createdAt'>;
function metricVisibilitySql(user:EntryReader){
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "complete_native_entry_origin_ids"(lower(event."entityType"),event."entityId") origin JOIN "OperationalEntry" e ON e.id=origin."entryId" WHERE NOT (${entryReadSql(user)}))`;
}

export async function getOperationalHealth(range: OperationalHealthRange,user:EntryReader) {
  const visibility=metricVisibilitySql(user);
  const events=await prisma.$queryRaw<HealthEvent[]>`SELECT event."eventType",event."correlationId",event."durationMs",event.metadata,event."createdAt" FROM "OperationalMetricEvent" event WHERE event."createdAt">=${range.from} AND event."createdAt"<=${range.to} AND (${visibility}) ORDER BY event."createdAt" ASC`;

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
  const frontiOutcomeEvents = events.filter(
    (event) =>
      event.eventType === 'FRONTI_SUCCESS' || event.eventType === 'FRONTI_FAILURE',
  );
  const frontiDurations = frontiOutcomeEvents
    .filter((event) => typeof event.durationMs === 'number')
    .map((event) => event.durationMs as number);
  const actionTimeoutDurations = events
    .filter(
      (event) => event.eventType === 'ACTION_TIMEOUT' && typeof event.durationMs === 'number',
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
          await prisma.$queryRaw<{correlationId:string|null}[]>`SELECT event."correlationId" FROM "OperationalMetricEvent" event WHERE event."eventType"='SHIFT_CLOSE_COMPLETED' AND event."correlationId" IN (${Prisma.join(startCorrelations)}) AND (${visibility})`
        )
          .map((event) => event.correlationId)
          .filter((value): value is string => Boolean(value)),
      )
    : new Set<string>();

  const createdIn = { gte: range.from, lte: range.to };
  const [entriesCreated, entriesResolved, firstObserved] = await Promise.all([
    readEntries(prisma, user).count({
      where: { deletedAt: null, createdAt: createdIn,AND:[entryReadWhere(user)] },
    }),
    readEntries(prisma, user).count({
      where: { deletedAt: null, closedAt: createdIn,AND:[entryReadWhere(user)] },
    }),
    prisma.$queryRaw<{createdAt:Date}[]>`SELECT event."createdAt" FROM "OperationalMetricEvent" event WHERE (${visibility}) ORDER BY event."createdAt" ASC LIMIT 1`,
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
    observedSince: firstObserved[0]?.createdAt ?? null,
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
    fronti: {
      requested: count('FRONTI_REQUEST'),
      succeeded: count('FRONTI_SUCCESS'),
      failed: count('FRONTI_FAILURE'),
      successRate:
        count('FRONTI_REQUEST') > 0
          ? count('FRONTI_SUCCESS') / count('FRONTI_REQUEST')
          : null,
      averageDurationMs:
        frontiDurations.length > 0
          ? frontiDurations.reduce((sum, value) => sum + value, 0) / frontiDurations.length
          : null,
      medianDurationMs: median(frontiDurations),
      p90DurationMs: percentile(frontiDurations, 0.9),
      fallbackRuns: frontiOutcomeEvents.filter((event) =>
        metadataBoolean(event.metadata, 'fallbackUsed'),
      ).length,
      toolCalls: count('FRONTI_TOOL_CALLED'),
      toolFailures: events.filter(
        (event) =>
          event.eventType === 'FRONTI_TOOL_CALLED' &&
          !metadataBoolean(event.metadata, 'toolOk'),
      ).length,
    },
    actions: {
      failed: count('ACTION_FAILED'),
      timeouts: count('ACTION_TIMEOUT'),
      medianTimeoutMs: median(actionTimeoutDurations),
      p90TimeoutMs: percentile(actionTimeoutDurations, 0.9),
    },
    failures,
  };
}
