import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { dispatchDueAlarmsForUser } from '@/server/services/operational-alarms';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/**
 * Pulso de bajo costo para pestañas ocultas.
 *
 * No mantiene un stream abierto ni carga el feed completo salvo que realmente
 * haya una alarma vencida que deba materializarse para esta persona.
 */
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
      { error: 'Debes aceptar los términos vigentes.' },
      { status: 403, headers },
    );
  }

  const dispatched = await dispatchDueAlarmsForUser(user.id, new Date());
  if (dispatched === 0) {
    return NextResponse.json({ dispatched: 0 }, { headers });
  }

  const snapshot = await getNotificationFeedForUser(user.id);
  return NextResponse.json({ dispatched, snapshot }, { headers });
}
