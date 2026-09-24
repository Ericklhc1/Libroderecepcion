import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldAttemptMemoryExtraction } from '@/server/ai/memory';

describe('FRONTI alpha.4 · router y memoria auxiliar', () => {
  it('mantiene la cadena Sol -> Groq 120B -> Groq 20B', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    expect(source).toContain("OPENAI_PRIMARY_MODEL = 'gpt-5.6-sol'");
    expect(source).toContain("GROQ_PRIMARY_MODEL = 'openai/gpt-oss-120b'");
    expect(source).toContain("GROQ_FALLBACK_MODEL = 'openai/gpt-oss-20b'");
    expect(source).toContain('resolveFrontiProviderChainRuntime');
    expect(source).toContain('/responses');
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
