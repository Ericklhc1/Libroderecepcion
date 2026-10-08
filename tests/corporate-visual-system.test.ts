import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sistema visual corporativo AROH', () => {
  it('mantiene la paleta azul noche/cian con geometría FNS compartida', () => {
    const config = readFileSync('tailwind.config.ts', 'utf8');
    expect(config).toContain("500: '#06b6d4'");
    expect(config).toContain("950: '#091820'");
    expect(config).toContain("lg: '0px'");
    expect(config).toContain("'2xl': '0px'");
  });

  it('usa superficies estructuradas y fondo frío', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('background: var(--aroh-canvas)');
    expect(css).toContain('--aroh-canvas: #eef0f2');
    expect(css).toContain('--aroh-canvas: #0b1c29');
    expect(css).toContain('border border-slate-300 bg-white shadow-card');
    expect(css).toContain('background-color: var(--aroh-subtle)');
  });

  it('da al sidebar de escritorio el tratamiento oscuro corporativo', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    expect(readFileSync('src/components/layout/app-sidebar.tsx', 'utf8')).toContain('rounded-md border-l-2');
    expect(readFileSync('src/components/layout/app-sidebar.tsx', 'utf8')).toContain('border-gold-500 bg-petrol-800');
    expect(readFileSync('src/components/layout/app-sidebar.tsx', 'utf8')).toContain('text-petrol-200 hover:border-petrol-700 hover:bg-petrol-900');
    const sidebar = nav.slice(nav.indexOf('export function SidebarNav'), nav.indexOf('/** Barra inferior para móvil'));
    expect(sidebar).not.toContain('section.items.map((subitem)');
  });

  it('mantiene producto y alojamiento separados en el shell', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('AROH');
    expect(layout).toContain('Central IA');
    expect(layout).toContain('hotelName={hotelName}');
    expect(layout).toContain('<DesktopNav groups={groups} badges={badges} />');
    expect(layout).not.toContain('<AppSidebar');
    expect(readFileSync('src/components/layout/app-sidebar.tsx', 'utf8')).toContain('bg-petrol-950 lg:flex');
  });
});
