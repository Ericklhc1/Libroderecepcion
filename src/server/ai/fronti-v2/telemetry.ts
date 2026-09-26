import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  operationalDurationMs,
  recordOperationalEvent,
} from '@/server/observability/operational';
import { FRONTI_AGENT_VERSION } from './version';

export type FrontiToolTrace = {
  name: string;
  ok: boolean;
};

export type FrontiModelTrace = {
  provider: string;
  model: string;
};

export type FrontiAgentRunHandle = {
  userId: string;
  correlationId: string;
  startedAt: Date;
};

export type FrontiAgentRunTelemetry = {
  provider: string;
  model: string;
  configuredProvider?: string | null;
  configuredModel?: string | null;
  models: FrontiModelTrace[];
  durationMs: number;
  loops: number;
  tools: FrontiToolTrace[];
  outcome: 'success' | 'partial' | 'limit' | 'error';
  failure?: string | null;
};

/**
 * Inicia una ejecución observable de Fronti sin registrar prompts, mensajes,
 * argumentos, resultados, huéspedes, habitaciones, montos ni memoria.
 */
export function startFrontiAgentRun(userId: string): FrontiAgentRunHandle {
  const startedAt = new Date();
  const correlationId = `fronti:${randomUUID()}`;

  recordOperationalEvent({
    eventType: 'FRONTI_REQUEST',
    userId,
    entityType: 'FrontiAgentRun',
    entityId: correlationId,
    correlationId,
    startedAt,
    status: 'STARTED',
    source: 'SERVER_ACTION',
  });

  return { userId, correlationId, startedAt };
}

/**
 * Telemetría segura de Fronti.
 *
 * Conserva el log técnico existente y, desde P2, persiste únicamente metadata
 * estructurada para estabilidad: proveedor/modelo, latencia, outcome, cantidad
 * de loops/tools y éxito de cada tool. Nunca guarda contenido conversacional.
 */
export function recordFrontiAgentRun(
  handle: FrontiAgentRunHandle,
  event: FrontiAgentRunTelemetry,
): void {
  const completedAt = new Date();
  const fallbackUsed =
    Boolean(event.configuredProvider && event.provider !== event.configuredProvider) ||
    Boolean(event.configuredModel && event.model !== event.configuredModel);
  const durationMs =
    Number.isFinite(event.durationMs) && event.durationMs >= 0
      ? Math.round(event.durationMs)
      : operationalDurationMs(handle.startedAt, completedAt);

  console.info(
    '[fronti-v2-telemetry]',
    JSON.stringify({
      agentVersion: FRONTI_AGENT_VERSION,
      userId: handle.userId,
      correlationId: handle.correlationId,
      ...event,
      fallbackUsed,
      toolCount: event.tools.length,
    }),
  );

  const metadata = {
    provider: event.provider,
    model: event.model,
    configuredProvider: event.configuredProvider ?? undefined,
    configuredModel: event.configuredModel ?? undefined,
    outcome: event.outcome,
    toolCount: event.tools.length,
    modelCount: event.models.length,
    loopCount: event.loops,
    fallbackUsed,
    failureType: event.failure ?? undefined,
  };

  const success = event.outcome === 'success' || event.outcome === 'partial';
  recordOperationalEvent({
    eventType: success ? 'FRONTI_SUCCESS' : 'FRONTI_FAILURE',
    userId: handle.userId,
    entityType: 'FrontiAgentRun',
    entityId: handle.correlationId,
    correlationId: handle.correlationId,
    startedAt: handle.startedAt,
    completedAt,
    durationMs,
    status: success ? 'SUCCESS' : 'FAILED',
    source: 'SERVER_ACTION',
    metadata,
  });

  for (const tool of event.tools) {
    recordOperationalEvent({
      eventType: 'FRONTI_TOOL_CALLED',
      userId: handle.userId,
      entityType: 'FrontiTool',
      entityId: tool.name,
      correlationId: handle.correlationId,
      startedAt: handle.startedAt,
      completedAt,
      status: tool.ok ? 'SUCCESS' : 'FAILED',
      source: 'SERVER_ACTION',
      metadata: {
        provider: event.provider,
        model: event.model,
        outcome: event.outcome,
        tool: tool.name,
        toolOk: tool.ok,
      },
    });
  }
}
