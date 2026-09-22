import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { TUTORIAL_STEPS } from '@/domain/tutorial-tour';

describe('recorrido guiado', () => {
  it('presenta todos los destinos visibles de la navegación', () => {
    const routes = new Set(TUTORIAL_STEPS.map((step) => step.route).filter(Boolean));
    const missing = NAV_ITEMS.map((item) => item.href).filter((href) => !routes.has(href));
    expect(missing).toEqual([]);
  });

  it('explica Novedades + Caja sin enseñar PMS, Habitaciones ni Llaves', () => {
    const routes = TUTORIAL_STEPS.map((step) => step.route).filter(Boolean);

    expect(routes).toContain('/libro?clase=entry');
    expect(routes).toContain('/caja');
    expect(routes).toContain('/turno');
    expect(routes).toContain('/supervision');

    for (const retired of [
      '/reservas',
      '/huespedes',
      '/huespedes/importar',
      '/habitaciones',
      '/llaves',
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
