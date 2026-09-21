import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { TUTORIAL_STEPS } from '@/domain/tutorial-tour';

describe('recorrido guiado', () => {
  it('presenta todos los destinos visibles de la navegación', () => {
    const routes = new Set(TUTORIAL_STEPS.map((step) => step.route).filter(Boolean));
    const missing = NAV_ITEMS.map((item) => item.href).filter((href) => !routes.has(href));
    expect(missing).toEqual([]);
  });

  it('presenta el PMS como contexto opcional y no como núcleo operativo', () => {
    const pmsStep = TUTORIAL_STEPS.find((step) => step.route === '/reservas');
    expect(pmsStep?.title).toContain('Contexto PMS');
    expect(pmsStep?.description.toLowerCase()).toContain('opcional');
    expect(pmsStep?.description.toLowerCase()).toContain('no es requisito');

    const coreRoutes = TUTORIAL_STEPS
      .filter((step) => ['/', '/turno', '/libro?clase=entry', '/caja', '/llaves'].includes(step.route ?? ''))
      .map((step) => step.route);
    expect(coreRoutes).toContain('/libro?clase=entry');
  });

  it('cada paso de una ruta señala una sección de la pantalla', () => {
    for (const step of TUTORIAL_STEPS.filter((candidate) => candidate.route)) {
      expect(step.target, step.id).toBeTruthy();
    }
  });
});
