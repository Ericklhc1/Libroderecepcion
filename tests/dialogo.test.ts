import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El diálogo de acciones rápidas debe permanecer centrado en el viewport real,
 * con cabecera visible y sólo el cuerpo desplazable. El portal evita que la
 * barra lateral o cualquier contenedor transformado alteren su geometría.
 */
const source = readFileSync('src/components/ui/dialog.tsx', 'utf-8');

describe('el diálogo vive en un portal', () => {
  it('se cuelga de document.body', () => {
    expect(source).toContain('createPortal');
    expect(source).toMatch(/createPortal\(\s*overlay,\s*document\.body\s*\)/);
  });

  it('espera a estar montado antes de crear el portal', () => {
    expect(source).toMatch(/open && mounted/);
  });
});

describe('el scroll vive en el cuerpo, no mueve la cabecera', () => {
  it('el overlay cubre el viewport y no introduce un segundo scroll', () => {
    const overlay = source.slice(source.indexOf('fixed inset-0'));
    expect(overlay.slice(0, 200)).toContain('overscroll-contain');
    expect(overlay.slice(0, 200)).not.toContain('overflow-y-auto');
  });

  it('el panel se centra contra el viewport real y limita su altura', () => {
    expect(source).toContain('left-[50vw]');
    expect(source).toContain('top-[50dvh]');
    expect(source).toContain('max-h-[calc(100dvh-2rem)]');
    expect(source).toContain('-translate-x-1/2');
    expect(source).toContain('-translate-y-1/2');
  });

  it('el panel es un flex vertical', () => {
    const panel = source.slice(source.indexOf("'fixed left-[50vw]"));
    expect(panel.slice(0, 260)).toContain('flex-col');
  });

  it('sólo el cuerpo desplaza, y la cabecera no se encoge', () => {
    expect(source).toContain('shrink-0');
    expect(source).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });

  it('la cabecera ya no depende de sticky', () => {
    const header = source.slice(source.indexOf('text-base font-semibold'));
    expect(header).not.toContain('sticky');
  });
});

describe('el enfoque no arrastra el scroll', () => {
  it('enfoca sin desplazar', () => {
    expect(source).toContain('preventScroll: true');
  });

  it('el foco arranca en el panel, no en el primer campo', () => {
    expect(source).toMatch(/panelRef\.current\?\.focus/);
    expect(source).not.toMatch(/querySelector<HTMLElement>\('input/);
  });

  it('el panel es enfocable y se anuncia como diálogo', () => {
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('role="dialog"');
  });
});

describe('al cerrar, la página queda como estaba', () => {
  it('restaura el overflow anterior en vez de vaciarlo', () => {
    expect(source).toContain('previousOverflow');
    expect(source).not.toMatch(/document\.body\.style\.overflow = ''/);
  });
});
