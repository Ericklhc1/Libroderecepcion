import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FrontiConfig } from '@/server/ai/fronti-config';
import { selectFrontiToolDefinitions } from '@/server/ai/fronti-v2/tool-registry';

const config: FrontiConfig = {
  enabled: true,
  provider: 'openai',
  displayName: 'Fronti',
  welcomeMessage: 'Hola',
  extraInstructions: '',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'low',
  memoryRetentionDays: 30,
  shiftMemoryHours: 36,
  memoryContextLimit: 12,
  modelHistoryLimit: 15,
  sessionActivityMinutes: 15,
  tools: {
    room: true,
    priorities: true,
    deadlines: true,
    checkout: true,
    reminder: true,
    fine: true,
  },
};

describe('FRONTI alpha.5 · capacidad y presupuesto', () => {
  it('acota una consulta específica a Caja, garantías y novedades', () => {
    const names = selectFrontiToolDefinitions(
      config,
      'Ahora revisa Caja, garantías y novedades y dime si ves alguna incoherencia.',
    ).map((tool) => tool.name);

    expect(new Set(names)).toEqual(
      new Set(['consultar_caja', 'consultar_garantias', 'consultar_novedades']),
    );
  });

  it('mantiene lectura transversal para una consulta amplia', () => {
    const names = selectFrontiToolDefinitions(
      config,
      '¿Qué está pasando hoy? Revísalo en todo el Libro.',
    ).map((tool) => tool.name);

    expect(names).toContain('consultar_estado_operativo');
    expect(names).toContain('consultar_turnos');
    expect(names).toContain('consultar_novedades');
    expect(names).toContain('consultar_garantias');
    expect(names).not.toContain('proponer_registro');
    expect(names).not.toContain('proponer_checkouts');
  });

  it('usa Sol -> Terra -> Luna antes de Groq y limita salida', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');
    expect(source).toContain("OPENAI_PRIMARY_MODEL = 'gpt-5.6-sol'");
    expect(source).toContain("OPENAI_SECONDARY_MODEL = 'gpt-5.6-terra'");
    expect(source).toContain("OPENAI_TERTIARY_MODEL = 'gpt-5.6-luna'");
    expect(source).toContain('MAX_MODEL_OUTPUT_TOKENS = 1_800');
    expect(source).toContain('max_output_tokens: MAX_MODEL_OUTPUT_TOKENS');
    expect(source).toContain('max_completion_tokens: MAX_MODEL_OUTPUT_TOKENS');
  });
});
