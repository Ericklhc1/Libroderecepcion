import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generatePassword } from '@/server/services/credentials';
import { isMailConfigured } from '@/server/mail';

/**
 * Las credenciales que sólo se pueden leer una vez.
 *
 * Error real: la clave generada viajaba dentro del texto del mensaje, y el
 * diálogo de creación se cerraba solo al tener éxito. La clave desaparecía
 * antes de que nadie pudiera leerla, no se guarda en claro en ninguna parte y
 * no se puede recuperar: el usuario quedaba creado y sin forma de entrar.
 */
describe('entrega de credenciales', () => {
  it('la clave no se interpola en el texto del mensaje', () => {
    const source = readFileSync('src/server/actions/admin.ts', 'utf-8');
    const fn = source.slice(
      source.indexOf('export async function createUserAction'),
      source.indexOf('export async function updateUserAction'),
    );
    // Debe viajar como dato, no dentro de una frase.
    expect(fn).toMatch(/credentials: \{/);
    expect(fn).toMatch(/password,/);
    // Ninguna plantilla de texto puede contener la clave.
    const templates = fn.match(/`[^`]*`/g) ?? [];
    for (const template of templates) {
      expect(template).not.toContain('${password}');
    }
  });

  it('el formulario no se cierra encima de las credenciales', () => {
    const source = readFileSync('src/components/ui/form.tsx', 'utf-8');
    // El efecto sale antes de cerrar o vaciar cuando la respuesta las trae.
    expect(source).toMatch(/if \(state\.credentials\) return;/);
    const effect = source.slice(source.indexOf('useEffect(() => {'));
    const body = effect.slice(0, effect.indexOf('}, [state,'));
    expect(body.indexOf('if (state.credentials) return;')).toBeLessThan(
      body.indexOf('closeOnSuccess'),
    );
    // Y hay una salida deliberada.
    expect(source).toContain('Ya las copié, cerrar');
  });

  it('la clave generada es fuerte y distinta cada vez', () => {
    const claves = Array.from({ length: 50 }, () => generatePassword());

    for (const clave of claves) {
      expect(clave.length).toBeGreaterThanOrEqual(14);
      expect(clave).toMatch(/[a-z]/);
      expect(clave).toMatch(/[A-Z]/);
      expect(clave).toMatch(/[0-9]/);
      // Sin caracteres que se confunden al dictarla por teléfono.
      expect(clave).not.toMatch(/[IlO01]/);
    }
    // Ninguna repetida: vienen de randomInt, no de Math.random.
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('sin SMTP configurado, el envío informa en vez de fallar en silencio', async () => {
    /*
      Es el estado actual del hotel: sin correo. La acción no puede romperse
      —el usuario sí se crea— pero tiene que decir que no se envió, porque de
      eso depende que alguien copie la clave.
    */
    expect(isMailConfigured()).toBe(false);

    const { deliverCredentials } = await import('@/server/services/credentials');
    const delivery = await deliverCredentials({
      name: 'Camila Rojas',
      username: 'CRojas',
      email: 'crojas@hoteleshw.com',
      password: 'NoSeUsaEnLaPrueba9',
      roleName: 'Recepcionista',
      hotelName: 'Hotel HW Libertad',
    });

    expect(delivery.sent).toBe(false);
    expect(delivery.reason).toBeTruthy();
    expect(delivery.recipient).toBe('recepcion@hoteleshw.com');
  });
});
