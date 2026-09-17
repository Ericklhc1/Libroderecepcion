'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { countLiveAlerts, runAlertEngine } from '@/server/services/alert-engine';

const ALERT_REFRESH_MS = 60_000;
let lastAlertRefresh = 0;

/**
 * Mantiene el motor al día mientras haya una sesión abierta, incluso si nadie
 * navega. El aviso sonoro consulta esta acción cada 20 s; el motor se limita a
 * una ejecución por minuto por instancia para no convertir ese sondeo ligero
 * en una batería de consultas en cada pestaña.
 *
 * Esto importa especialmente para reglas horarias —como el check-out desde las
 * 11:00—: la alerta debe aparecer y sonar aunque el recepcionista lleve rato en
 * la misma pantalla.
 */
async function refreshAlertsIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastAlertRefresh < ALERT_REFRESH_MS) return;

  lastAlertRefresh = now;
  try {
    await runAlertEngine(new Date(now));
  } catch (error) {
    // La siguiente consulta puede reintentar. El sonido nunca debe romper la UI.
    lastAlertRefresh = 0;
    console.error('[alertas] no se pudo refrescar el motor desde el sondeo', error);
  }
}

/**
 * Cuántas cosas sin leer hay ahora mismo.
 *
 * La cabecera renderiza el contador en el servidor, así que sólo cambia al
 * navegar. Para que una notificación **suene** cuando llega hay que saberlo sin
 * que nadie navegue, y de eso se encarga esta consulta.
 *
 * Antes de contar, mantiene fresco el motor automático como máximo una vez por
 * minuto. Después hace los dos `count` en paralelo. Devuelve también las
 * alertas vivas porque recordatorios, seguimientos y reglas operativas llegan
 * como alerta, no como notificación.
 */
export async function getUnreadCounts(): Promise<{
  notifications: number;
  alerts: number;
}> {
  const user = await requireUser();
  await refreshAlertsIfDue();

  const [notifications, alerts] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    countLiveAlerts(),
  ]);
  return { notifications, alerts };
}

const markSchema = z.object({ id: z.string().min(1).optional() });

/**
 * Marca como leída una notificación propia (o todas si no se indica id).
 * El filtro por `userId` evita el acceso horizontal a notificaciones ajenas.
 */
export async function markNotificationsReadAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(markSchema, formDataToObject(formData));

    const result = await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(input.id ? { id: input.id } : {}),
      },
      data: { readAt: new Date() },
    });

    revalidatePath('/notificaciones');
    revalidatePath('/');
    return {
      ok: true as const,
      message: input.id
        ? 'Notificación marcada como leída.'
        : `${result.count} notificación(es) marcadas como leídas.`,
    };
  });
}
