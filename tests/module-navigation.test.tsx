import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopNav } from '../src/components/layout/fns-navigation';
import { activeDestination, activeModule, badgeFor, navigationContext } from '../src/components/layout/navigation-state';
import { visibleNavGroups, type NavGroup } from '../src/components/layout/nav-items';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '../src/lib/permissions';

const location = vi.hoisted(() => ({ pathname: '/', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));
vi.mock('next/link', () => ({ default: 'a' }));
const groups = visibleNavGroups(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN], true);

function item(href: string) { return groups.flatMap(group => group.items).find(candidate => candidate.href === href)!; }

describe('cabecera persistente y contexto de módulos', () => {
  it('agrupa los accesos en una fila acotada sin repetir todo el catálogo', () => {
    location.pathname = '/'; location.search = '';
    const html = renderToStaticMarkup(createElement(DesktopNav, { groups }));
    expect(html).toContain('aria-label="Módulos"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(groups.filter(group => group.title).length);
    expect(html).not.toContain('href="/admin/usuarios"');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).toContain('href="/" aria-current="page"');
  });

  it('la cabecera recibe sólo el catálogo filtrado y usa los nombres nativos del rol', () => {
    for (const role of Object.values(ROLE_KEYS)) {
      location.pathname = '/'; location.search = '';
      const allowed = visibleNavGroups(ROLE_PERMISSIONS[role]);
      const html = renderToStaticMarkup(createElement(DesktopNav, { groups: allowed }));
      for (const group of allowed) if (group.title) expect(html).toContain('aria-label="' + group.title + '"');
      if (!allowed.some(group => group.title === 'Administración')) expect(html).not.toContain('aria-label="Administración"');
    }
    const hk = visibleNavGroups(ROLE_PERMISSIONS[ROLE_KEYS.HK_ATTENDANT]);
    expect(navigationContext(hk, '/housekeeping', '').item?.label).toBe('Housekeeping');
    expect(navigationContext(hk, '/libro', 'clase=entry').item).toBeUndefined();
  });

  it('el contexto persistente distingue consultas del mismo módulo', () => {
    location.pathname = '/libro'; location.search = 'clase=entry&tipo=INCIDENCIA';
    const html = renderToStaticMarkup(createElement(DesktopNav, { groups }));
    expect(html).toContain('aria-label="Módulo actual"');
    expect(html).toContain('>Novedades</span>');
    expect(html).toContain('>Incidencias</span>');
    expect(navigationContext(groups, '/libro', 'clase=task').destinationLabel).toBe('Mis tareas');
    expect(navigationContext(groups, '/caja', 'seccion=garantias').destinationLabel).toBe('Garantías');
    expect(navigationContext(groups, '/equipo', 'seccion=plantillas').destinationLabel).toBe('Tipos de turno');
  });

  it('selecciona por consulta específica y conserva filtros ajenos a la navegación', () => {
    const libro = item('/libro?clase=entry');
    expect(activeDestination(libro, '/libro', 'q=pendiente&tipo=INCIDENCIA&clase=entry')).toBe('/libro?clase=entry&tipo=INCIDENCIA');
    expect(activeDestination(libro, '/libro', 'clase=task')).toBe('/libro?clase=task');
    expect(activeDestination(item('/llaves'), '/llaves', 'vista=llaves&piso=5')).toBe('/llaves?piso=5');
    expect(activeDestination(item('/turno'), '/turno', '')).toBe('/turno');
    expect(activeDestination(libro, '/libro/folio', 'clase=entry')).toBeNull();
    const shared: NavGroup[] = [{ title: 'Prueba', items: [
      { href: '/compartido?vista=uno', label: 'Uno', icon: 'home' },
      { href: '/compartido?vista=dos', label: 'Dos', icon: 'home' },
    ] }];
    expect(activeModule(shared, '/compartido', 'vista=dos')).toBe('/compartido?vista=dos');
  });

  it('las rutas secundarias y profundas permanecen en su módulo real', () => {
    for (const [path, root] of [
      ['/alertas', '/notificaciones'], ['/housekeeping', '/housekeeping'],
      ['/lavanderia', '/inventario'], ['/inventario', '/inventario'],
      ['/admin/auditoria', '/admin/auditoria'], ['/admin/turnos', '/turno'],
      ['/admin/usuarios/ejemplo', '/admin'], ['/tareas/ejemplo', '/libro?clase=entry'],
    ]) expect(activeModule(groups, path!)).toBe(root);
    expect(activeModule(groups, '/admin-extra')).toBeNull();
    expect(activeModule(groups, '/buscar')).toBeNull();
  });

  it('no pierde contadores de módulos cuya URL incluye consultas', () => {
    expect(badgeFor({ '/libro': 4 }, '/libro?clase=entry')).toBe(4);
    expect(badgeFor({ '/libro': 4, '/libro?clase=entry': 2 }, '/libro?clase=entry')).toBe(2);
    expect(badgeFor(undefined, '/libro')).toBe(0);
  });

  it('móvil conserva contexto, atajos, catálogo completo, apariencia y salida', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(nav).toContain('data-module-navigation="mobile"');
    expect(nav).toContain('<GroupedNav groups={allGroups}');
    expect(nav).toContain('items.filter((item) => item.mobile).slice(0, 4)');
    expect(nav).toContain('<AppearancePreference />');
    expect(nav).toContain('form data-clear-form-drafts action={logoutAction}');
    expect(nav).toContain("}, [route]);");
    expect(nav).toContain('if (returnFocus.current) trigger?.focus()');
    expect(layout).toContain('hotelName={hotelName} roleName={user.roleName}');
    expect(layout.indexOf('<MobileNav')).toBeLessThan(layout.indexOf('</header>'));
    for (const preserved of ['<FrontiLauncher', '<AccountMenu', '<HelpCenter', '<NotificationCenter', '<ChatWidget', '<ReceptionAssistant', '<ReceptionOperationGate', '<AnnouncementGate', '<TutorialTour']) expect(layout).toContain(preserved);
  });

  it('los desplegables contemplan teclado, clic exterior y retorno del foco', () => {
    const nav = readFileSync('src/components/layout/fns-navigation.tsx', 'utf8');
    for (const contract of ["'Escape'", "'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'Tab'", "'pointerdown'", "'focusin'", 'aria-controls=', 'trigger?.focus()']) expect(nav).toContain(contract);
    expect(nav).not.toContain('role="menu"');
    expect(nav).toContain("window.addEventListener('pageshow', onPageShow)");
    expect(nav).toContain('if (event.persisted) { setSelection(null); setExpandedModule(null); }');
  });
});


describe('fecha operativa visible sin alterar el ciclo del turno', () => {
  it('consulta la fecha nativa y conserva la fecha calendario de PostgreSQL', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('resolveOperationalBusinessDate()');
    expect(layout).toContain('formatCalendarDate(businessDate)');
    expect(layout).toContain('aria-label="Contexto operativo"');
    expect(layout).toContain('aria-label="Módulos sin JavaScript"');
    expect(layout).toContain('<noscript>');
    expect(layout).toContain('group.items.flatMap(item =>');
    expect(layout).toContain('dateTime={businessDate.toISOString().slice(0, 10)}');
    expect(layout).not.toContain('hotelCalendarDate(new Date())');
  });
});
