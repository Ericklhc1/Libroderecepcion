import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import {
  TUTORIAL_STEPS,
  enabledTutorialModules,
  moduleTutorialSteps,
  shouldNavigateTutorial,
} from '@/domain/tutorial-tour';
import { HELP_TOPICS } from '@/domain/help';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@/lib/permissions';

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
    expect(routes).toContain('/novedades/habitacion');
    expect(routes).toContain('/caja');
    expect(routes).toContain('/turno');
    expect(routes).toContain('/llaves');
    expect(routes).toContain('/alertas');
    expect(routes).toContain('/supervision');
    expect(routes).toContain('/gerencia');

    expect(routes).not.toContain('/central-reservas');

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


  it('detecta módulos habilitados por permisos y genera sólo su tutorial', () => {
    const receptionist = ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST];
    const management = ROLE_PERMISSIONS[ROLE_KEYS.MANAGEMENT];

    expect(enabledTutorialModules(receptionist)).toEqual(
      expect.arrayContaining(['novedades', 'habitaciones', 'caja', 'turno', 'llaves', 'alertas']),
    );
    expect(enabledTutorialModules(receptionist)).not.toContain('gerencia');

    expect(enabledTutorialModules(management)).toContain('gerencia');
    expect(enabledTutorialModules(management)).not.toContain('turno');

    const steps = moduleTutorialSteps(['gerencia'], management);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.every((step) => step.module === 'gerencia')).toBe(true);
    expect(steps.map((step) => step.id)).toContain('mod-gerencia-trazabilidad');
    expect(steps.map((step) => step.id)).toContain('mod-gerencia-fronti');
  });

  it('ofrece ayuda y recorrido de Housekeeping a todos los cargos habilitados',()=>{
    for(const role of [ROLE_KEYS.HK_ATTENDANT,ROLE_KEYS.HK_SUPERVISOR,ROLE_KEYS.HK_MANAGER,ROLE_KEYS.RECEPTIONIST,ROLE_KEYS.MANAGEMENT]){
      const permissions=ROLE_PERMISSIONS[role];expect(enabledTutorialModules(permissions)).toContain('housekeeping');
      const steps=moduleTutorialSteps(['housekeeping'],permissions);expect(steps).toHaveLength(2);expect(steps.map(s=>s.description).join(' ')).toContain('inspecciona');
      expect(HELP_TOPICS.find(t=>t.id==='gestionar-housekeeping')?.anyOf?.some(p=>permissions.includes(p))).toBe(true);
    }
    expect(enabledTutorialModules([])).not.toContain('housekeeping');
  });

  it('el layout ofrece onboarding sólo para módulos nuevos ya después del tutorial general', async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    const actions = readFileSync('src/server/actions/tutorial.ts', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260930112000_tutoriales_modulares/migration.sql',
      'utf8',
    );

    expect(layout).toContain('tutorialKnownModules');
    expect(layout).toContain('pendingModules');
    expect(layout).toContain('moduleTutorialSteps(pendingModules');
    expect(layout).toContain('mode="modules"');
    expect(actions).toContain('finishModuleTutorialAction');
    expect(actions).toContain('restartModuleTutorialAction');
    expect(actions).toContain('tutorialKnownModules');
    expect(migration).toContain('ADD COLUMN "tutorialKnownModules"');
    expect(migration).toContain('WHERE u."tutorialDoneAt" IS NOT NULL');
  });

  it('el layout subordina el tutorial al gate operativo', async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    const component = readFileSync('src/components/layout/tutorial.tsx', 'utf8');

    expect(layout).toContain("suspended={receptionGate.mode !== 'ACTIVE'}");
    expect(component).toContain('dismissed || suspended || !step');
    expect(component).toContain('dismissed || suspended || steps.length === 0 || !step');
  });

  it('no secuestra el scroll global y sólo vuelve al objetivo por acción explícita', async () => {
    const { readFileSync } = await import('node:fs');
    const component = readFileSync('src/components/layout/tutorial.tsx', 'utf8');

    expect(component).toContain("window.addEventListener('scroll', passiveMeasure, true)");
    expect(component).toContain('El recorrido nunca desplaza automáticamente la página');
    expect(component).toContain('Medir sin mover el viewport');
    expect(component).not.toContain('initialLocate');
    expect(component.match(/\.scrollIntoView\(/g)?.length).toBe(1);
    expect(component).toContain('Te alejaste del punto señalado');
    expect(component).toContain('Volver al punto');
    expect(component).toContain('¿Quieres interactuar con la Central?');
    expect(component).toContain('Cerrar esta vez');
    expect(component).toContain('No volver a mostrar');
    expect(component).toContain('Puedes activarlo cuando quieras desde Ayuda o Mi perfil');
    expect(component).toContain('libro:tutorial:dismissed:');
    expect(component).toContain('sessionStorage.setItem');
    expect(component).toContain('sessionReady');
    expect(component).toContain("document.addEventListener('click', onClickCapture, true)");
  });

  it('mantiene una guía ampliada sólo durante los primeros cinco turnos', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/(app)/turno/page.tsx', 'utf8');
    const actions = readFileSync('src/components/operational/shift-actions.tsx', 'utf8');

    expect(page).toContain('shiftExperienceCount');
    expect(page).toContain('shiftExperienceCount <= 5');
    expect(page).toContain('shiftExperienceCount < 5');
    expect(page).toContain('assignments:');
    expect(page).toContain('activatedAt: { not: null }');
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
