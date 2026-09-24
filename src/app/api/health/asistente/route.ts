import { NextResponse } from 'next/server';
import {
  assistantHealthFromFailure,
  type AssistantHealth,
} from '@/domain/assistant-status';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import {
  probeFrontiProvider,
  resolveFrontiProviderChainRuntime,
} from '@/server/ai/fronti-provider';
import { FRONTI_AGENT_VERSION } from '@/server/ai/fronti-v2/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TTL_MS = 60_000;
let cached:
  | {
      at: number;
      provider: string;
      model: string;
      chain: Array<{ provider: string; model: string }>;
      health: AssistantHealth;
    }
  | null = null;

async function probeAssistant(): Promise<{
  provider: string;
  model: string;
  chain: Array<{ provider: string; model: string }>;
  health: AssistantHealth;
}> {
  const config = await getFrontiConfig();
  const chain = await resolveFrontiProviderChainRuntime({
    reasoningEffort: config.reasoningEffort,
  });

  if (!chain.length) {
    return {
      provider: 'none',
      model: 'none',
      chain: [],
      health: assistantHealthFromFailure('SIN_CLAVE'),
    };
  }

  let lastFailure: import('@/domain/assistant-status').AssistantFailure = 'CAIDO';
  for (const provider of chain) {
    const result = await probeFrontiProvider(provider);
    if (result.ok) {
      return {
        provider: provider.provider,
        model: provider.model,
        chain: chain.map((item) => ({
          provider: item.provider,
          model: item.model,
        })),
        health: { estado: 'OK' },
      };
    }
    lastFailure = result.failure;
  }

  return {
    provider: chain[0]?.provider ?? 'none',
    model: chain[0]?.model ?? 'none',
    chain: chain.map((item) => ({
      provider: item.provider,
      model: item.model,
    })),
    health: assistantHealthFromFailure(lastFailure),
  };
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > PROBE_TTL_MS) {
    const probed = await probeAssistant();
    cached = { at: now, ...probed };
  }

  return NextResponse.json(
    {
      ok: true,
      provider: cached.provider,
      model: cached.model,
      providerChain: cached.chain,
      agentVersion: FRONTI_AGENT_VERSION,
      ...cached.health,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
