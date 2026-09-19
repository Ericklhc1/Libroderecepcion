import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getUnreadCountsForUser } from '@/server/services/notification-poll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json(
      { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
      { status: 401, headers },
    );
  }

  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json(
      { error: 'Debes aceptar los términos vigentes antes de continuar.' },
      { status: 403, headers },
    );
  }

  try {
    const counts = await getUnreadCountsForUser(user.id);
    return NextResponse.json(counts, { headers });
  } catch (error) {
    console.error('[notificaciones-poll]', error);
    return NextResponse.json(
      { error: 'No se pudieron actualizar las notificaciones.' },
      { status: 500, headers },
    );
  }
}
