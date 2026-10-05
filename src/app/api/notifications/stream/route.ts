import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';
import { dispatchDueAlarmsForUser } from '@/server/services/operational-alarms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

/**
 * Sincronización corta de notificaciones y alarmas.
 *
 * La ruta conserva el nombre histórico para no crear otra Function, pero ya
 * no sostiene un SSE. Cada solicitud resuelve, responde y libera memoria.
 *
 * mode=alarm ejecuta sólo el pulso de alarmas y evita cargar el feed completo
 * cuando no hay nada nuevo. Esto reemplaza /api/alarms/pulse con la misma
 * Function y reduce almacenamiento de artefactos.
 */
async function GETHandler(request: Request) {
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

  const alarmOnly = new URL(request.url).searchParams.get('mode') === 'alarm';

  try {
    const dispatched = await dispatchDueAlarmsForUser(user.id, new Date());

    if (alarmOnly && dispatched === 0) {
      return NextResponse.json({ dispatched: 0 }, { headers });
    }

    const snapshot = await getNotificationFeedForUser(user.id);
    if (alarmOnly) {
      return NextResponse.json({ dispatched, snapshot }, { headers });
    }

    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    console.error('[notificaciones-poll] no se pudo actualizar el snapshot', error);
    return NextResponse.json(
      { error: 'No se pudieron actualizar las notificaciones.' },
      { status: 500, headers },
    );
  }
}

export const GET = withMaintenance(GETHandler);
