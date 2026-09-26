import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetOperationalData } from './helpers';
import {
  P0_OPERATIONAL_EVENT_TYPES,
  operationalDurationMs,
  persistOperationalEvent,
  shiftCloseCorrelationId,
} from '@/server/observability/operational';
import {
  getOperationalHealth,
  operationalHealthRange,
  median,
  percentile,
} from '@/server/services/operational-health';

describe('observabilidad operativa P0', () => {
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
    expect(health.failures).toBe(1);
  });

  it('calcula percentiles sin almacenar agregados derivados', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(percentile([10, 20, 30, 40, 50], 0.9)).toBe(50);
  });

  it('mantiene el panel limitado al Centro de Supervisión y sin desglose individual', () => {
    const page = readFileSync('src/app/(app)/supervision/salud/page.tsx', 'utf8');
    const service = readFileSync('src/server/services/operational-health.ts', 'utf8');
    expect(page).toContain("requirePagePermission('supervision.center.view')");
    expect(page).not.toContain('user.name');
    expect(service).not.toContain("by: ['userId']");
  });

  it('el catálogo de esta etapa se detiene en P0', () => {
    expect(P0_OPERATIONAL_EVENT_TYPES).toContain('SHIFT_CLOSE_COMPLETED');
    expect(P0_OPERATIONAL_EVENT_TYPES).toContain('HANDOVER_SENT');
    expect(P0_OPERATIONAL_EVENT_TYPES).not.toContain('FRONTI_REQUEST' as never);
    expect(P0_OPERATIONAL_EVENT_TYPES).not.toContain('TUTORIAL_STARTED' as never);
    expect(P0_OPERATIONAL_EVENT_TYPES).not.toContain('ENTRY_CREATED' as never);
  });
});
