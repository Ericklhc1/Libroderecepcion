import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Chat anclado al borde del viewport', () => {
  const source = readFileSync('src/components/layout/chat-widget.tsx', 'utf8');

  it('mantiene la pestaña cerrada pegada a la derecha en móvil y escritorio', () => {
    expect(source).toContain('fixed bottom-20 right-0');
    expect(source).toContain('lg:bottom-0');
    expect(source).not.toContain('lg:left-64');
  });

  it('abre el panel desde el mismo borde derecho fuera de móvil pequeño', () => {
    expect(source).toContain('sm:bottom-20 sm:right-0');
    expect(source).toContain('sm:rounded-l-2xl');
    expect(source).toContain('lg:bottom-12');
  });
});
