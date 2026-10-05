import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../src/components/ui/button';
import { describe, expect, it } from 'vitest';
import { secondaryDestinations } from '../src/components/layout/navigation-presentation';
import { visibleNavGroups, type NavItem } from '../src/components/layout/nav-items';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '../src/lib/permissions';

function contrast(a: string, b: string) {
  const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + .05) / (dark! + .05);
}

describe('presentación compacta sin cambiar destinos ni permisos', () => {
  it.each(Object.values(ROLE_KEYS))('conserva cada URL exacta autorizada del rol %s una sola vez por módulo', role => {
    const groups = visibleNavGroups(ROLE_PERMISSIONS[role], role === ROLE_KEYS.SYSTEM_ADMIN);
    const original = JSON.stringify(groups);
    for (const item of groups.flatMap(group => group.items)) {
      const before = new Set([item.href, ...(item.menu ?? []).flatMap(section => section.items.map(link => link.href))]);
      const sections = secondaryDestinations(item);
      const after = [item.href, ...sections.flatMap(section => section.items.map(link => link.href))];
      expect(new Set(after)).toEqual(before);
      expect(after.length).toBe(before.size);
      expect(sections.every(section => section.items.length > 0)).toBe(true);
    }
    expect(JSON.stringify(groups)).toBe(original);
  });

  it('no fusiona filtros, anclas ni consultas con la raíz', () => {
    const item: NavItem = { href: '/turno', label: 'Mi turno', icon: 'shift', menu: [{ title: 'Turno', items: [
      { href: '/turno', label: 'Estado' }, { href: '/turno#abrir-turno', label: 'Abrir' },
      { href: '/turno?vista=historial', label: 'Historial' }, { href: '/turno#abrir-turno', label: 'Duplicado' },
    ] }] };
    expect(secondaryDestinations(item).flatMap(section => section.items.map(link => link.href)))
      .toEqual(['/turno#abrir-turno', '/turno?vista=historial']);
  });

  it('retira el desplegable vacío de Equipo y conserva su raíz para Housekeeping', () => {
    const item = visibleNavGroups(ROLE_PERMISSIONS[ROLE_KEYS.HK_ATTENDANT])
      .flatMap(group => group.items).find(item => item.href === '/equipo')!;
    expect(item.href).toBe('/equipo');
    expect(secondaryDestinations(item)).toEqual([]);
  });

  it('usa una única apertura del catálogo en móvil y conserva cuenta y apariencia', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    const context = nav.slice(nav.indexOf('data-module-navigation="mobile"'), nav.indexOf('{openMore && mounted'));
    expect(context).not.toContain('<button');
    expect(nav).toContain('<span>Más</span>');
    expect(nav).toContain('<AppearancePreference />');
    expect(nav).toContain('href="/perfil"');
  });
});

describe('paleta acuarela y acciones azul oscuro', () => {
  it('mantiene AA en texto e iconos y 3:1 de foco en ambos temas', () => {
    for (const surface of ['#e4edf5', '#f0f4f8']) {
      expect(contrast('#1d4351', surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#475569', surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#356c7c', surface)).toBeGreaterThanOrEqual(3);
    }
    for (const surface of ['#203b4e', '#29485c']) {
      expect(contrast('#c8dfe8', surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#aecdd5', surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast('#ffffff', '#173442')).toBeGreaterThanOrEqual(4.5);
  });

  it('unifica Nueva novedad y los turnos guiados en la acción azul oscuro', () => {
    const html = renderToStaticMarkup(createElement(Button, { variant: 'gold' }, 'Acción'));
    expect(html).toContain('bg-petrol-800 text-white hover:bg-petrol-900');
    expect(html).not.toContain('bg-gold-500');
    expect(readFileSync('src/components/layout/quick-actions.tsx', 'utf8')).toContain('triggerVariant="gold"');
    expect(readFileSync('src/components/operational/shift-actions.tsx', 'utf8')).not.toContain('bg-gold-500');
  });

  it('aplica tokens claros/oscuros y preserva logo y tipografía', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    for (const token of ['--aroh-topbar: #e4edf5', '--aroh-topbar: #203b4e', '--aroh-focus: #356c7c', '--aroh-focus: #aecdd5']) expect(css).toContain(token);
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('aroh-topbar');
    expect(layout).toContain('text-gold-600">Central IA');
    expect(layout).not.toContain('<PropertyMenu');
    expect(readFileSync('src/components/ui/button.tsx', 'utf8')).not.toContain('bg-gold-500');
  });
});
