import { describe, expect, it, vi } from 'vitest';
import { lockBodyScroll } from '@/lib/body-scroll-lock';
describe('desplazamiento con ventanas superpuestas', () => {
  it('restaura el valor original al cerrar en cualquier orden e ignora liberaciones repetidas', () => {
    const body = { style: { overflow: 'auto' } };
    vi.stubGlobal('document', { body });
    try {
      const outer = lockBodyScroll(); const inner = lockBodyScroll();
      expect(body.style.overflow).toBe('hidden');
      outer(); outer(); expect(body.style.overflow).toBe('hidden');
      inner(); expect(body.style.overflow).toBe('auto');
      const again = lockBodyScroll(); again(); expect(body.style.overflow).toBe('auto');
    } finally { vi.unstubAllGlobals(); }
  });
});
