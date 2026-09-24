import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { refreshSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

function expiredResponse() {
  return NextResponse.json(
    { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
    { status: 401, headers },
  );
}

/**
 * Pulso genérico de sesión para la interfaz global.
 *
 * No depende de FRONTI ni de ningún feature flag: la campana y otros
 * componentes compartidos no deben perder la sesión sólo porque una cuenta
 * todavía no participe del rollout del asistente.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return expiredResponse();

  const alive = await refreshSession(user.id, user.sessionId);
  if (!alive) return expiredResponse();

  return NextResponse.json({ ok: true }, { headers });
}
