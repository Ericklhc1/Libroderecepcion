import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isCataloguedFrontiPage,
  resolveFrontiPageContext,
} from '@/server/ai/fronti-v2/page-context';
import {
  selectFrontiToolDefinitions,
  frontiToolMode,
} from '@/server/ai/fronti-v2/tool-registry';
import type { FrontiConfig } from '@/server/ai/fronti-config';

const APP_ROOT = join(process.cwd(), 'src', 'app', '(app)');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function routeForPage(path: string): string {
  const local = relative(APP_ROOT, path).split(sep).join('/');
  const withoutPage = local === 'page.tsx' ? '' : local.replace(/\/page\.tsx$/, '');
  const segments = withoutPage
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment === '[numero]') return '415';
      if (segment === '[code]') return 'FNS-CONTEXTO';
      if (/^\[.+\]$/.test(segment)) return 'ctx-id';
      return segment;
    });
  return '/' + segments.join('/');
}

const config: FrontiConfig = {
  enabled: true,
  provider: 'groq',
  displayName: 'Fronti',
  welcomeMessage: 'Hola',
  extraInstructions: '',
  model: 'test',
  reasoningEffort: 'low',
  memoryRetentionDays: 30,
  shiftMemoryHours: 36,
  memoryContextLimit: 12,
  modelHistoryLimit: 15,
  sessionActivityMinutes: 15,
  tools: {
    room: true,
    priorities: true,
    deadlines: true,
    checkout: true,
    reminder: true,
    fine: true,
  },
};

describe('Fronti contextual · cobertura de pantallas', () => {
  const pages = walk(APP_ROOT).filter((path) => path.endsWith(sep + 'page.tsx'));

  it('cataloga todas las páginas autenticadas actuales', () => {
    const routes = pages.map(routeForPage);
    const missing = routes.filter((route) => !isCataloguedFrontiPage(route));
    expect(missing, 'Pantallas sin contexto Fronti: ' + missing.join(', ')).toEqual([]);
  });

  it('mantiene el catálogo enlazado al árbol real de la app', () => {
    expect(pages.length).toBeGreaterThanOrEqual(45);
    expect(pages.map(routeForPage)).toContain('/central-reservas');
    expect(pages.map(routeForPage)).toContain('/caja');
    expect(pages.map(routeForPage)).toContain('/supervision');
    expect(pages.map(routeForPage)).toContain('/gerencia');
    expect(pages.map(routeForPage)).toContain('/admin/fronti');
  });

  it('resuelve entidad dinámica y filtros visibles sin exponer parámetros sensibles', () => {
    const context = resolveFrontiPageContext({
      pathname: '/tareas/abc-123',
      search:
        '?estado=abiertas&q=late+checkout&token=no-debe-salir&api_key=tampoco&habitacion=512',
      title: 'Tarea #44 · AROH Central IA',
    });

    expect(context.moduleKey).toBe('tareas');
    expect(context.sectionKey).toBe('detalle');
    expect(context.entityType).toBe('Task');
    expect(context.entityId).toBe('abc-123');
    expect(context.filters).toEqual({
      estado: 'abiertas',
      q: 'late checkout',
      habitacion: '512',
    });
    expect(context.filters).not.toHaveProperty('token');
    expect(context.filters).not.toHaveProperty('api_key');
  });

  it('entiende las subsecciones de Caja y Prellegadas', () => {
    const cash = resolveFrontiPageContext({
      pathname: '/caja',
      search: '?seccion=garantias',
    });
    expect(cash.sectionLabel).toBe('Garantías');
    expect(cash.recommendedTools).toEqual(
      expect.arrayContaining([
        'consultar_contexto_pantalla',
        'consultar_caja',
        'consultar_garantias',
      ]),
    );

    const reservations = resolveFrontiPageContext({
      pathname: '/central-reservas',
      search: '?vista=24h&q=martinez',
    });
    expect(reservations.moduleKey).toBe('prellegadas');
    expect(reservations.moduleLabel).toBe('Prellegadas');
    expect(reservations.sectionLabel).toBe('Llegadas próximas 24 h');
    expect(reservations.filters.q).toBe('martinez');
  });
  it('entiende Novedades / habitación como monitor de continuidad', () => {
    const room = resolveFrontiPageContext({
      pathname: '/habitaciones',
      search: '?habitacion=617',
    });
    expect(room.moduleLabel).toBe('Novedades / habitación');
    expect(room.sectionLabel).toBe('Habitación 617');
    expect(room.entityType).toBe('RoomNumber');
    expect(room.entityId).toBe('617');
    expect(room.recommendedTools).toEqual(
      expect.arrayContaining([
        'consultar_novedades',
        'consultar_tareas',
        'consultar_garantias',
        'consultar_llaves',
      ]),
    );
  });

  it('entiende Gerencia como contexto estratégico de sólo lectura', () => {
    const management = resolveFrontiPageContext({
      pathname: '/gerencia',
      search: '?dias=30',
    });
    expect(management.moduleKey).toBe('gerencia');
    expect(management.sectionLabel).toBe('Cockpit estratégico de Gerencia');
    expect(management.filters.dias).toBe('30');
    expect(management.recommendedTools).toEqual(
      expect.arrayContaining([
        'consultar_contexto_pantalla',
        'consultar_prioridades',
        'consultar_supervision',
        'consultar_caja',
        'consultar_garantias',
        'consultar_llaves',
        'consultar_turnos',
        'consultar_auditoria',
      ]),
    );
  });

  it('mantiene lectura contextual disponible fuera de turno pero bloquea propuestas', () => {
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf8');
    expect(source).toContain("const mode = frontiToolMode(name)");
    expect(source).toContain("gate.mode !== 'ACTIVE' && mode !== 'read'");
    expect(source).toContain('Las consultas de lectura siguen disponibles.');
  });

});

describe('Fronti contextual · selección de herramientas', () => {
  it('“qué falta aquí” en Garantías recibe contexto + Caja + Garantías', () => {
    const page = resolveFrontiPageContext({
      pathname: '/caja',
      search: '?seccion=garantias',
    });
    const names = selectFrontiToolDefinitions(config, '¿Qué falta aquí?', page).map(
      (tool) => tool.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        'consultar_contexto_pantalla',
        'consultar_caja',
        'consultar_garantias',
      ]),
    );
  });

  it('una pregunta corta hereda las capacidades relevantes de su módulo', () => {
    const page = resolveFrontiPageContext({
      pathname: '/turno',
    });
    const names = selectFrontiToolDefinitions(config, '¿Y ahora?', page).map(
      (tool) => tool.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        'consultar_contexto_pantalla',
        'consultar_turnos',
        'consultar_caja',
      ]),
    );
  });

  it('el contexto de pantalla es lectura; las propuestas siguen siendo escritura confirmada', () => {
    expect(frontiToolMode('consultar_contexto_pantalla')).toBe('read');
    expect(frontiToolMode('consultar_caja')).toBe('read');
    expect(frontiToolMode('proponer_registro')).toBe('propose');
    expect(frontiToolMode('proponer_checkouts')).toBe('propose');
  });
});
