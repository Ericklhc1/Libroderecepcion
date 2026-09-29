import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Central 1.26.0 · shell horizontal', () => {
  it('mueve las acciones rápidas desde la cabecera global al módulo Novedades', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    const libro = readFileSync('src/app/(app)/libro/page.tsx', 'utf8');

    expect(layout).not.toContain('<QuickActions');
    expect(libro).toContain('<QuickActions user={user} compact />');
    expect(libro).toContain('data-tour="module-actions"');
  });

  it('mantiene Fronti como la misma capacidad y sólo cambia su lanzador de escritorio', () => {
    const assistant = readFileSync('src/components/layout/fronti-assistant.tsx', 'utf8');
    const topbar = readFileSync('src/components/layout/topbar-menus.tsx', 'utf8');

    expect(topbar).toContain("new CustomEvent('fronti:open')");
    expect(assistant).toContain("window.addEventListener('fronti:open'");
    expect(assistant).toContain('pageContext: { pathname }');
    expect(assistant).not.toContain('event-driven');
  });

  it('integra procedimientos y reactivación del recorrido dentro de Ayuda', () => {
    const help = readFileSync('src/components/layout/help-center.tsx', 'utf8');

    expect(help).toContain('restartTutorialAction');
    expect(help).toContain('Iniciar recorrido');
    expect(help).toContain('Procedimientos');
    expect(help).toContain('searchHelp(query, permissions)');
  });

  it('ofrece reporte y solicitud con contexto técnico sin leer datos de otros módulos', () => {
    const panel = readFileSync('src/components/layout/support-request-panel.tsx', 'utf8');
    const route = readFileSync('src/app/api/soporte/solicitud/route.ts', 'utf8');
    const settings = readFileSync('src/server/services/settings.ts', 'utf8');

    expect(panel).toContain('Reportar problema');
    expect(panel).toContain('Solicitar función');
    expect(panel).toContain('getDisplayMedia');
    expect(panel).toContain('/api/soporte/solicitud');
    expect(panel).toContain("import { createPortal } from 'react-dom'");
    expect(panel).toContain('open && mounted ? createPortal(');
    expect(panel).toContain('document.body');
    expect(panel).toContain('fixed inset-0 z-[130]');
    expect(route).toContain('CONTEXTO AUTOMÁTICO');
    expect(route).toContain("getSettingString('support.recipient'");
    expect(settings).toContain("'support.recipient'");
  });
});
