import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sistema visual corporativo AROH', () => {
  it('mantiene la paleta azul noche/cian y reduce los radios globales', () => {
    const config = readFileSync('tailwind.config.ts', 'utf8');
    expect(config).toContain("500: '#06b6d4'");
    expect(config).toContain("950: '#091820'");
    expect(config).toContain("lg: '5px'");
    expect(config).toContain("'2xl': '8px'");
  });

  it('usa superficies estructuradas y fondo frío', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('background: #f3f6f8');
    expect(css).toContain('border border-slate-300 bg-white shadow-card');
    expect(css).toContain('background-color: #f8fafc');
  });

  it('da al sidebar de escritorio el tratamiento oscuro corporativo', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    expect(nav).toContain("'flex items-center gap-3 rounded-md border-l-2");
    expect(nav).toContain("'border-gold-500 bg-petrol-800 font-semibold text-white'");
    expect(nav).toContain("'border-transparent text-petrol-200 hover:border-petrol-700 hover:bg-petrol-900 hover:text-white'");
  });

  it('mantiene el producto y alojamiento separados en la cabecera', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('AROH Central IA');
    expect(layout).toContain('{hotelName}');
    expect(layout).toContain('<SidebarNav groups={groups} badges={badges} />');
    expect(layout).toContain('bg-petrol-950 lg:flex');
  });
});
