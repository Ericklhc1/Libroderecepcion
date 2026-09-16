import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  TEST_PASSWORD,
} from './helpers';
import { authenticate } from '@/server/services/auth';
import { allocateUsername } from '@/server/services/credentials';
import { loginSchema } from '@/server/schemas';

/**
 * La identidad de una cuenta es su nombre de usuario, y **es lo único que hay**.
 *
 * Decisión llevada hasta el final: primero el correo dejó de ser identificador
 * —en el hotel todo el mesón comparte la casilla de recepción, así que no
 * distinguía a nadie— y después se eliminó del modelo. Una cuenta es nombre,
 * usuario y contraseña. Un campo que no identifica, no sirve para entrar y hay
 * que inventar al crear la cuenta es un campo que sobra.
 *
 * Lo que estas pruebas fijan: que entrar dependa del usuario, que se acepte la
 * arroba y se ignoren las mayúsculas —en el mesón nadie recuerda cómo se
 * escribió—, y que no existan dos usuarios que sólo se diferencien en eso,
 * porque entonces entrar sería ambiguo.
 */
describe('la identidad de la cuenta es el usuario', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  /*
    La cuenta no tiene correo. Se comprueba en el ESQUEMA y no sólo en la
    interfaz: si alguien volviera a agregar la columna, un formulario podría
    empezar a pedirlo otra vez sin que nadie lo notara.
  */
  it('una cuenta es nombre, usuario y contraseña: no hay correo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Erick Herrera',
      username: 'EHerrera',
    });

    const fila = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Object.keys(fila)).not.toContain('email');
    expect(fila.name).toBe('Erick Herrera');
    expect(fila.username).toBe('EHerrera');
  });

  it('cada cuenta entra con su propio usuario', async () => {
    const erick = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'EHerrera',
    });
    const marta = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      username: 'MSoto',
    });

    const sesionErick = await authenticate({
      username: 'EHerrera',
      password: TEST_PASSWORD,
    });
    const sesionMarta = await authenticate({
      username: 'MSoto',
      password: TEST_PASSWORD,
    });

    expect(sesionErick.userId).toBe(erick.id);
    expect(sesionMarta.userId).toBe(marta.id);
  });

  it('acepta la arroba y no distingue mayúsculas al entrar', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      username: 'EHerrera',
    });

    for (const escrito of ['EHerrera', '@EHerrera', 'eherrera', '  @EHERRERA  ']) {
      const sesion = await authenticate({ username: escrito, password: TEST_PASSWORD });
      expect(sesion.userId, `no entró escribiendo «${escrito}»`).toBe(user.id);
    }
  });

  it('un correo no sirve para entrar', async () => {
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, username: 'EHerrera' });

    // Quien lo intente recibe el mismo mensaje que con cualquier usuario que
    // no existe: no se revela si la cuenta está o no.
    await expect(
      authenticate({ username: 'recepcion@hoteleshw.com', password: TEST_PASSWORD }),
    ).rejects.toThrow('Usuario o contraseña incorrectos.');
  });

  it('no se puede crear un usuario que sólo cambie en las mayúsculas', async () => {
    await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, username: 'EHerrera' });

    /*
      El índice único de la base distingue mayúsculas, así que «eherrera»
      cabría. Es `allocateUsername` quien lo impide, y por eso se prueba:
      si dejara pasar el duplicado, entrar escribiendo «eherrera» podría caer
      en cualquiera de las dos cuentas.
    */
    const asignado = await allocateUsername('Enzo Herrera', 'eherrera');
    expect(asignado.toLowerCase()).not.toBe('eherrera');
    expect(asignado).toBe('eherrera2');
  });

  it('el formulario de ingreso descarta la arroba y no valida el formato', () => {
    // Un identificador con forma rara debe fallar como credencial inválida en
    // el servidor, no como error de formato: así no se revela qué usuarios
    // existen ni qué forma tienen.
    expect(loginSchema.parse({ username: '  @EHerrera ', password: 'x' })).toEqual({
      username: 'EHerrera',
      password: 'x',
    });
    expect(loginSchema.parse({ username: 'no@es.un.usuario', password: 'x' }).username).toBe(
      'no@es.un.usuario',
    );

    // Lo único que se exige es que no venga vacío.
    expect(() => loginSchema.parse({ username: '  @  ', password: 'x' })).toThrow();
  });

  it('el intento de ingreso registra lo que se escribió, exista o no la cuenta', async () => {
    await authenticate({ username: '@Inventado', password: 'NoImporta1' }).catch(() => null);

    const intento = await prisma.loginAttempt.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    expect(intento?.identifier).toBe('Inventado');
    expect(intento?.success).toBe(false);
  });
});
