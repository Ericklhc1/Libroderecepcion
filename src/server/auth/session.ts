import 'server-only';
import { cookies, headers } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'lor_session';

type SessionPayload = { sub: string; sid: string };

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

async function signSessionToken(userId: string, sessionId: string, expiresAt: Date): Promise<string> {
  return new SignJWT({ sub: userId, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey());
}

/**
 * Crea una sesión persistida (para trazabilidad y revocación) y devuelve el
 * token firmado que viaja en una cookie httpOnly.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const ttlHours = env().SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const token = await signSessionToken(userId, session.id, expiresAt);
  return { token, sessionId: session.id, expiresAt };
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
    const { payload } = await jwtVerify(token, secretKey(), {
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
  const expiresAt = new Date(now.getTime() + env().SESSION_TTL_HOURS * 3600_000);
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
