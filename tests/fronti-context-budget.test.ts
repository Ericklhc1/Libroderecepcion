import { describe, expect, it } from 'vitest';
import {
  budgetConversationMessages,
  serializeToolResultForModel,
} from '@/server/ai/fronti-v2/context-budget';

describe('FRONTI v2 · presupuesto de contexto', () => {
  it('compacta resultados grandes manteniendo JSON válido', () => {
    const result = {
      entries: Array.from({ length: 60 }, (_, index) => ({
        id: `entry-${index}`,
        title: `Novedad ${index}`,
        description: 'x'.repeat(1_000),
        nested: {
          values: Array.from({ length: 30 }, (_, nested) => ({
            index: nested,
            detail: 'y'.repeat(500),
          })),
        },
      })),
    };

    const serialized = serializeToolResultForModel(result, { maxChars: 3_600 });
    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(serialized.length).toBeLessThan(5_000);

    const parsed = JSON.parse(serialized) as {
      ok: boolean;
      compacted: boolean;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.compacted).toBe(true);
  });

  it('mantiene los mensajes más recientes dentro de un presupuesto fijo', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `mensaje-${index}-${'x'.repeat(700)}`,
    }));

    const budgeted = budgetConversationMessages(messages, {
      maxMessages: 6,
      maxChars: 2_500,
    });

    expect(budgeted.length).toBeLessThanOrEqual(6);
    expect(budgeted.at(-1)?.content).toContain('mensaje-19-');
    expect(
      budgeted.reduce((sum, message) => sum + message.content.length, 0),
    ).toBeLessThanOrEqual(2_500);
  });
});
