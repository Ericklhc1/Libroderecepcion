import { NextResponse } from 'next/server';
import {
  assistantHealthFromFailure,
  type AssistantFailure,
  type AssistantHealth,
} from '@/domain/assistant-status';
import { getFrontiConfig } from '@/server/ai/fronti-config';
import {
  getFrontiProviderCredentialView,
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
      checks: Array<{
        provider: string;
        model: string;
        ok: boolean;
        failure?: AssistantFailure;
        probe: 'catalog';
        credentialSource: string;
        cloudflareAccountIdSource: string | null;
        baseUrlConfigured: boolean;
      }>;
      health: AssistantHealth;
    }
  | null = null;

async function probeAssistant(): Promise<{
  provider: string;
  model: string;
  chain: Array<{ provider: string; model: string }>;
  checks: Array<{
    provider: string;
    model: string;
    ok: boolean;
    failure?: AssistantFailure;
    probe: 'catalog';
    credentialSource: string;
    cloudflareAccountIdSource: string | null;
    baseUrlConfigured: boolean;
  }>;
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
      checks: [],
      health: assistantHealthFromFailure('SIN_CLAVE'),
    };
  }

  const results = await Promise.all(
    chain.map(async (provider) => {
      const [result, credential] = await Promise.all([
        probeFrontiProvider(provider),
        getFrontiProviderCredentialView(provider.provider),
      ]);
      return { provider, result, credential };
    }),
  );
  const checks = results.map(({ provider, result, credential }) => ({
    provider: provider.provider,
    model: provider.model,
    ok: result.ok,
    ...(!result.ok ? { failure: result.failure } : {}),
    probe: 'catalog' as const,
    credentialSource: credential.effectiveCredentialSource,
    cloudflareAccountIdSource: credential.cloudflareAccountIdSource,
    baseUrlConfigured: credential.baseUrlConfigured,
  }));
  const firstHealthy = results.find(({ result }) => result.ok);
  if (firstHealthy) {
    return {
      provider: firstHealthy.provider.provider,
      model: firstHealthy.provider.model,
      chain: chain.map((item) => ({
        provider: item.provider,
        model: item.model,
      })),
      checks,
      health: { estado: 'OK' },
    };
  }

  const lastFailure =
    [...results].reverse().find(({ result }) => !result.ok)?.result;
  return {
    provider: chain[0]?.provider ?? 'none',
    model: chain[0]?.model ?? 'none',
    chain: chain.map((item) => ({
      provider: item.provider,
      model: item.model,
    })),
    checks,
    health: assistantHealthFromFailure(
      lastFailure && !lastFailure.ok ? lastFailure.failure : 'CAIDO',
    ),
  };
}

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > PROBE_TTL_MS) {
    const probed = await probeAssistant();
    cached = { at: now, ...probed };
  }

  const degradedProviders = cached.checks
    .filter((check) => !check.ok)
    .map((check) => ({
      provider: check.provider,
      model: check.model,
      failure: check.failure ?? 'CAIDO',
    }));
  const healthyProviders = cached.checks.filter((check) => check.ok).length;

  return NextResponse.json(
    {
      ok: true,
      provider: cached.provider,
      model: cached.model,
      providerChain: cached.chain,
      providerChecks: cached.checks,
      healthyProviders,
      degradedProviders,
      degraded: cached.health.estado === 'OK' && degradedProviders.length > 0,
      diagnosticNote:
        degradedProviders.some((item) => item.provider === 'cloudflare')
          ? 'La sonda automática de Cloudflare valida el catálogo de modelos. Un 401/403 puede significar credencial, permisos Workers AI o account ID; no demuestra por sí solo que la clave sea incorrecta. La prueba de inferencia real se hace desde Administración > Fronti.'
          : null,
      agentVersion: FRONTI_AGENT_VERSION,
      ...cached.health,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
