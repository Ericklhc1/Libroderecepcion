import 'server-only';

import { env } from '@/lib/env';
import {
  ASSISTANT_FAILURE_MESSAGE,
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';
import type { CurrentUser } from '@/server/auth/current-user';
import { getDashboardData } from '@/server/services/dashboard';
import { getFrontiConfig } from './fronti-config';

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string; code?: string; type?: string };
};

export class OperationalBriefError extends Error {
  readonly failure: AssistantFailure;

  constructor(failure: AssistantFailure, cause?: Error) {
    super(ASSISTANT_FAILURE_MESSAGE[failure]);
    this.name = 'OperationalBriefError';
    this.failure = failure;
    if (cause) this.cause = cause;
  }
}

function responseText(response: OpenAIResponse): string {
  return (response.output ?? [])
    .flatMap((item) =>
      item.type === 'message'
        ? (item.content ?? [])
            .filter((part) => part.type === 'output_text' && part.text)
            .map((part) => part.text as string)
        : [],
    )
    .join('\n')
    .trim();
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
  if (!env().OPENAI_API_KEY) throw new OperationalBriefError('SIN_CLAVE');

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

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env().OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
      body: JSON.stringify({
        model: config.model,
        store: false,
        reasoning: { effort: config.reasoningEffort },
        instructions:
          'Eres la capa de briefing operativo de Recepción del Hotel HW Libertad. ' +
          'Recibirás una lista YA PRIORIZADA por reglas determinísticas del Libro. ' +
          'No cambies el orden, no inventes hechos, huéspedes, montos, reservas ni estados. ' +
          'Resume en español claro y ejecutivo qué exige atención ahora y por qué. ' +
          'Usa como máximo 4 puntos breves. No agregues saludo ni despedida. ' +
          'Si dos elementos dependen entre sí, puedes explicarlo, pero nunca crear una dependencia no indicada.',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  generatedAt: new Date().toISOString(),
                  timezone: env().HOTEL_TIMEZONE,
                  attention: compact,
                }),
              },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    throw new OperationalBriefError(
      classifyAssistantFailure({ aborted, network: !aborted }),
      error instanceof Error ? error : undefined,
    );
  }

  let payload: OpenAIResponse | null = null;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiError = payload?.error;
    throw new OperationalBriefError(
      classifyAssistantFailure({
        status: response.status,
        code: apiError?.code ?? apiError?.type ?? null,
        message: apiError?.message ?? null,
      }),
    );
  }

  if (!payload) throw new OperationalBriefError('CAIDO');

  return {
    brief: responseText(payload) || 'No pude resumir la bandeja en este momento.',
    generatedAt: new Date(),
    attention,
  };
}
