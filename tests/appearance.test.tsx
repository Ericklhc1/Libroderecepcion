import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_INIT_SCRIPT, APPEARANCE_OPTIONS, APPEARANCE_STORAGE_KEY,
  parseAppearance, readAppearance, resolveAppearance, saveAppearance,
} from '@/domain/appearance';
import { DARK_STATUS_COLORS, DARK_SURFACE_COLORS, DARK_TEXT_COLORS } from '@/lib/appearance-palette';
import { AppearanceProvider } from '@/components/appearance/appearance-provider';
import { AppearancePreference } from '@/components/appearance/appearance-preference';

function runBootstrap(stored: unknown, systemDark: boolean, blocked?: 'storage' | 'media' | 'both') {
  const dataset: Record<string, string> = {};
  const window = {
    get localStorage() {
      if (blocked === 'storage' || blocked === 'both') throw new Error('SecurityError');
      return { getItem: (key: string) => { expect(key).toBe(APPEARANCE_STORAGE_KEY); return stored; } };
    },
    matchMedia: (query: string) => {
      if (blocked === 'media' || blocked === 'both') throw new Error('Unavailable');
      expect(query).toBe('(prefers-color-scheme: dark)');
      return { matches: systemDark };
    },
  };
  runInNewContext(APPEARANCE_INIT_SCRIPT, { window, document: { documentElement: { dataset } } });
  return dataset;
}

function contrast(a: string, b: string) {
  function luminance(hex: string) {
    return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('apariencia local y arranque sin destello', () => {
  for (const stored of [...APPEARANCE_OPTIONS, null, undefined, 'invalid', '"dark"', '<script>']) {
    for (const systemDark of [false, true]) {
      it(`resuelve el primer render y la preferencia igual: ${String(stored)} / ${systemDark}`, () => {
        const preference = parseAppearance(stored);
        expect(runBootstrap(stored, systemDark)).toEqual({
          appearance: preference, theme: resolveAppearance(preference, systemDark),
        });
      });
    }
  }
  it('el almacenamiento bloqueado no impide seguir el sistema', () => {
    expect(runBootstrap('light', true, 'storage')).toEqual({ appearance: 'system', theme: 'dark' });
    expect(runBootstrap('dark', true, 'both')).toEqual({ appearance: 'system', theme: 'light' });
  });
  it('el aspecto explícito funciona incluso sin matchMedia', () => {
    expect(runBootstrap('dark', false, 'media')).toEqual({ appearance: 'dark', theme: 'dark' });
  });
  it('almacena sólo el valor de interfaz en su clave propia', () => {
    const changes: [string, string][] = [];
    expect(saveAppearance({ setItem: (key, value) => changes.push([key, value]) }, 'dark')).toBe(true);
    expect(changes).toEqual([[APPEARANCE_STORAGE_KEY, 'dark']]);
    expect(readAppearance({ getItem: () => 'light' })).toBe('light');
    expect(readAppearance({ getItem: () => 'not-valid' })).toBe('system');
  });
  it('gestiona lectura y escritura denegadas sin excepciones', () => {
    expect(readAppearance(null)).toBe('system');
    expect(readAppearance({ getItem() { throw new Error('Denied'); } })).toBe('system');
    expect(saveAppearance(null, 'dark')).toBe(false);
    expect(saveAppearance({ setItem() { throw new Error('QuotaExceeded'); } }, 'dark')).toBe(false);
  });
  it('el sistema puede cambiar sin reemplazar una elección explícita', () => {
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });
});

describe('selector accesible y paleta semántica', () => {
  it('usa un fieldset de radios nativos con nombres, selección y estado accesibles', () => {
    const html = renderToStaticMarkup(<AppearanceProvider><AppearancePreference /></AppearanceProvider>);
    expect(html).toContain('<legend');
    expect(html).toContain('Apariencia');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('value="system"');
    expect(html).toContain('role="status"');
    expect(html.match(/min-h-11/g)).toHaveLength(3);
    for (const label of ['Claro', 'Oscuro', 'Sistema']) expect(html).toContain(label);
  });
  it('preserva contraste AA de estados en oscuro, sin cambiar sus colores de señal', () => {
    for (const [name, palette] of Object.entries(DARK_STATUS_COLORS)) {
      expect(contrast(palette.text, palette.surface), name).toBeGreaterThanOrEqual(4.5);
      expect(DARK_SURFACE_COLORS[`${name}-600`]).toBeUndefined();
    }
    expect(DARK_SURFACE_COLORS['petrol-800']).toBeUndefined();
    expect(DARK_SURFACE_COLORS['gold-500']).toBeUndefined();
    expect(contrast('#091820', '#06b6d4')).toBeGreaterThanOrEqual(4.5);
  });
  it('mantiene texto y metadatos legibles sobre las superficies principales', () => {
    for (const foreground of ['slate-400', 'slate-500', 'slate-600', 'petrol-900']) {
      for (const background of ['white', 'slate-50', 'slate-100', 'petrol-50']) {
        expect(contrast(DARK_TEXT_COLORS[foreground]!, DARK_SURFACE_COLORS[background]!)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('mantiene inicialización antes del contenido y preferencia en ambas cuentas', () => {
    const root = readFileSync('src/app/layout.tsx', 'utf8');
    expect(root.indexOf('id="aroh-appearance"')).toBeLessThan(root.indexOf('<body>'));
    expect(root).toContain('suppressHydrationWarning');
    for (const file of ['topbar-menus.tsx', 'nav.tsx']) {
      expect(readFileSync(`src/components/layout/${file}`, 'utf8')).toContain('<AppearancePreference />');
    }
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(':root { color-scheme: light; }');
  });
});
