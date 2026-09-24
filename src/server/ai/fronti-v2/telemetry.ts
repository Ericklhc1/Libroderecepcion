import 'server-only';

import { FRONTI_AGENT_VERSION } from './version';

export type FrontiToolTrace = {
  name: string;
  ok: boolean;
};

export type FrontiAgentRunTelemetry = {
  userId: string;
  provider: string;
  model: string;
  durationMs: number;
  loops: number;
  tools: FrontiToolTrace[];
  outcome: 'success' | 'partial' | 'limit' | 'error';
  failure?: string | null;
};

/**
 * Telemetría segura del alpha.
 *
 * Deliberadamente NO registra prompts, argumentos, resultados de herramientas,
 * respuestas del modelo, huéspedes, habitaciones, montos ni memoria. Sólo
 * metadatos suficientes para medir estabilidad y detectar qué capacidad falla.
 */
export function recordFrontiAgentRun(event: FrontiAgentRunTelemetry): void {
  console.info(
    '[fronti-v2-telemetry]',
    JSON.stringify({
      agentVersion: FRONTI_AGENT_VERSION,
      ...event,
      toolCount: event.tools.length,
    }),
  );
}
