import 'server-only';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import {
  createSession,
  revokeAllUserSessions,
} from '@/server/auth/session';
import { hashPassword, passwordSchema, verifyPassword } from '@/server/auth/password';
import { normalizeUsername } from '@/domain/username';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

/** Mensaje único para credenciales inválidas: no revela si el usuario existe. */
const INVALID_CREDENTIALS = 'Usuario o contraseña incorrectos.';

export type AuthenticatedSession = {
  userId: string;
  name: string;
  sessionId: string;
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
};

/**
 * Verifica credenciales y abre sesión.
 *
 * Aquí vive toda la lógica sensible (bloqueo por intentos, cuentas inactivas,
 * auditoría); la acción de servidor sólo escribe la cookie y redirige. Así el
 * comportamiento es verificable con pruebas automatizadas.
 */
export async function authenticate(input: {
  username: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<AuthenticatedSession> {
  /*
    Se entra con el nombre de usuario, no con el correo. El correo puede
    repetirse —todo el mesón comparte la casilla de recepción— así que no
    identifica a nadie; el usuario sí, y es único.

    La comparación ignora mayúsculas porque en el mesón nadie recuerda si su
    usuario se escribió «EHerrera» o «eherrera», y la arroba se descarta:
    se muestra con ella, se guarda sin ella.
  */
  const identifier = normalizeUsername(input.username);

  const user = identifier
    ? await prisma.user.findFirst({
        where: {
          username: { equals: identifier, mode: 'insensitive' },
          deletedAt: null,
        },
        include: { role: true },
      })
    : null;

  if (!user) {
    await prisma.loginAttempt.create({
      data: { identifier, ip: input.ip ?? null, success: false },
    });
    throw new AppError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(
      `Cuenta bloqueada temporalmente por intentos fallidos. Reintenta en ${minutes} minuto(s).`,
      'LOCKED',
    );
  }

  if (!user.active) {
    throw new AppError(
      'Tu cuenta está inactiva. Contacta al Administrador de sistema.',
      'INACTIVE',
    );
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    const failedAttempts = user.failedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts,
        lockedUntil:
          failedAttempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
      },
    });
    await prisma.loginAttempt.create({
      data: { identifier, ip: input.ip ?? null, success: false },
    });
    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.LOGIN_FALLIDO,
      summary: `Intento de sesión fallido para @${user.username} (${failedAttempts}/${MAX_FAILED_ATTEMPTS})`,
    });
    throw new AppError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }

  const session = await createSession(user.id, {
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });
  await prisma.loginAttempt.create({
    data: { identifier, ip: input.ip ?? null, success: true },
  });
  await recordAudit({
    entity: 'User',
    entityId: user.id,
    action: AuditAction.LOGIN,
    summary: `${user.name} inició sesión`,
    user: { id: user.id, sessionId: session.sessionId },
  });

  return {
    userId: user.id,
    name: user.name,
    sessionId: session.sessionId,
    token: session.token,
    expiresAt: session.expiresAt,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Cambia la contraseña del propio usuario y revoca las demás sesiones, de modo
 * que una contraseña comprometida deje de servir de inmediato.
 */
export async function changeOwnPassword(
  user: { id: string; name: string; sessionId: string },
  input: { currentPassword: string; newPassword: string },
): Promise<{ token: string; expiresAt: Date }> {
  const newPassword = passwordSchema.parse(input.newPassword);
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  if (!(await verifyPassword(input.currentPassword, record.passwordHash))) {
    throw new AppError('La contraseña actual no es correcta.', 'INVALID_CREDENTIALS');
  }
  if (await verifyPassword(newPassword, record.passwordHash)) {
    throw new AppError('La nueva contraseña debe ser distinta de la actual.', 'SAME_PASSWORD');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  await revokeAllUserSessions(user.id);

  const session = await createSession(user.id);
  await recordAudit({
    entity: 'User',
    entityId: user.id,
    action: AuditAction.EDITAR,
    summary: `${user.name} cambió su contraseña`,
    user: { id: user.id, sessionId: session.sessionId },
  });

  return { token: session.token, expiresAt: session.expiresAt };
}
