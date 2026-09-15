import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El worker de pdf.js tiene que viajar a la función desplegada.
 *
 * Error real de producción: al subir los tres informes, los tres fallaban con
 * «Setting up fake worker failed: Cannot find module .../pdf.worker.mjs».
 *
 * En local nunca podía verse: el archivo está en node_modules y todo
 * funcionaba. El worker se carga en tiempo de ejecución, no con un `import`
 * estático, así que el trazador de Next no lo veía y no lo copiaba. Sólo
 * viajaba `pdf.mjs`.
 *
 * Esta prueba mira el manifiesto de archivos que Next genera para cada
 * función (`*.nft.json`): es exactamente la lista que se despliega, de modo
 * que comprueba el empaquetado sin necesidad de desplegar.
 */
const RUTAS_QUE_LEEN_PDF = [
  '.next/server/app/(app)/habitaciones/importar/page.js.nft.json',
  '.next/server/app/(app)/turno/page.js.nft.json',
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

  it('la configuración declara el worker para ambas rutas', () => {
    /*
      Se comprueba también sobre la configuración, porque el manifiesto sólo
      existe después de compilar y esta prueba debe fallar igual cuando
      alguien quite la declaración sin volver a compilar.
    */
    const config = readFileSync('next.config.mjs', 'utf-8');
    expect(config).toContain('outputFileTracingIncludes');
    for (const ruta of ['/turno', '/habitaciones/importar']) {
      const bloque = config.slice(config.indexOf('outputFileTracingIncludes'));
      expect(bloque).toContain(`'${ruta}'`);
    }
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
