import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldAttemptMemoryExtraction } from '@/server/ai/memory';

describe('FRONTI alpha · router y memoria auxiliar', () => {
  it('mantiene una cadena operativa exclusivamente de costo cero', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    expect(source).toContain("GROQ_PRIMARY_MODEL = 'openai/gpt-oss-120b'");
    expect(source).toContain("CLOUDFLARE_FALLBACK_MODEL = '@cf/zai-org/glm-4.7-flash'");
    expect(source).toContain("GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'");

    const chain = source.slice(
      source.indexOf('export async function resolveFrontiProviderChainRuntime'),
      source.indexOf('export async function resolveFrontiAuxiliaryProviderRuntime'),
    );
    expect(chain).toContain("provider: 'groq'");
    expect(chain).toContain("provider: 'cloudflare'");
    expect(chain).not.toContain("provider: 'openai'");
  });

  it('no dispara extracción de memoria para consultas operativas normales', () => {
    expect(shouldAttemptMemoryExtraction('¿Qué está pasando hoy?')).toBe(false);
    expect(shouldAttemptMemoryExtraction('¿Quién está en turno?')).toBe(false);
  });

  it('sí extrae memoria cuando el usuario expresa una preferencia o pide recordar', () => {
    expect(shouldAttemptMemoryExtraction('Recuerda que prefiero los informes breves.')).toBe(true);
    expect(shouldAttemptMemoryExtraction('De ahora en adelante muestra primero caja.')).toBe(true);
  });
});
