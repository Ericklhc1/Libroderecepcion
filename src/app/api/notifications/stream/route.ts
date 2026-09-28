import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { dispatchDueAlarmsForUser } from '@/server/services/operational-alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/**
 * Snapshot corto para sincronización operacional.
 *
 * Antes esta ruta mantenía una función SSE viva durante cuatro minutos,
 * lo que elevaba Fluid Provisioned Memory aunque el proceso estuviera ocioso.
 * Ahora cada solicitud resuelve el estado y termina inmediatamente.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json(
      { error: 'Sesión vencida.' },
      { status: 401, headers },
    );
  }

  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json(
      { error: 'Debes aceptar los términos vigentes.' },
      { status: 403, headers },
    );
  }

  try {
    await dispatchDueAlarmsForUser(user.id, new Date());
    return NextResponse.json(
      await getNotificationFeedForUser(user.id),
      { headers },
    );
  } catch (error) {
    console.error('[notificaciones-poll] no se pudo actualizar el snapshot', error);
    return NextResponse.json(
      { error: 'No se pudieron actualizar las notificaciones.' },
      { status: 500, headers },
    );
  }
}
