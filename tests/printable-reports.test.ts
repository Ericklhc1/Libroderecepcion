import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('informes imprimibles', () => {
  it('usa formato carta compacto como estándar de impresión', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('size: letter');
    expect(css).toContain('.print-report');
    expect(css).toContain('font-size: 8.5pt');
  });

  it('permite imprimir auditorías cerradas desde su historial', () => {
    const history = readFileSync('src/app/(app)/supervision/auditorias/page.tsx', 'utf8');
    const result = readFileSync('src/app/(app)/auditorias/resultados/[id]/page.tsx', 'utf8');
    expect(history).toContain('Ver / imprimir informe');
    expect(history).toContain('/auditorias/resultados/');
    expect(result).toContain('Imprimir auditoría');
    expect(result).toContain('print-report');
  });

  it('permite buscar turnos por rango y abrir su informe histórico', () => {
    const source = readFileSync('src/app/(app)/admin/turnos/page.tsx', 'utf8');
    expect(source).toContain('name="desde"');
    expect(source).toContain('name="hasta"');
    expect(source).toContain('Ver / imprimir');
    expect(source).toContain('/turno/entrega/');
  });

  it('mantiene arqueos e informes de turno dentro del estándar compacto', () => {
    const audit = readFileSync('src/app/(app)/caja/arqueos/[id]/page.tsx', 'utf8');
    const handover = readFileSync('src/app/(app)/turno/entrega/[id]/page.tsx', 'utf8');
    expect(audit).toContain('print-report');
    expect(handover).toContain('Imprimir informe de turno');
    expect(handover).toContain('grid gap-4 lg:grid-cols-2 no-print');
  });
});
