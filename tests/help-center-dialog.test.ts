import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/layout/help-center.tsx', 'utf-8');

describe('central de ayuda en móvil', () => {
  it('se monta en document.body para no heredar límites del shell', () => {
    expect(source).toContain("import { createPortal } from 'react-dom'");
    expect(source).toMatch(/createPortal\(dialog, document\.body\)/);
    expect(source).toContain('mounted');
  });

  it('usa el viewport dinámico y deja desplazable sólo el contenido', () => {
    expect(source).toContain('max-h-[calc(100dvh-1rem)]');
    expect(source).toContain('sm:max-h-[85dvh]');
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(source).toContain('shrink-0 border-t');
  });

  it('queda por encima de navegación, tutorial y botones flotantes', () => {
    expect(source).toContain('z-[120]');
  });

  it('bloquea el scroll de fondo y lo restaura al cerrar', () => {
    expect(source).toContain("document.body.style.overflow = 'hidden'");
    expect(source).toContain('previousOverflow');
  });
});
