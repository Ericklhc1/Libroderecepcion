import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El worker de pdf.js tiene que viajar a la función desplegada.
 *
 * Error real de producción: al subir los informes, fallaban con
 * «Setting up fake worker failed: Cannot find module .../pdf.worker.mjs».
 *
 * La importación PMS tiene una sola ruta canónica: /huespedes/importar.
 */
const RUTAS_QUE_LEEN_PDF = [
  '.next/server/app/(app)/huespedes/importar/page.js.nft.json',
];

describe('empaquetado del lector de PDF', () => {
  const construido = RUTAS_QUE_LEEN_PDF.every((ruta) => existsSync(ruta));

  it.runIf(construido)('el worker viaja en cada ruta que lee informes', () => {
    for (const ruta of RUTAS_QUE_LEEN_PDF) {
      const manifiesto = JSON.parse(readFileSync(ruta, 'utf-8')) as { files: string[] };
      const pdfjs = manifiesto.files.filter((archivo) => archivo.includes('pdfjs-dist'));

      expect(pdfjs.some((archivo) => archivo.endsWith('legacy/build/pdf.mjs'))).toBe(true);
      expect(pdfjs.some((archivo) => archivo.endsWith('legacy/build/pdf.worker.mjs'))).toBe(
        true,
      );
    }
  });

  it('la configuración declara el worker para la ruta canónica', () => {
    const config = readFileSync('next.config.mjs', 'utf-8');
    expect(config).toContain('outputFileTracingIncludes');
    const bloque = config.slice(config.indexOf('outputFileTracingIncludes'));
    expect(bloque).toContain("'/huespedes/importar'");
    expect(bloque).not.toContain("'/habitaciones/importar'");
    expect(bloque).not.toContain("'/turno'");
    expect(config).toContain('pdfjs-dist/legacy/build/pdf.worker.mjs');
  });

  it('el lector fija la ruta del worker en lugar de dejar que la deduzca', () => {
    const source = readFileSync('src/server/pms/read-pdf.ts', 'utf-8');
    expect(source).toContain('GlobalWorkerOptions.workerSrc');
    expect(source).toContain("resolve(\n        'pdfjs-dist/legacy/build/pdf.worker.mjs',\n      )");
    // Si no se puede resolver, no debe romper: se sigue sin fijarla.
    expect(source).toMatch(/catch \(error\) \{\s*\n\s*console\.warn/);
  });
});
