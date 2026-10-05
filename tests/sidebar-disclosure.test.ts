import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GroupedNav, activeDestination, activeModule } from '../src/components/layout/app-sidebar';
import { visibleNavGroups } from '../src/components/layout/nav-items';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '../src/lib/permissions';

const location = vi.hoisted(() => ({ pathname: '/', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
vi.mock('next/link', () => ({ default: 'a' }));
const groups = visibleNavGroups(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN], true);

describe('menú plegable y barra de iconos', () => {
  it('Inicio no despliega todos los módulos ni sus enlaces secundarios', () => {
    location.pathname = '/'; location.search = '';
    const html = renderToStaticMarkup(createElement(GroupedNav, { groups, badges: { '/notificaciones': 3 } }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).not.toContain('href="/admin/usuarios"');
    expect(html).toContain('>3</span>');
  });
  it('abre el grupo actual y mantiene las vistas de Equipo bajo demanda', () => {
    location.pathname = '/equipo'; location.search = 'seccion=plantillas';
    const html = renderToStaticMarkup(createElement(GroupedNav, { groups }));
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toContain('href="/equipo"');
    expect(html).not.toContain('href="/equipo?seccion=plantillas"');
    expect(html).toContain('aria-label="Vistas de Equipo y horarios" aria-expanded="false"');
    expect(html).not.toContain('href="/admin/usuarios"');
    expect(html.match(/href="\/equipo"/g)).toHaveLength(1);
  });
  it('el modo reducido conserva grupos y no vuelve a listar cada módulo', () => {
    location.pathname = '/'; location.search = '';
    const html = renderToStaticMarkup(createElement(GroupedNav, { groups, compact: true }));
    for (const group of groups.filter(group => group.title)) expect(html).toContain('aria-label="' + group.title + '"');
    expect(html.match(/<svg/g)).toHaveLength(groups.length);
    expect(html).not.toContain('aria-label="Garantías"');
    expect(html).not.toContain('href="/admin/usuarios"');
  });
  it('no confunde Housekeeping, Auditoría o historial de turnos con Administración', () => {
    expect(activeModule(groups, '/alertas')).toBe('/notificaciones');
    expect(activeModule(groups, '/notificaciones')).toBe('/notificaciones');
    expect(activeModule(groups, '/admin/housekeeping')).toBe('/admin/housekeeping');
    expect(activeModule(groups, '/admin/auditoria')).toBe('/admin/auditoria');
    expect(activeModule(groups, '/admin/turnos')).toBe('/turno');
  });
  it('selecciona la consulta más específica sin marcar todas las secciones', () => {
    const equipo = groups.flatMap(group => group.items).find(item => item.href === '/equipo')!;
    expect(activeDestination(equipo, '/equipo', 'seccion=plantillas')).toBe('/equipo?seccion=plantillas');
    const libro = groups.flatMap(group => group.items).find(item => item.href.startsWith('/libro'))!;
    expect(activeDestination(libro, '/libro', 'clase=entry&tipo=INCIDENCIA')).toBe('/libro?clase=entry&tipo=INCIDENCIA');
  });
  it('sólo renderiza los enlaces ya autorizados por el servidor', () => {
    location.pathname = '/'; location.search = '';
    const html = renderToStaticMarkup(createElement(GroupedNav, { groups: visibleNavGroups([]), compact: true }));
    expect(html).not.toContain('Housekeeping');
    expect(html).not.toContain('Administración');
    expect(html).not.toContain('Equipo y horarios');
  });
  it('mantiene anclaje, preferencia por usuario y panel fuera del área recortada', () => {
    const source = readFileSync('src/components/layout/app-sidebar.tsx', 'utf8');
    expect(source).toContain('sticky top-0 hidden h-dvh');
    expect(source).toContain("compact ? 'w-16' : 'w-56'");
    expect(source).toContain("'aroh:sidebar:v1:' + userId");
    expect(source).toContain('createPortal(');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('aria-controls=');
    expect(source).toContain('openGroup === index ? null : index');
  });
});
