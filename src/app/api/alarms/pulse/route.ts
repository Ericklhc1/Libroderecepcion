import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import {
  dispatchDueAlarmsForUser,
  getUnreadOperationalAlarmNotificationId,
} from '@/server/services/operational-alarms';
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
export async function GET(request: Request) {
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

  const knownAlarmId = new URL(request.url).searchParams.get('knownAlarmId') || null;
  const dispatched = await dispatchDueAlarmsForUser(user.id, new Date());
  const activeAlarmId = await getUnreadOperationalAlarmNotificationId(user.id);

  // El feed completo sólo viaja cuando el estado de la alarma cambió para
  // esta pestaña. Así también propagamos reconocimientos/posposiciones hechos
  // en otra pestaña sin reconsultar todo cada 30 segundos.
  if (activeAlarmId === knownAlarmId) {
    return NextResponse.json({ dispatched, activeAlarmId }, { headers });
  }

  const snapshot = await getNotificationFeedForUser(user.id);
  return NextResponse.json({ dispatched, activeAlarmId, snapshot }, { headers });
}
