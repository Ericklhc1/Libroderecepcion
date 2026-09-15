import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  TEST_PASSWORD,
} from './helpers';
import { authenticate, changeOwnPassword, MAX_FAILED_ATTEMPTS } from '@/server/services/auth';
import { readSessionToken, revokeSession } from '@/server/auth/session';
import { passwordSchema } from '@/server/auth/password';
import { AppError } from '@/server/errors';

describe('inicio de sesión', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('autentica con credenciales correctas y abre una sesión verificable', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    const session = await authenticate({
      email: user.email,
      password: TEST_PASSWORD,
      ip: '10.0.0.5',
    });

    expect(session.userId).toBe(user.id);
    const payload = await readSessionToken(session.token);
    expect(payload).toEqual({ sub: user.id, sid: session.sessionId });

    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.ip).toBe('10.0.0.5');
    expect(stored.revokedAt).toBeNull();
  });

  it('acepta el correo con mayúsculas y espacios', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const session = await authenticate({
      email: `  ${user.email.toUpperCase()}  `,
      password: TEST_PASSWORD,
    });
    expect(session.userId).toBe(user.id);
  });

  it('rechaza la contraseña incorrecta con un mensaje que no revela el correo', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    await expect(
      authenticate({ email: user.email, password: 'IncorrectaAA1' }),
    ).rejects.toThrow('Correo o contraseña incorrectos.');

    await expect(
      authenticate({ email: 'no-existe@test.local', password: 'IncorrectaAA1' }),
    ).rejects.toThrow('Correo o contraseña incorrectos.');
  });

  it('registra el intento fallido en la auditoría', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await authenticate({ email: user.email, password: 'IncorrectaAA1' }).catch(() => null);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: user.id, action: 'LOGIN_FALLIDO' },
    });
    expect(log).not.toBeNull();
    expect(log?.summary).toContain(`1/${MAX_FAILED_ATTEMPTS}`);
  });

  it('bloquea la cuenta tras cinco intentos fallidos', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await authenticate({ email: user.email, password: 'IncorrectaAA1' }).catch(() => null);
    }

    // Incluso con la contraseña correcta, la cuenta queda bloqueada.
    await expect(
      authenticate({ email: user.email, password: TEST_PASSWORD }),
    ).rejects.toThrow(/bloqueada temporalmente/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(stored.lockedUntil).not.toBeNull();
  });

  it('reinicia el contador de fallos tras un ingreso correcto', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await authenticate({ email: user.email, password: 'IncorrectaAA1' }).catch(() => null);
    await authenticate({ email: user.email, password: TEST_PASSWORD });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.failedAttempts).toBe(0);
    expect(stored.lastLoginAt).not.toBeNull();
  });

  it('impide el ingreso de cuentas inactivas y eliminadas', async () => {
    const inactive = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, active: false });
    await expect(
      authenticate({ email: inactive.email, password: TEST_PASSWORD }),
    ).rejects.toThrow(/inactiva/);

    const deleted = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await prisma.user.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      authenticate({ email: deleted.email, password: TEST_PASSWORD }),
    ).rejects.toThrow('Correo o contraseña incorrectos.');
  });

  it('una sesión revocada deja de ser válida', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const session = await authenticate({ email: user.email, password: TEST_PASSWORD });

    await revokeSession(session.sessionId);
    expect(await readSessionToken(session.token)).toBeNull();
  });

  it('rechaza un token manipulado', async () => {
    expect(await readSessionToken('token-invalido')).toBeNull();
    expect(await readSessionToken(undefined)).toBeNull();
  });
});

describe('política y cambio de contraseña', () => {
  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
  });

  it('exige longitud, mayúscula, minúscula y número', () => {
    expect(passwordSchema.safeParse('corta1A').success).toBe(false);
    expect(passwordSchema.safeParse('todominuscula1').success).toBe(false);
    expect(passwordSchema.safeParse('TODOMAYUSCULA1').success).toBe(false);
    expect(passwordSchema.safeParse('SinNumerosAqui').success).toBe(false);
    expect(passwordSchema.safeParse('ClaveSegura1').success).toBe(true);
  });

  it('cambia la contraseña y revoca las demás sesiones', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const first = await authenticate({ email: user.email, password: TEST_PASSWORD });
    const second = await authenticate({ email: user.email, password: TEST_PASSWORD });

    const result = await changeOwnPassword(
      { id: user.id, name: user.name, sessionId: second.sessionId },
      { currentPassword: TEST_PASSWORD, newPassword: 'NuevaClave2026' },
    );

    // Las sesiones anteriores quedan revocadas; la nueva sirve.
    expect(await readSessionToken(first.token)).toBeNull();
    expect(await readSessionToken(second.token)).toBeNull();
    expect(await readSessionToken(result.token)).not.toBeNull();

    await expect(
      authenticate({ email: user.email, password: TEST_PASSWORD }),
    ).rejects.toThrow(AppError);
    await expect(
      authenticate({ email: user.email, password: 'NuevaClave2026' }),
    ).resolves.toMatchObject({ userId: user.id });
  });

  it('exige la contraseña actual correcta', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(
      changeOwnPassword(
        { id: user.id, name: user.name, sessionId: 'x' },
        { currentPassword: 'OtraClave1', newPassword: 'NuevaClave2026' },
      ),
    ).rejects.toThrow(/contraseña actual no es correcta/);
  });

  it('no permite repetir la contraseña vigente', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(
      changeOwnPassword(
        { id: user.id, name: user.name, sessionId: 'x' },
        { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
      ),
    ).rejects.toThrow(/distinta de la actual/);
  });

  it('rechaza una contraseña nueva que no cumple la política', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await expect(
      changeOwnPassword(
        { id: user.id, name: user.name, sessionId: 'x' },
        { currentPassword: TEST_PASSWORD, newPassword: 'simple' },
      ),
    ).rejects.toThrow();
  });

  it('quita la marca de cambio obligatorio al definir la propia', async () => {
    const user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });

    await changeOwnPassword(
      { id: user.id, name: user.name, sessionId: 'x' },
      { currentPassword: TEST_PASSWORD, newPassword: 'NuevaClave2026' },
    );

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mustChangePassword).toBe(false);
  });
});
