import 'server-only';

import { env } from '@/lib/env';
import {
  ASSISTANT_FAILURE_MESSAGE,
  type AssistantFailure,
} from '@/domain/assistant-status';
import type { CurrentUser } from '@/server/auth/current-user';
import { getDashboardData } from '@/server/services/dashboard';
import { getFrontiConfig } from './fronti-config';
import {
  chatWithFrontiProvider,
  FrontiProviderError,
  resolveFrontiProviderRuntime,
} from './fronti-provider';

export class OperationalBriefError extends Error {
  readonly failure: AssistantFailure;

  constructor(failure: AssistantFailure, cause?: Error) {
    super(ASSISTANT_FAILURE_MESSAGE[failure]);
    this.name = 'OperationalBriefError';
    this.failure = failure;
    if (cause) this.cause = cause;
  }
}

/**
 * Genera una lectura breve de la bandeja determinística de atención.
 *
 * La IA no consulta tablas ni decide el orden: recibe sólo los elementos ya
 * derivados por reglas del Libro y explica el panorama. Si OpenAI falla, la
 * bandeja sigue estando disponible en Inicio.
 */
export async function generateOperationalBrief(user: CurrentUser) {
  const [config, dashboard] = await Promise.all([
    getFrontiConfig(),
    getDashboardData(user),
  ]);

  if (!config.enabled) throw new OperationalBriefError('DESACTIVADO');

  const attention = dashboard.attention;
  if (attention.length === 0) {
    return {
      brief: 'No hay condiciones prioritarias activas en este momento.',
      generatedAt: new Date(),
      attention,
    };
  }

  const compact = attention.slice(0, 8).map((item, index) => ({
    order: index + 1,
    level: item.tone,
    title: item.title,
    reason: item.reason,
    nextAction: item.action,
  }));

  const provider = await resolveFrontiProviderRuntime(config);
  let result;
  try {
    result = await chatWithFrontiProvider({
      provider,
      messages: [
        {
          role: 'system',
          content:
            'Eres la capa de briefing operativo de Recepción del Hotel HW Libertad. ' +
            'Recibirás una lista YA PRIORIZADA por reglas determinísticas del Libro. ' +
            'No cambies el orden, no inventes hechos, huéspedes, montos, reservas ni estados. ' +
            'Resume en español claro y ejecutivo qué exige atención ahora y por qué. ' +
            'Usa como máximo 4 puntos breves. No agregues saludo ni despedida. ' +
            'Si dos elementos dependen entre sí, puedes explicarlo, pero nunca crear una dependencia no indicada.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            generatedAt: new Date().toISOString(),
            timezone: env().HOTEL_TIMEZONE,
            attention: compact,
          }),
        },
      ],
    });
  } catch (error) {
    if (error instanceof FrontiProviderError) {
      throw new OperationalBriefError(error.failure, error);
    }
    throw error;
  }

  return {
    brief: result.text || 'No pude resumir la bandeja en este momento.',
    generatedAt: new Date(),
    attention,
  };
}
