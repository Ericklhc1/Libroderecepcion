import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/current-user';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import {
  acknowledgeOperationalAlarm,
  snoozeOperationalAlarm,
} from '@/server/services/operational-alarms';
import { getNotificationFeedForUser } from '@/server/services/notification-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('acknowledge'), recipientId: z.string().min(1) }),
  z.object({
    action: z.literal('snooze'),
    recipientId: z.string().min(1),
    minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  }),
]);

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) {
    return NextResponse.json({ error: 'Tu sesión venció.' }, { status: 401, headers });
  }
  if (!(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json({ error: 'Debes aceptar los términos vigentes.' }, { status: 403, headers });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400, headers });
  }

  try {
    if (input.action === 'acknowledge') {
      await acknowledgeOperationalAlarm(user, input.recipientId);
    } else {
      await snoozeOperationalAlarm(user, input.recipientId, input.minutes);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo actualizar la alarma.' },
      { status: 400, headers },
    );
  }

  return NextResponse.json(await getNotificationFeedForUser(user), { headers });
}
