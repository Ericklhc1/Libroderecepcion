import 'server-only';
import { cookies, headers } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/server/errors';

export const SESSION_COOKIE = 'lor_session';

type SessionPayload = { sub: string; sid: string };

function authSecretKey(): Uint8Array {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new AppError(
      'La autenticación no está configurada correctamente. Código: AUTH_CONFIG.',
      'AUTH_CONFIG',
    );
  }
  return new TextEncoder().encode(value);
}

function sessionTtlHours(): number {
  const raw = process.env.SESSION_TTL_HOURS?.trim();
  if (!raw) return 12;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 168) {
    console.warn('[auth] SESSION_TTL_HOURS inválido; se usa 12 horas');
    return 12;
  }
  return value;
}

async function signSessionToken(
  userId: string,
  sessionId: string,
  expiresAt: Date,
  key: Uint8Array = authSecretKey(),
): Promise<string> {
  return new SignJWT({ sub: userId, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key);
}

/**
 * Crea una sesión persistida (para trazabilidad y revocación) y devuelve el
 * token firmado que viaja en una cookie httpOnly.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  // Valida la clave antes de tocar la base, para no dejar sesiones huérfanas
  // si el entorno de autenticación está incompleto.
  const key = authSecretKey();
  const expiresAt = new Date(Date.now() + sessionTtlHours() * 3600_000);

  let session;
  try {
    session = await prisma.session.create({
      data: {
        userId,
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error(
      '[auth] no se pudo persistir la sesión',
      error instanceof Error ? error.message : 'error no identificado',
    );
    throw new AppError(
      'No se pudo crear la sesión. Código: SESSION_DB.',
      'SESSION_DB',
    );
  }

  try {
    const token = await signSessionToken(userId, session.id, expiresAt, key);
    return { token, sessionId: session.id, expiresAt };
  } catch (error) {
    // Si la firma falla después de persistir, revoca la fila recién creada para
    // no dejar una sesión válida sin cookie asociada.
    await prisma.session
      .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
      .catch(() => null);

    console.error(
      '[auth] no se pudo firmar la sesión',
      error instanceof Error ? error.message : 'error no identificado',
    );
    throw new AppError(
      'No se pudo firmar la sesión. Código: SESSION_SIGN.',
      'SESSION_SIGN',
    );
  }
}

export async function writeSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/** Verifica la firma del token y que la sesión siga viva en base de datos. */
export async function readSessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecretKey(), {
      algorithms: ['HS256'],
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const sid = typeof payload.sid === 'string' ? payload.sid : null;
    if (!sub || !sid) return null;

    const session = await prisma.session.findUnique({ where: { id: sid } });
    if (!session) return null;
    if (session.userId !== sub) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() < Date.now()) return null;

    return { sub, sid };
  } catch {
    return null;
  }
}

/**
 * Sesión deslizante: mientras el usuario mantenga el Libro abierto, el cliente
 * envía un pulso periódico. Cada pulso renueva el vencimiento por el mismo TTL
 * configurado, sin crear una sesión nueva ni alterar su trazabilidad.
 */
export async function refreshSession(userId: string, sessionId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlHours() * 3600_000);
  const updated = await prisma.session.updateMany({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      lastSeenAt: now,
      expiresAt,
    },
  });
  if (updated.count !== 1) return false;

  const token = await signSessionToken(userId, sessionId, expiresAt);
  await writeSessionCookie(token, expiresAt);
  return true;
}

export async function revokeSession(sessionId: string) {
  await prisma.session
    .update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
    .catch(() => null);
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Metadatos de la petición para auditoría (best-effort). */
export async function requestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    const ip = forwarded ? (forwarded.split(',')[0] ?? '').trim() : null;
    return { ip: ip || h.get('x-real-ip') || null, userAgent: h.get('user-agent') };
  } catch {
    return { ip: null, userAgent: null };
  }
}
