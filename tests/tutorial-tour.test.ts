import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { TUTORIAL_STEPS, shouldNavigateTutorial } from '@/domain/tutorial-tour';

describe('recorrido guiado', () => {
  it('al posponerlo deja de controlar la navegación', () => {
    expect(shouldNavigateTutorial(true, '/caja', '/')).toBe(false);
    expect(shouldNavigateTutorial(true, '/libro', '/libro?clase=entry')).toBe(false);
  });

  it('compara pathname sin confundir query string', () => {
    expect(shouldNavigateTutorial(false, '/libro', '/libro?clase=entry')).toBe(false);
    expect(shouldNavigateTutorial(false, '/libro/abc', '/libro?clase=entry')).toBe(false);
    expect(shouldNavigateTutorial(false, '/caja', '/libro?clase=entry')).toBe(true);
  });

  it('la portada sólo redirige mientras el recorrido está activo', () => {
    expect(shouldNavigateTutorial(false, '/', '/')).toBe(false);
    expect(shouldNavigateTutorial(false, '/caja', '/')).toBe(true);
    expect(shouldNavigateTutorial(true, '/caja', '/')).toBe(false);
  });

  it('presenta todos los destinos visibles de la navegación', () => {
    const routes = new Set(TUTORIAL_STEPS.map((step) => step.route).filter(Boolean));
    const missing = NAV_ITEMS.map((item) => item.href).filter((href) => !routes.has(href));
    expect(missing).toEqual([]);
  });

  it('explica el núcleo vigente sin enseñar PMS ni Habitaciones', () => {
    const routes = TUTORIAL_STEPS.map((step) => step.route).filter(Boolean);

    expect(routes).toContain('/libro?clase=entry');
    expect(routes).toContain('/caja');
    expect(routes).toContain('/turno');
    expect(routes).toContain('/llaves');
    expect(routes).toContain('/supervision');

    for (const retired of [
      '/reservas',
      '/huespedes',
      '/huespedes/importar',
      '/habitaciones',
    ]) {
      expect(routes).not.toContain(retired);
    }

    const descriptions = TUTORIAL_STEPS.map((step) => step.description).join(' ').toLowerCase();
    expect(descriptions).not.toContain('id fns');
    expect(descriptions).not.toContain('importación pms');
  });

  it('cada paso de una ruta señala una sección de la pantalla', () => {
    for (const step of TUTORIAL_STEPS.filter((candidate) => candidate.route)) {
      expect(step.target, step.id).toBeTruthy();
    }
  });
});
