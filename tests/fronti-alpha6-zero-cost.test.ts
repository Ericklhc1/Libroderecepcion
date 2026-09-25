import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FRONTI alpha.6 · costo cero obligatorio', () => {
  it('la cadena activa es Groq 120B -> Cloudflare GLM -> Groq 20B', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    const start = source.indexOf('export async function resolveFrontiProviderChainRuntime');
    const end = source.indexOf('export async function resolveFrontiAuxiliaryProviderRuntime');
    const chain = source.slice(start, end);

    const groq120 = chain.indexOf('GROQ_PRIMARY_MODEL');
    const cloudflare = chain.indexOf('CLOUDFLARE_FALLBACK_MODEL');
    const groq20 = chain.indexOf('GROQ_FALLBACK_MODEL');

    expect(groq120).toBeGreaterThanOrEqual(0);
    expect(cloudflare).toBeGreaterThan(groq120);
    expect(groq20).toBeGreaterThan(cloudflare);
    expect(chain).not.toContain("provider: 'openai'");
  });

  it('la memoria auxiliar tampoco usa un proveedor pagado', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    const start = source.indexOf('export async function resolveFrontiAuxiliaryProviderRuntime');
    const end = source.indexOf('export function providerIsConfigured');
    const auxiliary = source.slice(start, end);

    expect(auxiliary).toContain("provider: 'cloudflare'");
    expect(auxiliary).toContain("provider: 'groq'");
    expect(auxiliary).not.toContain("provider: 'openai'");
  });

  it('la consola no ofrece OpenAI como proveedor operativo', () => {
    const settings = readFileSync(
      'src/app/(app)/admin/fronti/fronti-settings.tsx',
      'utf8',
    );
    const actions = readFileSync('src/server/actions/fronti.ts', 'utf8');

    expect(settings).toContain('<option value="cloudflare">');
    expect(settings).not.toContain('<option value="openai">');
    expect(actions).toContain("!['groq', 'cloudflare', 'vllm'].includes(value)");
  });

  it('Cloudflare reutiliza el Account ID de R2 y conserva token separado', () => {
    const env = readFileSync('src/lib/env.ts', 'utf8');
    const provider = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');

    expect(env).toContain('CLOUDFLARE_AI_API_TOKEN: secretEnv');
    expect(env).toContain('R2_ACCOUNT_ID');
    expect(env).toContain('R2_ACCOUND_ID');
    expect(provider).toContain("CLOUDFLARE_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash'");
    expect(provider).toContain('/ai/v1');
    expect(provider).toContain('/models/search');
  });
});
