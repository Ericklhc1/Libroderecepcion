import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('semántica sostenida de Tareas, Alertas y Notificaciones', () => {
  it('el motor legado no vuelve a fabricar Alert automáticas', () => {
    const engine = readFileSync('src/server/services/alert-engine.ts', 'utf8');
    expect(engine).toContain('el motor deja de fabricar Alert');
    expect(engine).toContain('return { created: 0');
    expect(engine).not.toMatch(/runAlertEngine[\s\S]*?prisma\.alert\.create\(/);
  });

  it('Alertas son llamadas de atención programables y no duplican el objeto original', () => {
    const page = readFileSync('src/app/(app)/alertas/page.tsx', 'utf8');
    const service = readFileSync('src/server/services/operational-alarms.ts', 'utf8');

    expect(page).toContain('Llamadas de atención programables');
    expect(page).toContain('nunca duplica ni cambia el estado');
    expect(page).toContain('Abrir objeto original');
    expect(service).toContain('sourceLink');
    expect(service).toContain('createOperationalAlarm');
  });

  it('Notificaciones son avisos sin estado operativo propio', () => {
    const page = readFileSync('src/app/(app)/notificaciones/page.tsx', 'utf8');
    const actions = readFileSync(
      'src/app/(app)/notificaciones/notification-actions.tsx',
      'utf8',
    );

    expect(page).toContain('no tienen estado operativo propio');
    expect(page).toContain('te llevan al objeto original');
    expect(actions).toContain("fetch('/api/notifications/read'");
    expect(actions).toContain('router.push(href)');
  });

  it('Tareas conservan su ciclo propio y las notificaciones sólo avisan asignaciones', () => {
    const tasks = readFileSync('src/app/(app)/tareas/page.tsx', 'utf8');
    const tests = readFileSync('tests/tasks.test.ts', 'utf8');

    expect(tasks).toContain('Lo que hay que hacer, con responsable y fecha límite');
    expect(tests).toContain("type: 'TAREA_ASIGNADA'");
    expect(tests).toContain("status: TaskStatus.COMPLETADA");
  });
});
