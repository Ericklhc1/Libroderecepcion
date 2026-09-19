import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Fronti operativo', () => {
  it('usa el formato de razonamiento compatible con tool calling de GPT-OSS en Groq', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf-8');

    expect(source).toContain("reasoning_format: 'hidden'");
    expect(source).not.toContain('include_reasoning: false');
  });

  it('el briefing devuelve soluciones accionables vinculadas a los puntos priorizados', () => {
    const service = readFileSync('src/server/ai/operational-brief.ts', 'utf-8');
    const route = readFileSync('src/app/api/fronti/brief/route.ts', 'utf-8');
    const component = readFileSync(
      'src/components/operational/operational-brief.tsx',
      'utf-8',
    );

    expect(service).toContain('const actionable = attention.slice(0, 4)');
    expect(service).toContain("id: `A${index + 1}`");
    expect(service).toContain('href: item.href');
    expect(service).toContain('detail: item.action');
    expect(route).toContain('actions: result.actions');
    expect(component).toContain('actions.map');
    expect(component).toContain('Aplicar');
    expect(component).toContain('href={action.href}');
  });
});
