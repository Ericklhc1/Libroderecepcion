import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Páginas que no se pueden pre-generar.
 *
 * Esta prueba existe por un error real en producción. La pantalla de inicio de
 * sesión decide según el estado de la base: si no hay ninguna cuenta, manda a
 * la instalación. Al compilarse, la base estaba vacía y esa decisión quedó
 * congelada en el archivo generado. En cuanto se creó la primera cuenta,
 * /instalacion mandaba a /login y /login —ya congelada— mandaba de vuelta a
 * /instalacion: ERR_TOO_MANY_REDIRECTS.
 *
 * Cualquier pantalla que consulte la base antes de redirigir tiene que ser
 * dinámica. Las de dentro de (app) ya lo son porque leen la cookie de sesión;
 * las de fuera hay que declararlas.
 */
const PAGES_OUTSIDE_APP = [
  'src/app/login/page.tsx',
  'src/app/instalacion/page.tsx',
  'src/app/cambiar-contrasena/page.tsx',
];

describe('renderizado de las pantallas de acceso', () => {
  for (const path of PAGES_OUTSIDE_APP) {
    it(`${path} no se pre-genera`, () => {
      const source = readFileSync(path, 'utf-8');
      const declaresDynamic = /export const dynamic\s*=\s*'force-dynamic'/.test(source);
      const readsCookies = /requirePageUser|getCurrentUser/.test(source);
      /*
        Una de las dos: o se declara dinámica, o toca la cookie de sesión antes
        de cualquier redirección, que es lo que fuerza el renderizado dinámico.
      */
      expect(declaresDynamic || readsCookies).toBe(true);
    });
  }

  it('la pantalla de inicio de sesión se declara dinámica de forma explícita', () => {
    /*
      En esta no basta con que lea la cookie: consulta la base *antes* de
      hacerlo, y esa consulta es la que se congelaba.
     */
    const source = readFileSync('src/app/login/page.tsx', 'utf-8');
    expect(source).toMatch(/export const dynamic\s*=\s*'force-dynamic'/);
  });
});
