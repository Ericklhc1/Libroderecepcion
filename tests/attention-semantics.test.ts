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

    expect(page).toContain('Recuérdalo más tarde o avisa a alguien');
    expect(page).toContain('no crea otro asunto ni cambia su estado');
    expect(page).toContain('Abrir objeto original');
    expect(service).toContain('sourceLink');
    expect(service).toContain("link: recipient.alarm.sourceLink ?? '/alertas'");
    expect(service).toContain('createOperationalAlarm');
  });

  it('Notificaciones son avisos sin estado operativo propio', () => {
    const page = readFileSync('src/app/(app)/notificaciones/page.tsx', 'utf8');
    const actions = readFileSync(
      'src/app/(app)/notificaciones/notification-actions.tsx',
      'utf8',
    );

    expect(page).toContain('Leer un aviso no resuelve el asunto');
    expect(page).toContain('Abre el aviso para continuar en el asunto original');
    expect(actions).toContain("fetch('/api/notifications/read'");
    expect(actions).toContain('router.push(href)');
  });

  it('Indicadores no vuelve a contar Alert legada como alerta visible', () => {
    const metrics = readFileSync('src/server/services/metrics.ts', 'utf8');
    expect(metrics).toContain('prisma.operationalAlarm.count');
    expect(metrics).not.toContain('prisma.alert.count');
  });

  it('Tareas conservan su ciclo propio, inicio programado y avisos enlazados', () => {
    const page = readFileSync('src/app/(app)/tareas/page.tsx', 'utf8');
    const service = readFileSync('src/server/services/tasks.ts', 'utf8');
    const schemas = readFileSync('src/server/schemas.ts', 'utf8');
    const tests = readFileSync('tests/tasks.test.ts', 'utf8');

    expect(page).toContain('Lo que hay que hacer, con responsable y fecha límite');
    expect(service).toContain('startsAt?: Date | null');
    expect(service).toContain('startsAt: input.startsAt ?? null');
    expect(service).toContain('La fecha límite debe ser posterior al inicio programado');
    expect(service).toContain('link: `/tareas/${created.id}`');
    expect(schemas).toContain('startsAt: zOptionalDate');
    expect(tests).toContain("type: 'TAREA_ASIGNADA'");
    expect(tests).toContain("status: TaskStatus.COMPLETADA");
  });
});
