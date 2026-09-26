import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { TUTORIAL_STEPS, shouldNavigateTutorial } from '@/domain/tutorial-tour';

describe('recorrido guiado', () => {
  it('al posponerlo deja de controlar la navegación', () => {
    expect(shouldNavigateTutorial(true, '/caja', '/')).toBe(false);
    expect(shouldNavigateTutorial(true, '/libro', '/libro?clase=entry')).toBe(false);
  });

  it('se suspende por completo cuando un bloqueo operativo tiene prioridad', () => {
    expect(shouldNavigateTutorial(false, '/turno', '/caja', true)).toBe(false);
    expect(shouldNavigateTutorial(false, '/caja', '/turno', true)).toBe(false);
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

  it('el layout subordina el tutorial al gate operativo', async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    const component = readFileSync('src/components/layout/tutorial.tsx', 'utf8');

    expect(layout).toContain("suspended={receptionGate.mode !== 'ACTIVE'}");
    expect(component).toContain('dismissed || suspended || !step');
    expect(component).toContain('dismissed || suspended || steps.length === 0 || !step');
  });

  it('no pelea contra el scroll y ofrece salida explícita al interactuar', async () => {
    const { readFileSync } = await import('node:fs');
    const component = readFileSync('src/components/layout/tutorial.tsx', 'utf8');

    expect(component).toContain("window.addEventListener('scroll', passiveMeasure, true)");
    expect(component).toContain('ÚNICO desplazamiento automático del paso');
    expect(component.match(/scrollIntoView/g)?.length).toBe(2);
    expect(component).toContain('Te alejaste del punto señalado');
    expect(component).toContain('Volver al punto');
    expect(component).toContain('¿Quieres interactuar con el Libro?');
    expect(component).toContain('Cerrar esta vez');
    expect(component).toContain('No volver a mostrar');
    expect(component).toContain('Puedes activarlo cuando quieras desde Mi perfil');
    expect(component).toContain("document.addEventListener('pointerdown', onPointerDown, true)");
  });

  it('mantiene una guía ampliada sólo durante los primeros cinco turnos', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/(app)/turno/page.tsx', 'utf8');
    const actions = readFileSync('src/components/operational/shift-actions.tsx', 'utf8');

    expect(page).toContain('startedShiftCount');
    expect(page).toContain('startedShiftCount <= 5');
    expect(page).toContain('startedShiftCount < 5');
    expect(page).toContain('Guía ampliada de turno');
    expect(actions).toContain('Guía ampliada · turno {session} de 5');
    expect(actions).toContain('Vas a iniciar tu turno');
    expect(actions).toContain('Vas a iniciar el cierre');
    expect(actions).toContain('Último paso: cerrar el turno');
  });

  it('cada paso de una ruta señala una sección de la pantalla', () => {
    for (const step of TUTORIAL_STEPS.filter((candidate) => candidate.route)) {
      expect(step.target, step.id).toBeTruthy();
    }
  });
});
