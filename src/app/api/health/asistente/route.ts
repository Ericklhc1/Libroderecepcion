import { NextResponse } from 'next/server';
import {
  assistantHealthFromFailure,
  type AssistantHealth,
} from '@/domain/assistant-status';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import {
  probeFrontiProvider,
  resolveFrontiProviderRuntime,
} from '@/server/ai/fronti-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TTL_MS = 60_000;
let cached:
  | {
      at: number;
      provider: string;
      model: string;
      health: AssistantHealth;
    }
  | null = null;

async function probeAssistant(): Promise<{
  provider: string;
  model: string;
  health: AssistantHealth;
}> {
  const config = await getFrontiConfig();
  const provider = await resolveFrontiProviderRuntime(config);
  const result = await probeFrontiProvider(provider);

  return {
    provider: config.provider,
    model: config.model,
    health: result.ok
      ? { estado: 'OK' }
      : assistantHealthFromFailure(result.failure),
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
      ...cached.health,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
