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
 * La identidad de una cuenta es su nombre de usuario, no su correo.
 *
 * En el hotel varias cuentas comparten la casilla de recepción, así que el
 * correo no distingue a nadie. Lo que estas pruebas fijan es que esa decisión
 * no se pueda deshacer por descuido: que el correo pueda repetirse, que entrar
 * dependa del usuario, y que no puedan existir dos usuarios que sólo se
 * diferencien en las mayúsculas —porque entonces entrar sería ambiguo—.
 */
describe('la identidad de la cuenta es el usuario', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('varias cuentas pueden compartir el mismo correo', async () => {
    const casilla = 'recepcion@hoteleshw.com';

    const primera = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      email: casilla,
      name: 'Erick Herrera',
      username: 'EHerrera',
    });
    const segunda = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      email: casilla,
      name: 'Marta Soto',
      username: 'MSoto',
    });

    expect(primera.email).toBe(casilla);
    expect(segunda.email).toBe(casilla);
    expect(primera.id).not.toBe(segunda.id);

    const cuentas = await prisma.user.findMany({ where: { email: casilla } });
    expect(cuentas).toHaveLength(2);
  });

  it('cada cuenta que comparte el correo entra con su propio usuario', async () => {
    const casilla = 'recepcion@hoteleshw.com';
    const erick = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      email: casilla,
      username: 'EHerrera',
    });
    const marta = await createUser({
      roleKey: ROLE_KEYS.SUPERVISOR,
      email: casilla,
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

    // Cada usuario abre SU sesión: el correo compartido no las confunde.
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

  it('un correo ya no sirve para entrar', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      email: 'recepcion@hoteleshw.com',
      username: 'EHerrera',
    });
    expect(user.email).toBe('recepcion@hoteleshw.com');

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
