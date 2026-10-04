import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTextPdf } from '@/server/reports/simple-pdf';

describe('informes documentales imprimibles', () => {
  it('expone el informe filtrado de Novedades e Historial como PDF inline', () => {
    const route = readFileSync('src/app/api/libro/reporte/route.ts', 'utf8');
    const history = readFileSync('src/app/(app)/historial/page.tsx', 'utf8');
    const book = readFileSync('src/app/(app)/libro/page.tsx', 'utf8');

    expect(route).toContain("'Content-Type': 'application/pdf'");
    expect(route).toContain("'inline'");
    expect(route).toContain('collect(filters,user)');
    expect(history).toContain('Ver / imprimir informe');
    expect(history).toContain('/api/libro/reporte?');
    expect(book).toContain("reportParams.set('vista', 'novedades')");
  });

  it('permite abrir o descargar los informes de Supervisión', () => {
    const page = readFileSync('src/app/(app)/supervision/informes/page.tsx', 'utf8');
    const route = readFileSync('src/app/api/supervision/reportes/route.ts', 'utf8');

    expect(page).toContain('Ver / imprimir PDF');
    expect(page).toContain('&modo=inline');
    expect(page).toContain('Descargar');
    expect(route).toContain("url.searchParams.get('modo') === 'inline'");
  });

  it('genera PDFs Carta con densidad compacta y legible', () => {
    const source = readFileSync('src/server/reports/simple-pdf.ts', 'utf8');
    expect(source).toContain('const pageSize = 56');
    expect(source).toContain('/MediaBox [0 0 612 792]');
    expect(source).toContain('/F1 8 Tf 30');

    const pdf = createTextPdf({
      title: 'Informe de prueba',
      lines: Array.from({ length: 80 }, (_, index) => `Registro ${index + 1}`),
      generatedAt: new Date('2026-09-28T12:00:00.000Z'),
    });
    const text = pdf.toString('latin1');
    expect(text).toContain('/MediaBox [0 0 612 792]');
    expect(text).toContain('/Count 2');
  });
});
