import { describe, expect, it } from 'vitest';
import {
  normalizeFrontiToolsForProvider,
  type FrontiToolDefinitionLike,
} from '@/server/ai/fronti-v2/provider-schema';

function noArgTool(): FrontiToolDefinitionLike {
  return {
    type: 'function',
    function: {
      name: 'consultar_prioridades',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  };
}

describe('FRONTI · compatibilidad de schemas por proveedor', () => {
  it('normaliza herramientas sin argumentos para Groq', () => {
    const source = [noArgTool()];
    const normalized = normalizeFrontiToolsForProvider('groq', source);

    expect(normalized).toBeDefined();
    const parameters = normalized?.[0]?.function.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(parameters.properties).toHaveProperty('_fronti');
    expect(parameters.required).toEqual(['_fronti']);
    expect(parameters.additionalProperties).toBe(false);
  });

  it('no altera herramientas con argumentos reales', () => {
    const tool: FrontiToolDefinitionLike = {
      type: 'function',
      function: {
        name: 'consultar_caja',
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            movements: { type: 'integer' },
          },
          required: ['movements'],
          additionalProperties: false,
        },
      },
    };

    const normalized = normalizeFrontiToolsForProvider('groq', [tool]);
    expect(normalized?.[0]).toBe(tool);
  });

  it('no aplica el workaround a OpenAI ni vLLM', () => {
    const openai = [noArgTool()];
    const vllm = [noArgTool()];

    expect(normalizeFrontiToolsForProvider('openai', openai)).toBe(openai);
    expect(normalizeFrontiToolsForProvider('vllm', vllm)).toBe(vllm);
  });
});
