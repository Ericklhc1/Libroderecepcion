import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { TUTORIAL_STEPS } from '@/domain/tutorial-tour';

describe('recorrido guiado', () => {
  it('presenta todos los destinos visibles de la navegación', () => {
    const routes = new Set(TUTORIAL_STEPS.map((step) => step.route).filter(Boolean));
    const missing = NAV_ITEMS.map((item) => item.href).filter((href) => !routes.has(href));
    expect(missing).toEqual([]);
  });

  it('presenta la carga como Huéspedes & reservas y no como PMS', () => {
    const visibleCopy = TUTORIAL_STEPS.map(
      (step) => `${step.title} ${step.description}`,
    ).join(' ');

    expect(visibleCopy).toContain('Huéspedes & reservas');
    expect(visibleCopy.toLowerCase()).not.toContain('pms');
  });

  it('cada paso de una ruta señala una sección de la pantalla', () => {
    for (const step of TUTORIAL_STEPS.filter((candidate) => candidate.route)) {
      expect(step.target, step.id).toBeTruthy();
    }
  });
});
