import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetOperationalData } from './helpers';
import {
  P0_OPERATIONAL_EVENT_TYPES,
  P1_OPERATIONAL_EVENT_TYPES,
  P2_OPERATIONAL_EVENT_TYPES,
  operationalDurationMs,
  operationalStartedAtFromEpoch,
  persistOperationalEvent,
  shiftCloseCorrelationId,
} from '@/server/observability/operational';
import {
  getOperationalHealth,
  operationalHealthRange,
  median,
  percentile,
} from '@/server/services/operational-health';

describe('observabilidad operativa P0/P1/P2', () => {
  beforeEach(async () => {
    await resetOperationalData();
  });

  it('registra un evento pequeño y estructurado', async () => {
    const ok = await persistOperationalEvent({
      eventType: 'SHIFT_STARTED',
      shiftId: 'shift-test',
      correlationId: 'corr-test',
      startedAt: new Date('2026-09-26T10:00:00.000Z'),
      completedAt: new Date('2026-09-26T10:00:02.000Z'),
      durationMs: 2000,
      status: 'SUCCESS',
      metadata: { shiftType: 'DIA', mode: 'NORMAL' },
    });

    expect(ok).toBe(true);
    const row = await prisma.operationalMetricEvent.findFirstOrThrow();
    expect(row.eventType).toBe('SHIFT_STARTED');
    expect(row.shiftId).toBe('shift-test');
    expect(row.durationMs).toBe(2000);
    expect(row.metadata).toEqual({ shiftType: 'DIA', mode: 'NORMAL' });
  });

  it('un fallo de telemetría se absorbe y no se propaga', async () => {
    const ok = await persistOperationalEvent(
      {
        eventType: 'SHIFT_START_REQUESTED',
        status: 'STARTED',
      },
      async () => {
        throw new Error('base no disponible');
      },
    );

    expect(ok).toBe(false);
  });

  it('calcula duración y conserva correlationId determinista para el cierre', () => {
    const start = new Date('2026-09-26T12:00:00.000Z');
    const end = new Date('2026-09-26T12:04:52.000Z');

    expect(operationalDurationMs(start, end)).toBe(292_000);
    expect(shiftCloseCorrelationId('turno-123')).toBe('shift-close:turno-123');
  });

  it('descarta metadata no autorizada y no persiste texto libre o secretos', async () => {
    await persistOperationalEvent({
      eventType: 'CASH_COUNT_COMPLETED',
      status: 'SUCCESS',
      metadata: {
        countKind: 'DECLARADO',
        hasDifference: false,
        password: 'nunca-guardar',
        question: 'texto libre de usuario',
        message: 'mensaje completo',
      },
    });

    const row = await prisma.operationalMetricEvent.findFirstOrThrow();
    expect(row.metadata).toEqual({
      countKind: 'DECLARADO',
      hasDifference: false,
    });
  });

  it('devuelve panel vacío sin inventar valores', async () => {
    const health = await getOperationalHealth(
      operationalHealthRange('today', new Date('2026-09-26T17:00:00.000Z')),
    );

    expect(health.shifts.started).toBe(0);
    expect(health.shifts.medianCloseMs).toBeNull();
    expect(health.cash.counts).toBe(0);
    expect(health.keyInventory.completed).toBe(0);
    expect(health.tutorial.started).toBe(0);
    expect(health.entries.medianTakeMs).toBeNull();
    expect(health.fronti.requested).toBe(0);
    expect(health.fronti.successRate).toBeNull();
    expect(health.actions.failed).toBe(0);
    expect(health.actions.timeouts).toBe(0);
    expect(health.failures).toBe(0);
    expect(health.observedSince).toBeNull();
  });

  it('filtra el período y calcula mediana, P90 y diferencias desde eventos reales', async () => {
    const now = new Date('2026-09-26T17:00:00.000Z');
    const inside = new Date('2026-09-26T15:00:00.000Z');
    const outside = new Date('2026-09-10T15:00:00.000Z');

    await prisma.operationalMetricEvent.createMany({
      data: [
        {
          id: 'm-start',
          eventType: 'SHIFT_STARTED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          createdAt: inside,
        },
        {
          id: 'm-close-start',
          eventType: 'SHIFT_CLOSE_STARTED',
          status: 'STARTED',
          source: 'SERVER_ACTION',
          correlationId: 'shift-close:s1',
          startedAt: new Date('2026-09-26T14:55:00.000Z'),
          createdAt: inside,
        },
        {
          id: 'm-close-end',
          eventType: 'SHIFT_CLOSE_COMPLETED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          correlationId: 'shift-close:s1',
          durationMs: 300_000,
          createdAt: inside,
        },
        {
          id: 'm-cash',
          eventType: 'CASH_COUNT_COMPLETED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          durationMs: 120_000,
          metadata: { hasDifference: true, countKind: 'DECLARADO' },
          createdAt: inside,
        },
        {
          id: 'm-sent',
          eventType: 'HANDOVER_SENT',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          createdAt: inside,
        },
        {
          id: 'm-received',
          eventType: 'HANDOVER_RECEIVED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          durationMs: 180_000,
          createdAt: inside,
        },
        {
          id: 'm-failure',
          eventType: 'CASH_CLOSE_FAILED',
          status: 'FAILED',
          source: 'SERVER_ACTION',
          createdAt: inside,
        },
        {
          id: 'm-entry-taken',
          eventType: 'ENTRY_TAKEN',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          durationMs: 60_000,
          createdAt: inside,
        },
        {
          id: 'm-entry-resolved',
          eventType: 'ENTRY_RESOLVED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          durationMs: 240_000,
          createdAt: inside,
        },
        {
          id: 'm-key-completed',
          eventType: 'KEY_INVENTORY_COMPLETED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          durationMs: 180_000,
          metadata: { floor: 4, hasDifference: true },
          createdAt: inside,
        },
        {
          id: 'm-key-diff',
          eventType: 'KEY_INVENTORY_WITH_DIFFERENCES',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          metadata: { floor: 4, hasDifference: true },
          createdAt: inside,
        },
        {
          id: 'm-tutorial-start',
          eventType: 'TUTORIAL_STARTED',
          status: 'STARTED',
          source: 'CLIENT_UI',
          correlationId: 'tutorial:test',
          createdAt: inside,
        },
        {
          id: 'm-tutorial-step',
          eventType: 'TUTORIAL_STEP_REACHED',
          status: 'SUCCESS',
          source: 'CLIENT_UI',
          correlationId: 'tutorial:test',
          createdAt: inside,
        },
        {
          id: 'm-tutorial-completed',
          eventType: 'TUTORIAL_COMPLETED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          correlationId: 'tutorial:test',
          durationMs: 90_000,
          createdAt: inside,
        },
        {
          id: 'm-fronti-request',
          eventType: 'FRONTI_REQUEST',
          status: 'STARTED',
          source: 'SERVER_ACTION',
          correlationId: 'fronti:test',
          createdAt: inside,
        },
        {
          id: 'm-fronti-success',
          eventType: 'FRONTI_SUCCESS',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          correlationId: 'fronti:test',
          durationMs: 2_400,
          metadata: {
            provider: 'cloudflare',
            model: 'model-b',
            configuredProvider: 'groq',
            configuredModel: 'model-a',
            outcome: 'partial',
            fallbackUsed: true,
          },
          createdAt: inside,
        },
        {
          id: 'm-fronti-tool-ok',
          eventType: 'FRONTI_TOOL_CALLED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          correlationId: 'fronti:test',
          metadata: { tool: 'consultar_turnos', toolOk: true },
          createdAt: inside,
        },
        {
          id: 'm-fronti-tool-fail',
          eventType: 'FRONTI_TOOL_CALLED',
          status: 'FAILED',
          source: 'SERVER_ACTION',
          correlationId: 'fronti:test',
          metadata: { tool: 'consultar_caja', toolOk: false },
          createdAt: inside,
        },
        {
          id: 'm-action-failed',
          eventType: 'ACTION_FAILED',
          status: 'FAILED',
          source: 'SERVER_ACTION',
          durationMs: 300,
          metadata: { failureType: 'Error' },
          createdAt: inside,
        },
        {
          id: 'm-action-timeout',
          eventType: 'ACTION_TIMEOUT',
          status: 'FAILED',
          source: 'SERVER_ACTION',
          durationMs: 22_000,
          metadata: { timeoutThresholdMs: 20_000 },
          createdAt: inside,
        },
        {
          id: 'm-old',
          eventType: 'SHIFT_STARTED',
          status: 'SUCCESS',
          source: 'SERVER_ACTION',
          createdAt: outside,
        },
      ],
    });

    const health = await getOperationalHealth(operationalHealthRange('7d', now));
    expect(health.shifts.started).toBe(1);
    expect(health.shifts.closed).toBe(1);
    expect(health.shifts.medianCloseMs).toBe(300_000);
    expect(health.shifts.p90CloseMs).toBe(300_000);
    expect(health.shifts.closeIncomplete).toBe(0);
    expect(health.cash.counts).toBe(1);
    expect(health.cash.withDifferences).toBe(1);
    expect(health.handovers.sent).toBe(1);
    expect(health.handovers.received).toBe(1);
    expect(health.handovers.medianReceiveMs).toBe(180_000);
    expect(health.entries.takenObserved).toBe(1);
    expect(health.entries.resolvedObserved).toBe(1);
    expect(health.entries.medianTakeMs).toBe(60_000);
    expect(health.entries.medianResolveMs).toBe(240_000);
    expect(health.keyInventory.completed).toBe(1);
    expect(health.keyInventory.withDifferences).toBe(1);
    expect(health.keyInventory.medianDurationMs).toBe(180_000);
    expect(health.tutorial.started).toBe(1);
    expect(health.tutorial.stepsReached).toBe(1);
    expect(health.tutorial.completed).toBe(1);
    expect(health.fronti.requested).toBe(1);
    expect(health.fronti.succeeded).toBe(1);
    expect(health.fronti.failed).toBe(0);
    expect(health.fronti.successRate).toBe(1);
    expect(health.fronti.medianDurationMs).toBe(2_400);
    expect(health.fronti.fallbackRuns).toBe(1);
    expect(health.fronti.toolCalls).toBe(2);
    expect(health.fronti.toolFailures).toBe(1);
    expect(health.actions.failed).toBe(1);
    expect(health.actions.timeouts).toBe(1);
    expect(health.actions.medianTimeoutMs).toBe(22_000);
    expect(health.failures).toBe(1);
  });

  it('calcula percentiles sin almacenar agregados derivados', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBe(50);
  });

  it('rechaza timestamps manipulados para duraciones de interfaz', () => {
    const now = new Date('2026-09-26T18:00:00.000Z');
    expect(
      operationalStartedAtFromEpoch(new Date('2026-09-26T17:55:00.000Z').getTime(), 3600_000, now),
    ).toEqual(new Date('2026-09-26T17:55:00.000Z'));
    expect(
      operationalStartedAtFromEpoch(new Date('2026-09-26T20:00:00.000Z').getTime(), 3600_000, now),
    ).toEqual(now);
    expect(
      operationalStartedAtFromEpoch(new Date('2026-09-26T10:00:00.000Z').getTime(), 3600_000, now),
    ).toEqual(now);
  });

  it('mantiene el panel limitado al Centro de Supervisión y sin desglose individual', () => {
    const page = readFileSync('src/app/(app)/supervision/salud/page.tsx', 'utf8');
    const service = readFileSync('src/server/services/operational-health.ts', 'utf8');
    const cashUi = readFileSync('src/components/operational/cash-box.tsx', 'utf8');
    const tutorial = readFileSync('src/components/layout/tutorial.tsx', 'utf8');
    const keyMetric = readFileSync(
      'src/components/observability/key-inventory-metric-boundary.tsx',
      'utf8',
    );
    expect(page).toContain("requirePagePermission('supervision.center.view')");
    expect(page).not.toContain('user.name');
    expect(service).not.toContain("by: ['userId']");
    expect(cashUi).toContain('name="metricStartedAt"');
    expect(keyMetric).toContain('startKeyInventoryMetricAction');
    expect(keyMetric).not.toContain('notes');
    expect(tutorial).toContain('TUTORIAL_STEP_REACHED');
    expect(tutorial).not.toContain('question:');
  });

  it('separa P0, P1 y P2 sin mezclar responsabilidades', () => {
    expect(P0_OPERATIONAL_EVENT_TYPES).toContain('SHIFT_CLOSE_COMPLETED');
    expect(P0_OPERATIONAL_EVENT_TYPES).not.toContain('TUTORIAL_STARTED' as never);
    expect(P1_OPERATIONAL_EVENT_TYPES).toContain('ENTRY_CREATED');
    expect(P1_OPERATIONAL_EVENT_TYPES).toContain('KEY_INVENTORY_COMPLETED');
    expect(P1_OPERATIONAL_EVENT_TYPES).toContain('TUTORIAL_COMPLETED');
    expect(P1_OPERATIONAL_EVENT_TYPES).not.toContain('FRONTI_REQUEST' as never);
    expect(P2_OPERATIONAL_EVENT_TYPES).toContain('FRONTI_REQUEST');
    expect(P2_OPERATIONAL_EVENT_TYPES).toContain('FRONTI_TOOL_CALLED');
    expect(P2_OPERATIONAL_EVENT_TYPES).toContain('ACTION_FAILED');
    expect(P2_OPERATIONAL_EVENT_TYPES).toContain('ACTION_TIMEOUT');
  });

  it('P2 no persiste contenido de Fronti ni campos de formulario', () => {
    const telemetry = readFileSync('src/server/ai/fronti-v2/telemetry.ts', 'utf8');
    const action = readFileSync('src/server/action.ts', 'utf8');
    expect(telemetry).toContain("eventType: 'FRONTI_REQUEST'");
    expect(telemetry).toContain("eventType: 'FRONTI_TOOL_CALLED'");
    expect(telemetry).not.toContain('messages:');
    expect(telemetry).not.toContain('prompt:');
    expect(telemetry).not.toContain('reply:');
    expect(action).toContain("eventType: 'ACTION_FAILED'");
    expect(action).toContain("eventType: 'ACTION_TIMEOUT'");
    expect(action).toContain('metadata: { failureType: operationalFailureType(error) }');
    expect(action).toContain('metadata: { timeoutThresholdMs: ACTION_TIMEOUT_THRESHOLD_MS }');
  });
});
