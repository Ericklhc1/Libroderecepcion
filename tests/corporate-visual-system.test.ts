import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sistema visual corporativo AROH', () => {
  it('mantiene la paleta petróleo/dorado y reduce los radios globales', () => {
    const config = readFileSync('tailwind.config.ts', 'utf8');
    expect(config).toContain("500: '#c9a227'");
    expect(config).toContain("950: '#091820'");
    expect(config).toContain("lg: '5px'");
    expect(config).toContain("'2xl': '8px'");
  });

  it('usa superficies estructuradas y fondo cálido', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('background: #f4f2ed');
    expect(css).toContain('border border-slate-300 bg-white shadow-card');
    expect(css).toContain('background-color: #faf9f6');
  });

  it('da a la navegación de escritorio el tratamiento oscuro corporativo', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    expect(nav).toContain('bg-petrol-950 lg:block');
    expect(nav).toContain("'bg-petrol-800 text-white'");
    expect(nav).toContain("'text-petrol-100 hover:bg-petrol-900 hover:text-white'");
  });

  it('mantiene el producto y alojamiento separados en la cabecera', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
    expect(layout).toContain('AROH Central IA');
    expect(layout).toContain('{hotelName}');
    expect(layout).toContain('border-t-gold-500');
    expect(layout).toContain('bg-petrol-950 text-gold-400');
  });
});
