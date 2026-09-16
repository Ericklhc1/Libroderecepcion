import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import {
  ASSISTANT_TIMEOUT_MS,
  assistantHealthFromFailure,
  classifyAssistantFailure,
  type AssistantHealth,
} from '@/domain/assistant-status';
import { getFrontiConfig } from '@/server/ai/fronti-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Salud del asistente. No expone claves, ni el modelo, ni usuarios, ni
 * memoria, ni datos operativos: sólo en qué estado está.
 *
 * Antes devolvía `openaiConfigured: Boolean(OPENAI_API_KEY)`, que responde a
 * una pregunta que no sirve: dice si hay una clave escrita, no si funciona.
 * Con una clave revocada, o con un modelo que la cuenta no tiene, el endpoint
 * decía «configurado» y el mesón descubría el problema al preguntarle algo a
 * Fronti. Eran tres situaciones distintas confundidas en un booleano.
 *
 * Ahora distingue las tres:
 *
 *   NO_CONFIGURADO  no hay clave; Fronti nunca estuvo encendido
 *   OK              la clave sirve Y el modelo configurado existe
 *   CON_FALLO       hay clave, y algo la rechaza (con la causa concreta)
 *
 * El sondeo pide el modelo por su nombre a OpenAI, que es la comprobación más
 * barata que valida las DOS cosas a la vez —credencial y modelo— sin gastar
 * ni un token de generación.
 */

/** Sondeo con memoria corta, para que monitorizar no golpee la API. */
const PROBE_TTL_MS = 60_000;
let cached: { at: number; health: AssistantHealth } | null = null;

async function probeAssistant(): Promise<AssistantHealth> {
  const key = env().OPENAI_API_KEY;
  if (!key) return { estado: 'NO_CONFIGURADO' };

  const config = await getFrontiConfig();

  let response: Response;
  try {
    response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(config.model)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    return assistantHealthFromFailure(
      classifyAssistantFailure({ aborted, network: !aborted }),
    );
  }

  if (response.ok) return { estado: 'OK' };

  let code: string | null = null;
  let message: string | null = null;
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; type?: string; message?: string };
    };
    code = payload.error?.code ?? payload.error?.type ?? null;
    message = payload.error?.message ?? null;
  } catch {
    // Cuerpo ilegible: la clasificación se apoya sólo en el estado.
  }

  return assistantHealthFromFailure(
    classifyAssistantFailure({ status: response.status, code, message }),
  );
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > PROBE_TTL_MS) {
    cached = { at: now, health: await probeAssistant() };
  }

  const health = cached.health;
  return NextResponse.json(
    {
      /*
        `ok` sigue significando «el endpoint responde», como antes, para no
        romper a quien ya lo estuviera vigilando. Lo que dice si el asistente
        sirve es `estado`.
      */
      ok: true,
      ...health,
      // Compatibilidad: quien leía este campo sigue leyéndolo con el mismo
      // significado, «hay una clave escrita».
      openaiConfigured: health.estado !== 'NO_CONFIGURADO',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
